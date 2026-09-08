import type { SynthPatch } from "@refrain/soundpack";
import { envelopeLevel } from "./envelope.js";
import type { BiquadLowPass } from "./filter.js";
import { verifyAssetBytes } from "./digest.js";
import { performanceEventAt, type ExecutionBundle } from "./execution.js";
import { encodeExecutionMidi } from "./midi.js";
import type { PerformanceEvent, PerformanceVoice } from "./performance.js";
import { decodeWave, type DecodedWave } from "./sampler.js";
import { processSynthSample, synthFilter } from "./synth-kernel.js";
import { SceneBlockProcessor } from "./scene-renderer.js";

export const BLOCK_RENDERER_CONTRACT =
  "refrain-block-renderer@0-experimental" as const;
export const REFERENCE_BLOCK_FRAMES = 4_096;
const SOUNDFONT_RENDER_QUANTUM_FRAMES = 128;

export interface ExecutionAssetBundle {
  soundfont?: ArrayBuffer;
  samples?: Readonly<Record<string, ArrayBuffer>>;
}

export interface RenderedBlock {
  frameOffset: number;
  frameCount: number;
  left: Float32Array;
  right: Float32Array;
}

export interface BlockRenderOptions {
  blockFrames?: number;
  isCancelled?: () => boolean;
  applyMasterGain?: boolean;
}

interface ActiveSynth {
  event: PerformanceEvent;
  voice: PerformanceVoice;
  patch: SynthPatch;
  filter?: BiquadLowPass;
  endFrame: number;
}

interface ActiveSampler {
  event: PerformanceEvent;
  voice: PerformanceVoice;
  endFrame: number;
}

const dbToGain = (db: number): number => 10 ** (db / 20);

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function sampleAt(channel: Float32Array, position: number): number {
  const index = Math.floor(position);
  const fraction = position - index;
  const first = channel[index] ?? 0;
  const second = channel[index + 1] ?? first;
  return first + (second - first) * fraction;
}

function loopedSampleAt(
  channel: Float32Array,
  sourcePosition: number,
  event: PerformanceEvent,
): number {
  const sample = event.sample!;
  if (sample.loop.mode !== "sustain" || sourcePosition < sample.loop.startFrame)
    return sampleAt(channel, sourcePosition);
  const crossfade = sample.loop.crossfadeFrames ?? 0;
  const adjustedLoopStart = sample.loop.startFrame + crossfade;
  if (sourcePosition < adjustedLoopStart)
    return sampleAt(channel, sourcePosition);
  const loopLength = sample.loop.endFrame - adjustedLoopStart;
  const loopPosition =
    adjustedLoopStart + ((sourcePosition - adjustedLoopStart) % loopLength);
  if (crossfade === 0 || loopPosition < sample.loop.endFrame - crossfade)
    return sampleAt(channel, loopPosition);
  const progress =
    (loopPosition - (sample.loop.endFrame - crossfade)) / crossfade;
  const wrappedPosition = sample.loop.startFrame + progress * crossfade;
  return (
    sampleAt(channel, loopPosition) * (1 - progress) +
    sampleAt(channel, wrappedPosition) * progress
  );
}

function mixSynth(
  active: ActiveSynth,
  frameOffset: number,
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  tempo: number,
): void {
  const { event, voice, patch, filter } = active;
  const startFrame = Math.round((event.startBeat * 60 * sampleRate) / tempo);
  const noteSeconds = (event.soundingDurationBeats * 60) / tempo;
  const end = Math.min(frameOffset + left.length, active.endFrame);
  const first = Math.max(frameOffset, startFrame);
  const frequency = 440 * 2 ** ((event.midi - 69) / 12);
  const gain = dbToGain(event.effectiveGainDb) * event.performanceVelocity;
  const pan = Math.max(-1, Math.min(1, voice.pan));
  const leftPan = Math.cos(((pan + 1) * Math.PI) / 4);
  const rightPan = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let absoluteFrame = first; absoluteFrame < end; absoluteFrame += 1) {
    const elapsed = (absoluteFrame - startFrame) / sampleRate;
    const envelope = envelopeLevel(elapsed, noteSeconds, patch);
    const value =
      processSynthSample(patch, filter, elapsed, frequency) * envelope * gain;
    const local = absoluteFrame - frameOffset;
    left[local]! += value * leftPan;
    right[local]! += value * rightPan;
  }
}

