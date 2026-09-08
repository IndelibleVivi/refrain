import type { CompiledAir } from "@refrain/compiler";
import type { CompiledAirV1 } from "@refrain/compiler/v1";
import type { PerformanceBinding, SynthPatch } from "@refrain/soundpack";
import { envelopeLevel } from "./envelope.js";
import { verifyAssetBytes } from "./digest.js";
import { processSynthSample, synthFilter } from "./synth-kernel.js";
import {
  createPerformancePlan,
  type PerformanceEvent,
  type PerformancePlan,
  type AudioCompiledAir,
} from "./performance.js";
import { decodeWave, mixSamplerEvent } from "./sampler.js";

export interface PcmAudioData {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  durationSeconds: number;
}

export interface RenderedPcm extends PcmAudioData {
  verifiedAssets: VerifiedRequiredAsset[];
}

export interface VerifiedRequiredAsset {
  assetId: string;
  bytes: number;
  sha256: string;
}

export interface RenderPcmOptions {
  isCancelled?: () => boolean;
  yieldEveryQuanta?: number;
  applyMasterGain?: boolean;
  applyPeakCeiling?: boolean;
  performanceBinding?: PerformanceBinding;
  plan?: PerformancePlan;
}

export interface RenderAssetBundle {
  soundfont?: ArrayBuffer;
  samples?: Readonly<Record<string, ArrayBuffer>>;
}

export const AUDITION_PEAK_MATCH_CONTRACT =
  "refrain-audition-peak-match@0-experimental" as const;

export type WavAmplitudePolicy =
  | { mode: "native-gain" }
  | {
      mode: "audition-peak-matched";
      targetPeak: number;
      contract: typeof AUDITION_PEAK_MATCH_CONTRACT;
    };

export interface EncodePcmWavOptions {
  amplitude?: WavAmplitudePolicy;
}