function mixSampler(
  active: ActiveSampler,
  waves: ReadonlyMap<string, DecodedWave>,
  frameOffset: number,
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  tempo: number,
): void {
  const { event, voice } = active;
  const sample = event.sample!;
  const attack = waves.get(sample.attackAssetId);
  if (!attack)
    throw new Error(`Sampler asset ${sample.attackAssetId} was not decoded.`);
  const startFrame = Math.round((event.startBeat * 60 * sampleRate) / tempo);
  const noteFrames = Math.round(
    (event.soundingDurationBeats * 60 * sampleRate) / tempo,
  );
  const first = Math.max(frameOffset, startFrame);
  const end = Math.min(frameOffset + left.length, active.endFrame);
  const sourceStep = (attack.sampleRate / sampleRate) * sample.playbackRate;
  const gain =
    dbToGain(event.effectiveGainDb + sample.gainDb) * event.performanceVelocity;
  const pan = Math.max(-1, Math.min(1, voice.pan));
  const leftPan = Math.cos(((pan + 1) * Math.PI) / 4);
  const rightPan = Math.sin(((pan + 1) * Math.PI) / 4);
  const leftSource = attack.channels[0]!;
  const rightSource = attack.channels[1] ?? leftSource;
  const attackFrames = Math.max(
    1,
    Math.round(sampleRate * sample.attackSeconds),
  );
  const releaseFrames =
    sample.release.mode === "envelope"
      ? Math.max(1, Math.round(sample.release.seconds * sampleRate))
      : sample.release.mode === "sample"
        ? Math.max(1, Math.round(sampleRate * 0.01))
        : 0;
  for (let absoluteFrame = first; absoluteFrame < end; absoluteFrame += 1) {
    const elapsedFrame = absoluteFrame - startFrame;
    const sourcePosition = elapsedFrame * sourceStep;
    if (sample.loop.mode === "none" && sourcePosition >= attack.frameCount)
      break;
    const attackEnvelope = Math.min(1, elapsedFrame / attackFrames);
    const releaseEnvelope =
      sample.release.mode !== "natural" && elapsedFrame > noteFrames
        ? Math.max(0, 1 - (elapsedFrame - noteFrames) / releaseFrames)
        : 1;
    if (releaseEnvelope <= 0) break;
    const envelope = attackEnvelope * releaseEnvelope * gain;
    const local = absoluteFrame - frameOffset;
    left[local]! +=
      loopedSampleAt(leftSource, sourcePosition, event) * envelope * leftPan;
    right[local]! +=
      loopedSampleAt(rightSource, sourcePosition, event) * envelope * rightPan;
  }
  if (!sample.releaseSample) return;
  const releaseWave = waves.get(sample.releaseSample.assetId);
  if (!releaseWave)
    throw new Error(
      `Release asset ${sample.releaseSample.assetId} was not decoded.`,
    );
  const releaseStart = Math.round(
    (event.noteOffBeat * 60 * sampleRate) / tempo,
  );
  const releaseFirst = Math.max(frameOffset, releaseStart);
  const releaseEnd = Math.min(frameOffset + left.length, active.endFrame);
  const releaseStep =
    (releaseWave.sampleRate / sampleRate) * sample.releaseSample.playbackRate;
  const releaseGain =
    dbToGain(
      event.effectiveGainDb + sample.gainDb + sample.releaseSample.gainDb,
    ) * event.performanceVelocity;
  const releaseAttackFrames = Math.max(1, Math.round(sampleRate * 0.003));
  const releaseLeft = releaseWave.channels[0]!;
  const releaseRight = releaseWave.channels[1] ?? releaseLeft;
  for (
    let absoluteFrame = releaseFirst;
    absoluteFrame < releaseEnd;
    absoluteFrame += 1
  ) {
    const elapsed = absoluteFrame - releaseStart;
    const sourcePosition = elapsed * releaseStep;
    if (sourcePosition >= releaseWave.frameCount) break;
    const envelope = Math.min(1, elapsed / releaseAttackFrames) * releaseGain;
    const local = absoluteFrame - frameOffset;
    left[local]! += sampleAt(releaseLeft, sourcePosition) * envelope * leftPan;
    right[local]! +=
      sampleAt(releaseRight, sourcePosition) * envelope * rightPan;
  }
}