const dbToGain = (db: number): number => 10 ** (db / 20);

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function mixSynthEvent(
  event: PerformanceEvent,
  patch: SynthPatch,
  tempo: number,
  sampleRate: number,
  left: Float32Array,
  right: Float32Array,
  options: RenderPcmOptions,
): Promise<boolean> {
  const startSeconds = (event.startBeat * 60) / tempo;
  const noteDuration = (event.soundingDurationBeats * 60) / tempo;
  const startSample = Math.floor(startSeconds * sampleRate);
  const voiceSamples = Math.ceil((noteDuration + patch.release) * sampleRate);
  const frequency = 440 * 2 ** ((event.midi - 69) / 12);
  const gain = dbToGain(event.effectiveGainDb) * event.performanceVelocity;
  const pan = Math.max(-1, Math.min(1, event.pan));
  const leftPan = Math.cos(((pan + 1) * Math.PI) / 4);
  const rightPan = Math.sin(((pan + 1) * Math.PI) / 4);
  const filter = synthFilter(patch, sampleRate);

  for (
    let offset = 0;
    offset < voiceSamples && startSample + offset < left.length;
    offset += 1
  ) {
    if (offset % 8192 === 0) {
      if (options.isCancelled?.()) return false;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const time = offset / sampleRate;
    const envelope = envelopeLevel(time, noteDuration, patch);
    if (envelope <= 0) continue;
    const filtered = processSynthSample(patch, filter, time, frequency);
    const value = filtered * envelope * gain;
    left[startSample + offset]! += value * leftPan;
    right[startSample + offset]! += value * rightPan;
  }
  return true;
}

export function attenuatePeak(
  left: Float32Array,
  right: Float32Array,
  ceiling = 0.72,
): number {
  let peak = 0;
  for (let index = 0; index < left.length; index += 1) {
    peak = Math.max(
      peak,
      Math.abs(left[index] ?? 0),
      Math.abs(right[index] ?? 0),
    );
  }
  if (peak === 0 || peak <= ceiling) return 1;
  const scale = ceiling / peak;
  for (let index = 0; index < left.length; index += 1) {
    left[index] = (left[index] ?? 0) * scale;
    right[index] = (right[index] ?? 0) * scale;
  }
  return scale;
}

function applyGain(
  left: Float32Array,
  right: Float32Array,
  gain: number,
): void {
  if (gain === 1) return;
  for (let index = 0; index < left.length; index += 1) {
    left[index] = (left[index] ?? 0) * gain;
    right[index] = (right[index] ?? 0) * gain;
  }
}

export async function renderPcm(
  compiled: AudioCompiledAir,
  suppliedAssets: ArrayBuffer | RenderAssetBundle,
  sampleRate = 44_100,
  options: RenderPcmOptions = {},
): Promise<RenderedPcm | undefined> {
  if (options.isCancelled?.()) return undefined;
  const assets: RenderAssetBundle =
    suppliedAssets instanceof ArrayBuffer
      ? { soundfont: suppliedAssets }
      : suppliedAssets;
  const plan =
    options.plan ??
    createPerformancePlan(compiled, {
      ...(options.performanceBinding === undefined
        ? {}
        : { performanceBinding: options.performanceBinding }),
    });
  const durationSeconds = plan.durationSeconds;
  const sampleCount = Math.ceil(durationSeconds * sampleRate);
  const left = new Float32Array(sampleCount);
  const right = new Float32Array(sampleCount);
  const voiceById = new Map(plan.voices.map((voice) => [voice.voiceId, voice]));
  const sampledEvents = plan.events.filter(
    (event) => voiceById.get(event.voiceId)?.engine === "soundfont",
  );
  const verifiedAssets: VerifiedRequiredAsset[] = [];
  const verifiedSamples: Record<string, ArrayBuffer> = {};
  let verifiedSoundfont: ArrayBuffer | undefined;
  for (const required of plan.requiredAssets) {
    const supplied =
      required.kind === "soundfont"
        ? assets.soundfont
        : assets.samples?.[required.assetId];
    if (!supplied) {
      throw new Error(
        required.kind === "soundfont"
          ? "The selected performance requires a SoundFont asset."
          : `Sampler asset ${required.assetId} was not supplied.`,
      );
    }
    const verified = await verifyAssetBytes(required, supplied);
    verifiedAssets.push({
      assetId: verified.assetId,
      bytes: verified.bytes,
      sha256: verified.sha256,
    });
    if (required.kind === "soundfont") verifiedSoundfont = verified.data;
    else verifiedSamples[required.assetId] = verified.data;
  }

  if (sampledEvents.length > 0) {
    if (!verifiedSoundfont) {
      throw new Error("The selected performance requires a SoundFont asset.");
    }
    const [midiModule, spessaSynth] = await Promise.all([
      import("./midi.js"),
      import("spessasynth_core"),
    ]);
    const {
      BasicMIDI,
      SoundBankLoader,
      SpessaSynthProcessor,
      SpessaSynthSequencer,
    } = spessaSynth;
    const sampledCompiled: AudioCompiledAir = {
      ...compiled,
      events: sampledEvents,
    } as AudioCompiledAir;
    const sampledPlan: PerformancePlan = {
      ...plan,
      compiled: sampledCompiled,
      voices: plan.voices.filter((voice) => voice.engine === "soundfont"),
      events: sampledEvents,
    };
    const midi = BasicMIDI.fromArrayBuffer(
      exactArrayBuffer(
        midiModule.encodeMidi(sampledCompiled, sampledPlan, {
          includeMasterGain: false,
        }),
      ),
    );
    const synth = new SpessaSynthProcessor(sampleRate, {
      eventsEnabled: false,
    });
    synth.soundBankManager.addSoundBank(
      SoundBankLoader.fromArrayBuffer(verifiedSoundfont),
      "refrain-render",
    );
    await synth.processorInitialized;
    synth.setSystemParameter("autoAllocateVoices", true);
    const sequencer = new SpessaSynthSequencer(synth);
    sequencer.loadNewSongList([midi]);
    sequencer.play();
    const quantum = 128;
    const yieldEvery = options.yieldEveryQuanta ?? 128;
    for (let offset = 0; offset < sampleCount; offset += quantum) {
      const quantumIndex = offset / quantum;
      if (quantumIndex % yieldEvery === 0) {
        if (options.isCancelled?.()) return undefined;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      const count = Math.min(quantum, sampleCount - offset);
      sequencer.processTick();
      synth.process(left, right, offset, count);
    }
  }

  for (const event of plan.events) {
    const voice = voiceById.get(event.voiceId);
    if (voice?.engine === "synth" && voice.patch) {
      const completed = await mixSynthEvent(
        event,
        voice.patch,
        compiled.tempo,
        sampleRate,
        left,
        right,
        options,
      );
      if (!completed) return undefined;
    }
  }
  const decodedSamples = new Map<string, ReturnType<typeof decodeWave>>();
  for (const required of plan.requiredAssets) {
    if (required.kind !== "wav") continue;
    const bytes = verifiedSamples[required.assetId];
    if (!bytes) {
      throw new Error(`Sampler asset ${required.assetId} was not supplied.`);
    }
    decodedSamples.set(required.assetId, decodeWave(bytes));
  }
  for (const event of plan.events) {
    const voice = voiceById.get(event.voiceId);
    if (voice?.engine !== "sampler" || !event.sample) continue;
    mixSamplerEvent(
      event,
      voice,
      decodedSamples,
      compiled.tempo,
      sampleRate,
      left,
      right,
    );
  }
  if (options.applyMasterGain ?? true) {
    applyGain(left, right, dbToGain(plan.resolvedRenderProfile.masterGainDb));
  }
  if (options.applyPeakCeiling ?? true) {
    attenuatePeak(left, right, plan.resolvedRenderProfile.peakCeiling);
  }
  return {
    left,
    right,
    sampleRate,
    durationSeconds,
    verifiedAssets: verifiedAssets.sort((left, right) =>
      left.assetId.localeCompare(right.assetId),
    ),
  };
}

export async function renderWav(
  compiled: AudioCompiledAir,
  assets: ArrayBuffer | RenderAssetBundle,
  sampleRate = 44_100,
  options: RenderPcmOptions = {},
): Promise<ArrayBuffer> {
  const pcm = await renderPcm(compiled, assets, sampleRate, options);
  if (!pcm) throw new Error("Unexpected cancellation without a render signal.");
  return encodePcmWav(pcm);
}

export function encodePcmWav(
  pcm: PcmAudioData,
  options: EncodePcmWavOptions = {},
): ArrayBuffer {
  const channels = [pcm.left, pcm.right] as const;
  const channelCount = channels.length;
  const bytesPerSample = 2;
  const dataSize = pcm.left.length * channelCount * bytesPerSample;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);

  bytes.set([82, 73, 70, 70], 0); // RIFF
  view.setUint32(4, bytes.byteLength - 8, true);
  bytes.set([87, 65, 86, 69], 8); // WAVE
  bytes.set([102, 109, 116, 32], 12); // fmt
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, pcm.sampleRate, true);
  view.setUint32(28, pcm.sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  bytes.set([100, 97, 116, 97], 36); // data
  view.setUint32(40, dataSize, true);

  let maxAbsValue = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      maxAbsValue = Math.max(maxAbsValue, Math.abs(sample));
    }
  }
  const amplitude = options.amplitude ?? { mode: "native-gain" };
  if (
    amplitude.mode === "audition-peak-matched" &&
    (!Number.isFinite(amplitude.targetPeak) ||
      amplitude.targetPeak <= 0 ||
      amplitude.targetPeak > 1)
  ) {
    throw new Error(
      "Audition targetPeak must be greater than 0 and at most 1.",
    );
  }
  const multiplier =
    amplitude.mode === "audition-peak-matched" && maxAbsValue > 0
      ? (32_767 * amplitude.targetPeak) / maxAbsValue
      : 32_767;
  let offset = 44;
  for (let index = 0; index < pcm.left.length; index += 1) {
    for (const channel of channels) {
      const sample = Math.min(
        32_767,
        Math.max(-32_768, (channel[index] ?? 0) * multiplier),
      );
      bytes[offset] = sample & 0xff;
      bytes[offset + 1] = (sample >> 8) & 0xff;
      offset += bytesPerSample;
    }
  }
  return bytes.buffer;
}