async function verifiedAssets(
  bundle: ExecutionBundle,
  supplied: ExecutionAssetBundle,
): Promise<{
  soundfont?: ArrayBuffer;
  samples: Map<string, DecodedWave>;
}> {
  let soundfont: ArrayBuffer | undefined;
  const samples = new Map<string, DecodedWave>();
  for (const required of bundle.plan.assetRequirements) {
    const bytes =
      required.kind === "soundfont"
        ? supplied.soundfont
        : supplied.samples?.[required.assetId];
    if (!bytes)
      throw new Error(`Execution asset ${required.assetId} was not supplied.`);
    const verified = await verifyAssetBytes(required, bytes);
    if (required.kind === "soundfont") soundfont = verified.data;
    else samples.set(required.assetId, decodeWave(verified.data));
  }
  return { ...(soundfont ? { soundfont } : {}), samples };
}

export async function* renderExecutionBlocks(
  bundle: ExecutionBundle,
  suppliedAssets: ExecutionAssetBundle,
  sampleRate = 44_100,
  options: BlockRenderOptions = {},
): AsyncGenerator<RenderedBlock, void, void> {
  const blockFrames = options.blockFrames ?? REFERENCE_BLOCK_FRAMES;
  if (!Number.isInteger(blockFrames) || blockFrames <= 0)
    throw new Error("Block renderer frame count must be a positive integer.");
  const verified = await verifiedAssets(bundle, suppliedAssets);
  const voiceById = new Map(
    bundle.plan.voices.map((voice) => [voice.voiceId, voice]),
  );
  const scene = bundle.plan.performanceBinding.renderScene;
  const sceneProcessor =
    scene.format === "refrain-render-scene@1-experimental"
      ? new SceneBlockProcessor(
          scene,
          sampleRate,
          bundle.compiled.durationSeconds,
          bundle.plan.renderDurationSeconds,
        )
      : undefined;
  const soundfontEventCount = bundle.compiled.events.reduce(
    (total, event) =>
      total + (voiceById.get(event.voiceId)?.engine === "soundfont" ? 1 : 0),
    0,
  );
  let synthProcessor:
    | InstanceType<typeof import("spessasynth_core").SpessaSynthProcessor>
    | undefined;
  let sequencer:
    | InstanceType<typeof import("spessasynth_core").SpessaSynthSequencer>
    | undefined;
  if (soundfontEventCount > 0) {
    if (
      sceneProcessor &&
      bundle.plan.voices.some(
        (voice) =>
          voice.engine === "soundfont" &&
          sceneProcessor.routeForVoice(voice) !== "master",
      )
    )
      throw new Error(
        "RenderScene@1 cannot route a shared SoundFont mix away from master; use sampler/synth candidates or a master route.",
      );
    if (!verified.soundfont)
      throw new Error(
        "The complete-piece execution requires a SoundFont asset.",
      );
    const {
      BasicMIDI,
      SoundBankLoader,
      SpessaSynthProcessor,
      SpessaSynthSequencer,
    } = await import("spessasynth_core");
    const midi = BasicMIDI.fromArrayBuffer(
      exactArrayBuffer(
        encodeExecutionMidi(bundle, { includeMasterGain: false }),
      ),
    );
    synthProcessor = new SpessaSynthProcessor(sampleRate, {
      eventsEnabled: false,
    });
    synthProcessor.soundBankManager.addSoundBank(
      SoundBankLoader.fromArrayBuffer(verified.soundfont),
      "refrain-block-render",
    );
    await synthProcessor.processorInitialized;
    synthProcessor.setSystemParameter("autoAllocateVoices", true);
    sequencer = new SpessaSynthSequencer(synthProcessor);
    sequencer.loadNewSongList([midi]);
    sequencer.play();
  }
  const activeSynth = new Map<number, ActiveSynth>();
  const activeSampler = new Map<number, ActiveSampler>();
  const renderFrames = Math.ceil(
    bundle.plan.renderDurationSeconds * sampleRate,
  );
  let nextEventIndex = 0;
  const masterGain =
    options.applyMasterGain === false || sceneProcessor
      ? 1
      : dbToGain(bundle.plan.resolvedRenderProfile.masterGainDb);
  for (
    let frameOffset = 0;
    frameOffset < renderFrames;
    frameOffset += blockFrames
  ) {
    if (options.isCancelled?.()) return;
    const frameCount = Math.min(blockFrames, renderFrames - frameOffset);
    const blockEnd = frameOffset + frameCount;
    const sceneBlocks = sceneProcessor?.createBlock(frameCount);
    let left = sceneBlocks?.get("master")?.left ?? new Float32Array(frameCount);
    let right =
      sceneBlocks?.get("master")?.right ?? new Float32Array(frameCount);
    if (sequencer && synthProcessor) {
      for (
        let quantumOffset = 0;
        quantumOffset < frameCount;
        quantumOffset += SOUNDFONT_RENDER_QUANTUM_FRAMES
      ) {
        sequencer.processTick();
        const quantumFrames = Math.min(
          SOUNDFONT_RENDER_QUANTUM_FRAMES,
          frameCount - quantumOffset,
        );
        synthProcessor.process(left, right, quantumOffset, quantumFrames);
      }
    }
    while (nextEventIndex < bundle.compiled.events.length) {
      const startFrame = Math.round(
        (bundle.compiled.events[nextEventIndex]!.startBeat * 60 * sampleRate) /
          bundle.compiled.tempo,
      );
      if (startFrame >= blockEnd) break;
      const event = performanceEventAt(bundle, nextEventIndex);
      const voice = voiceById.get(event.voiceId);
      if (!voice)
        throw new Error(`Execution voice ${event.voiceId} is absent.`);
      const endFrame = Math.ceil(
        (event.sample?.renderEndSeconds ??
          (event.noteOffBeat * 60) / bundle.compiled.tempo +
            (voice.patch?.release ?? 0)) * sampleRate,
      );
      if (voice.engine === "synth" && voice.patch) {
        activeSynth.set(nextEventIndex, {
          event,
          voice,
          patch: voice.patch,
          filter: synthFilter(voice.patch, sampleRate),
          endFrame,
        });
      } else if (voice.engine === "sampler" && event.sample) {
        activeSampler.set(nextEventIndex, { event, voice, endFrame });
      }
      nextEventIndex += 1;
    }
    for (const [eventIndex, active] of activeSynth) {
      const target = sceneProcessor
        ? sceneBlocks!.get(sceneProcessor.routeForVoice(active.voice))!
        : { left, right };
      mixSynth(
        active,
        frameOffset,
        target.left,
        target.right,
        sampleRate,
        bundle.compiled.tempo,
      );
      if (active.endFrame <= blockEnd) activeSynth.delete(eventIndex);
    }
    for (const [eventIndex, active] of activeSampler) {
      const target = sceneProcessor
        ? sceneBlocks!.get(sceneProcessor.routeForVoice(active.voice))!
        : { left, right };
      mixSampler(
        active,
        verified.samples,
        frameOffset,
        target.left,
        target.right,
        sampleRate,
        bundle.compiled.tempo,
      );
      if (active.endFrame <= blockEnd) activeSampler.delete(eventIndex);
    }
    if (masterGain !== 1) {
      for (let index = 0; index < frameCount; index += 1) {
        left[index] = left[index]! * masterGain;
        right[index] = right[index]! * masterGain;
      }
    }
    if (sceneProcessor) {
      const processed = sceneProcessor.processBlock(frameOffset, sceneBlocks!);
      left = processed.left;
      right = processed.right;
    }
    yield { frameOffset, frameCount, left, right };
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
