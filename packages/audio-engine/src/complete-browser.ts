import type { SynthPatch } from "@refrain/soundpack";
import { sceneRouteForVoice } from "./scene-routing.js";
import type { RenderSceneV1, SceneProcessor } from "@refrain/soundpack/vnext";
import { envelopeLevel, heldEnvelopeLevel } from "./envelope.js";
import { encodeExecutionMidi } from "./midi.js";
import {
  createExecutionCursor,
  ExecutionTransportController,
  activeEventIndexesAt,
  pullExecutionWindow,
  reconstructExecutionEventAt,
  sectionFrame,
  type TransportSnapshotV0,
} from "./execution-transport.js";
import {
  createPreparationPlan,
  performanceEventAt,
  REFERENCE_SAMPLE_RATE,
  type AssetRequirementV3,
  type ExecutionBundle,
  type PreparationPlanV0,
} from "./execution.js";
import type { PerformanceEvent, PerformanceVoice } from "./performance.js";
import { synthOscillatorProjection } from "./synth-kernel.js";
import {
  VerifiedAssetStore,
  type AssetPreparationEvidence,
  type DecodedExecutionAsset,
} from "./verified-asset-store.js";
import {
  OperationAuthority,
  type OperationToken,
} from "./operation-authority.js";

type WorkletSynthesizer = import("spessasynth_lib").WorkletSynthesizer;
type Sequencer = import("spessasynth_lib").Sequencer;

export interface CompletePieceBrowserOptions {
  soundBankUrl?: string;
  assetBaseUrl?: string;
  workletUrl?: string;
}

export type CompletePieceBrowserAdapter =
  "direct-nodes@1" | "worklet-soundfont@0+direct-nodes@1";

type TransportOperation =
  | "play"
  | "pause"
  | "resume"
  | "seek"
  | "restart"
  | "stop"
  | "buffer"
  | "prefetch"
  | "destroy";

export interface PlaybackEvidenceV0 {
  format: "refrain-playback-evidence@0-experimental";
  performancePlanSha256: string;
  adapter: CompletePieceBrowserAdapter;
  commandReceivedAtMs: number;
  planReadyMs: number;
  openingBytesVerifiedMs: number;
  openingDecodedMs: number;
  adapterReadyMs: number;
  firstFrameScheduledMs: number;
  firstGraphSoundMs?: number;
  firstGraphSoundObserved: boolean;
  openingAssets: AssetPreparationEvidence[];
  deferredAssetCount: number;
  adaptationNotes: string[];
}

type BrowserDecodedAsset =
  | {
      kind: "wav";
      buffer: AudioBuffer;
      loopBuffers: Map<string, AudioBuffer>;
    }
  | { kind: "soundfont"; bytes: ArrayBuffer };

interface BrowserLoopProjection {
  key: string;
  startFrame: number;
  endFrame: number;
  crossfadeFrames: number;
}

interface ActiveSynthVoice {
  oscillators: OscillatorNode[];
  gain: GainNode;
}

interface BrowserSceneProcessorGraph {
  input: GainNode;
  output: AudioNode;
  fade?: {
    node: GainNode;
    processor: Extract<SceneProcessor, { type: "fade" }>;
  };
}

const dbToGain = (db: number): number => 10 ** (db / 20);

function now(): number {
  return globalThis.performance.now();
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function audioBufferBytes(buffer: AudioBuffer): number {
  return (
    buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT
  );
}

function loopProjectionKey(
  assetId: string,
  startFrame: number,
  endFrame: number,
  crossfadeFrames: number,
): string {
  return `${assetId}:${startFrame}:${endFrame}:${crossfadeFrames}`;
}

function createLimiter(
  context: AudioContext,
  peakCeiling: number,
): DynamicsCompressorNode {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = 20 * Math.log10(peakCeiling);
  limiter.knee.value = 3;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.24;
  return limiter;
}

function browserSceneProcessor(
  context: AudioContext,
  processor: SceneProcessor,
): BrowserSceneProcessorGraph {
  const input = context.createGain();
  if (processor.type === "gain-pan") {
    const gain = context.createGain();
    gain.gain.value = dbToGain(processor.gainDb);
    const splitter = context.createChannelSplitter(2);
    const merger = context.createChannelMerger(2);
    const a = (1 + processor.width) / 2;
    const b = (1 - processor.width) / 2;
    const matrix = [a, b, b, a].map((coefficient) => {
      const node = context.createGain();
      node.gain.value = coefficient;
      return node;
    });
    const panner = context.createStereoPanner();
    panner.pan.value = processor.pan;
    input.connect(gain).connect(splitter);
    splitter.connect(matrix[0]!, 0);
    matrix[0]!.connect(merger, 0, 0);
    splitter.connect(matrix[1]!, 1);
    matrix[1]!.connect(merger, 0, 0);
    splitter.connect(matrix[2]!, 0);
    matrix[2]!.connect(merger, 0, 1);
    splitter.connect(matrix[3]!, 1);
    matrix[3]!.connect(merger, 0, 1);
    merger.connect(panner);
    return { input, output: panner };
  }
  if (processor.type === "lowpass") {
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = processor.frequencyHz;
    filter.Q.value = processor.q;
    input.connect(filter);
    return { input, output: filter };
  }
  if (processor.type === "saturation") {
    const output = context.createGain();
    const dry = context.createGain();
    const wet = context.createGain();
    const shaper = context.createWaveShaper();
    const curve = new Float32Array(2_049);
    const normalizer = Math.tanh(processor.drive);
    for (let index = 0; index < curve.length; index += 1) {
      const value = (index / (curve.length - 1)) * 2 - 1;
      curve[index] = Math.tanh(value * processor.drive) / normalizer;
    }
    shaper.curve = curve;
    shaper.oversample = "2x";
    dry.gain.value = 1 - processor.mix;
    wet.gain.value = processor.mix;
    input.connect(dry).connect(output);
    input.connect(shaper).connect(wet).connect(output);
    return { input, output };
  }
  if (processor.type === "delay") {
    const output = context.createGain();
    const dry = context.createGain();
    const wet = context.createGain();
    const delay = context.createDelay(2);
    const feedback = context.createGain();
    dry.gain.value = 1 - processor.mix;
    wet.gain.value = processor.mix;
    delay.delayTime.value = processor.delayMs / 1_000;
    feedback.gain.value = processor.feedback;
    input.connect(dry).connect(output);
    input.connect(delay).connect(wet).connect(output);
    delay.connect(feedback).connect(delay);
    return { input, output };
  }
  if (processor.type === "room") {
    const output = context.createGain();
    const dry = context.createGain();
    dry.gain.value = 1 - processor.mix;
    input.connect(dry).connect(output);
    for (const seconds of [0.0297, 0.0371, 0.0411]) {
      const delay = context.createDelay(0.1);
      const feedback = context.createGain();
      const wet = context.createGain();
      delay.delayTime.value = seconds;
      feedback.gain.value = Math.exp((-3 * seconds) / processor.decaySeconds);
      wet.gain.value = processor.mix / 3;
      input.connect(delay).connect(wet).connect(output);
      delay.connect(feedback).connect(delay);
    }
    return { input, output };
  }
  const fade = context.createGain();
  input.connect(fade);
  return { input, output: fade, fade: { node: fade, processor } };
}

function phaseShiftedPeriodicWave(
  context: AudioContext,
  type: OscillatorType,
  phaseCycles: number,
): PeriodicWave {
  const harmonics = type === "sine" ? 1 : 64;
  const real = new Float32Array(harmonics + 1);
  const imaginary = new Float32Array(harmonics + 1);
  for (let harmonic = 1; harmonic <= harmonics; harmonic += 1) {
    let coefficient = 0;
    if (type === "sine") coefficient = harmonic === 1 ? 1 : 0;
    else if (type === "square" && harmonic % 2 === 1)
      coefficient = 4 / (Math.PI * harmonic);
    else if (type === "sawtooth")
      coefficient = (2 * (harmonic % 2 === 0 ? -1 : 1)) / (Math.PI * harmonic);
    else if (type === "triangle" && harmonic % 2 === 1)
      coefficient =
        (8 * (harmonic % 4 === 1 ? 1 : -1)) / (Math.PI ** 2 * harmonic ** 2);
    const rotation = phaseCycles * harmonic * Math.PI * 2;
    real[harmonic] = coefficient * Math.sin(rotation);
    imaginary[harmonic] = coefficient * Math.cos(rotation);
  }
  return context.createPeriodicWave(real, imaginary, {
    disableNormalization: false,
  });
}

export class CompletePieceBrowserEngine {
  readonly context: AudioContext;
  readonly preparation: PreparationPlanV0;
  readonly bundle: ExecutionBundle;
  private readonly options: CompletePieceBrowserOptions;
  private readonly transportController: ExecutionTransportController;
  private readonly master: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly sceneBusInputs = new Map<string, GainNode>();
  private readonly sceneFades: Array<{
    node: GainNode;
    processor: Extract<SceneProcessor, { type: "fade" }>;
  }> = [];
  private readonly assetStore: VerifiedAssetStore<BrowserDecodedAsset>;
  private readonly runtimePaths: Map<string, string>;
  private readonly voiceById: Map<string, PerformanceVoice>;
  private readonly listeners = new Set<(value: TransportSnapshotV0) => void>();
  private sampleSynth?: WorkletSynthesizer;
  private sequencer?: Sequencer;
  private adapter: CompletePieceBrowserAdapter = "direct-nodes@1";
  private generation = 0;
  private originAudioTime = 0;
  private originFrame = 0;
  private cancelSchedule?: () => void;
  private prefetchController?: AbortController;
  private readonly activeSynth = new Set<ActiveSynthVoice>();
  private readonly activeSamples = new Set<AudioBufferSourceNode>();
  private readonly loopProjectionsByAsset = new Map<
    string,
    BrowserLoopProjection[]
  >();
  private readonly operations = new OperationAuthority<TransportOperation>();
  private bufferPromise?: Promise<void>;
  private endedTimer?: number;
  private destroyed = false;

  private constructor(
    context: AudioContext,
    bundle: ExecutionBundle,
    options: CompletePieceBrowserOptions,
  ) {
    this.context = context;
    this.bundle = bundle;
    this.options = options;
    this.preparation = createPreparationPlan(bundle);
    this.transportController = new ExecutionTransportController(bundle);
    this.runtimePaths = new Map(
      bundle.runtimeAssets.map((asset) => [asset.assetId, asset.localPath]),
    );
    this.voiceById = new Map(
      bundle.plan.voices.map((voice) => [voice.voiceId, voice]),
    );
    for (
      let eventIndex = 0;
      eventIndex < bundle.compiled.events.length;
      eventIndex += 1
    ) {
      const sample = performanceEventAt(bundle, eventIndex).sample;
      if (
        !sample ||
        sample.loop.mode !== "sustain" ||
        !sample.loop.crossfadeFrames
      )
        continue;
      const projection: BrowserLoopProjection = {
        key: loopProjectionKey(
          sample.attackAssetId,
          sample.loop.startFrame,
          sample.loop.endFrame,
          sample.loop.crossfadeFrames,
        ),
        startFrame: sample.loop.startFrame,
        endFrame: sample.loop.endFrame,
        crossfadeFrames: sample.loop.crossfadeFrames,
      };
      const projections =
        this.loopProjectionsByAsset.get(sample.attackAssetId) ?? [];
      if (!projections.some(({ key }) => key === projection.key))
        projections.push(projection);
      this.loopProjectionsByAsset.set(sample.attackAssetId, projections);
    }
    this.master = context.createGain();
    this.master.gain.value = dbToGain(
      bundle.plan.resolvedRenderProfile.masterGainDb,
    );
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 256;
    this.limiter = createLimiter(
      context,
      bundle.plan.resolvedRenderProfile.peakCeiling,
    );
    this.master.connect(this.analyser).connect(this.limiter);
    this.limiter.connect(context.destination);
    const scene = bundle.plan.performanceBinding.renderScene;
    if (scene.format === "refrain-render-scene@1-experimental") {
      const busOutputs = new Map<string, AudioNode>();
      for (const bus of scene.buses) {
        const busInput = context.createGain();
        this.sceneBusInputs.set(bus.id, busInput);
        let tail: AudioNode = busInput;
        for (const processor of bus.processors) {
          const graph = browserSceneProcessor(context, processor);
          tail.connect(graph.input);
          tail = graph.output;
          if (graph.fade) this.sceneFades.push(graph.fade);
        }
        busOutputs.set(bus.id, tail);
      }
      for (const bus of scene.buses) {
        const output =
          bus.output === "master"
            ? this.master
            : this.sceneBusInputs.get(bus.output);
        if (!output)
          throw new Error(`RenderScene@1 bus ${bus.id} has no output node.`);
        busOutputs.get(bus.id)!.connect(output);
      }
      for (const voice of bundle.plan.voices) {
        if (
          voice.engine === "soundfont" &&
          this.destinationForVoice(voice) !== this.master
        )
          throw new Error(
            "RenderScene@1 cannot route a shared SoundFont mix away from master; use sampler/synth candidates or a master route.",
          );
      }
    }
    this.assetStore = new VerifiedAssetStore<BrowserDecodedAsset>({
      requirements: bundle.plan.assetRequirements,
      maxConcurrentFetches: this.preparation.policy.maxConcurrentFetches,
      maxConcurrentDecodes: this.preparation.policy.maxConcurrentDecodes,
      rawCacheBudgetBytes: this.preparation.policy.rawCacheBudgetBytes,
      decodedCacheBudgetBytes: this.preparation.policy.decodedCacheBudgetBytes,
      fetchBytes: (requirement, signal) => this.fetchAsset(requirement, signal),
      decode: (requirement, bytes, signal) =>
        this.decodeAsset(requirement, bytes, signal),
    });
  }

  static async create(
    bundle: ExecutionBundle,
    options: CompletePieceBrowserOptions,
  ): Promise<CompletePieceBrowserEngine> {
    const context = new AudioContext({
      latencyHint: "interactive",
      sampleRate: REFERENCE_SAMPLE_RATE,
    });
    try {
      await context.resume();
      return new CompletePieceBrowserEngine(context, bundle, options);
    } catch (cause) {
      await context.close();
      throw cause;
    }
  }

  get mode(): CompletePieceBrowserAdapter {
    return this.adapter;
  }

  private beginOperation(
    kind: TransportOperation,
  ): OperationToken<TransportOperation> {
    if (this.destroyed) throw new Error("The audio engine is destroyed.");
    this.prefetchController?.abort();
    this.prefetchController = undefined;
    return this.operations.begin(kind);
  }

  private failCurrentOperation(
    token: OperationToken<TransportOperation>,
  ): void {
    if (!this.operations.isCurrent(token)) return;
    this.haltPlayback();
    this.transportController.command({ type: "fail" });
    this.emit();
  }

  private finishOperation(token: OperationToken<TransportOperation>): void {
    this.operations.finish(token);
  }

  private cancelOperations(kind: TransportOperation): void {
    this.prefetchController?.abort();
    this.prefetchController = undefined;
    this.operations.cancel(kind);
  }

  get transport(): TransportSnapshotV0 {
    const snapshot = this.transportController.snapshot();
    if (snapshot.status !== "playing") return snapshot;
    const positionFrame =
      this.originFrame +
      Math.round(
        (this.context.currentTime - this.originAudioTime) *
          REFERENCE_SAMPLE_RATE,
      );
    return this.transportController.command({
      type: "advance",
      positionFrame,
    });
  }

  private destinationForVoice(voice: PerformanceVoice): AudioNode {
    const scene = this.bundle.plan.performanceBinding.renderScene;
    if (scene.format !== "refrain-render-scene@1-experimental")
      return this.master;
    const bus = sceneRouteForVoice(scene, voice)?.bus ?? "master";
    return bus === "master"
      ? this.master
      : (this.sceneBusInputs.get(bus) ?? this.master);
  }

  private scheduleSceneFades(baseTime: number, targetSeconds: number): void {
    const musicalDuration = this.bundle.compiled.durationSeconds;
    for (const { node, processor } of this.sceneFades) {
      const valueAtTarget =
        targetSeconds < processor.inSeconds && processor.inSeconds > 0
          ? targetSeconds / processor.inSeconds
          : targetSeconds > musicalDuration - processor.outSeconds &&
              processor.outSeconds + processor.tailSeconds > 0
            ? Math.max(
                0,
                (musicalDuration + processor.tailSeconds - targetSeconds) /
                  (processor.outSeconds + processor.tailSeconds),
              )
            : 1;
      node.gain.cancelScheduledValues(baseTime);
      node.gain.setValueAtTime(valueAtTarget, baseTime);
      if (targetSeconds < processor.inSeconds)
        node.gain.linearRampToValueAtTime(
          1,
          baseTime + processor.inSeconds - targetSeconds,
        );
      const fadeOutStart = musicalDuration - processor.outSeconds;
      if (targetSeconds < fadeOutStart)
        node.gain.setValueAtTime(1, baseTime + fadeOutStart - targetSeconds);
      if (targetSeconds < musicalDuration + processor.tailSeconds)
        node.gain.linearRampToValueAtTime(
          0,
          baseTime + musicalDuration + processor.tailSeconds - targetSeconds,
        );
    }
  }

  subscribeTransport(
    listener: (value: TransportSnapshotV0) => void,
  ): () => void {
    this.listeners.add(listener);
    listener(this.transport);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.transport;
    for (const listener of this.listeners) listener(snapshot);
  }

  private assetUrl(requirement: AssetRequirementV3): string {
    const localPath = this.runtimePaths.get(requirement.assetId);
    if (!localPath)
      throw new Error(`No runtime locator exists for ${requirement.assetId}.`);
    if (requirement.kind === "soundfont" && this.options.soundBankUrl)
      return this.options.soundBankUrl;
    const base = this.options.assetBaseUrl?.replace(/\/$/, "") ?? "";
    return `${base}/${localPath}`;
  }

  private async fetchAsset(
    requirement: AssetRequirementV3,
    signal: AbortSignal,
  ): Promise<ArrayBuffer> {
    const response = await fetch(this.assetUrl(requirement), { signal });
    if (!response.ok)
      throw new Error(
        `${requirement.assetId} failed to load: HTTP ${response.status}`,
      );
    return response.arrayBuffer();
  }

  private async decodeAsset(
    requirement: AssetRequirementV3,
    bytes: ArrayBuffer,
    signal: AbortSignal,
  ): Promise<DecodedExecutionAsset<BrowserDecodedAsset>> {
    if (signal.aborted) throw signal.reason;
    if (requirement.kind === "soundfont") {
      return {
        value: { kind: "soundfont", bytes },
        decodedBytes: bytes.byteLength,
      };
    }
    const buffer = await this.context.decodeAudioData(bytes);
    if (signal.aborted) throw signal.reason;
    const loopBuffers = new Map<string, AudioBuffer>();
    let decodedBytes = audioBufferBytes(buffer);
    for (const projection of this.loopProjectionsByAsset.get(
      requirement.assetId,
    ) ?? []) {
      const projected = this.context.createBuffer(
        buffer.numberOfChannels,
        buffer.length,
        buffer.sampleRate,
      );
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const source = buffer.getChannelData(channel);
        const target = projected.getChannelData(channel);
        target.set(source);
        for (let index = 0; index < projection.crossfadeFrames; index += 1) {
          const progress = (index + 1) / projection.crossfadeFrames;
          const tailIndex =
            projection.endFrame - projection.crossfadeFrames + index;
          target[tailIndex] =
            source[tailIndex]! * (1 - progress) +
            source[projection.startFrame + index]! * progress;
        }
      }
      loopBuffers.set(projection.key, projected);
      decodedBytes += audioBufferBytes(projected);
    }
    return {
      value: { kind: "wav", buffer, loopBuffers },
      decodedBytes,
    };
  }

  private async ensureAdapterReady(
    token: OperationToken<TransportOperation>,
  ): Promise<void> {
    this.operations.assertCurrent(token);
    const soundfontRequirement = this.bundle.plan.assetRequirements.find(
      (asset) => asset.kind === "soundfont",
    );
    if (!soundfontRequirement) {
      this.adapter = "direct-nodes@1";
      return;
    }
    if (this.sampleSynth && this.sequencer) return;
    const decoded = this.assetStore.decoded(soundfontRequirement.assetId);
    if (!decoded || decoded.kind !== "soundfont")
      throw new Error(
        "The verified SoundFont opening dependency is not ready.",
      );
    if (!this.options.workletUrl)
      throw new Error(
        "SoundFont playback requires the AudioWorklet module URL.",
      );
    await this.context.audioWorklet.addModule(this.options.workletUrl);
    this.operations.assertCurrent(token);
    const { Sequencer, WorkletSynthesizer } = await import("spessasynth_lib");
    this.operations.assertCurrent(token);
    const synth = new WorkletSynthesizer(this.context);
    try {
      await synth.isReady;
      this.operations.assertCurrent(token);
      await synth.soundBankManager.addSoundBank(
        decoded.bytes.slice(0),
        "refrain-complete-piece",
      );
      this.operations.assertCurrent(token);
      synth.connect(this.master);
      const sequencer = new Sequencer(synth, { skipToFirstNoteOn: false });
      sequencer.skipToFirstNoteOn = false;
      sequencer.loadNewSongList([
        {
          binary: exactArrayBuffer(
            encodeExecutionMidi(this.bundle, { includeMasterGain: false }),
          ),
          fileName: "refrain-complete-piece.mid",
        },
      ]);
      this.sampleSynth = synth;
      this.sequencer = sequencer;
      this.adapter = "worklet-soundfont@0+direct-nodes@1";
    } catch (cause) {
      synth.destroy();
      throw cause;
    }
  }

  private assetIdsAround(frame: number): string[] {
    const seconds = frame / REFERENCE_SAMPLE_RATE;
    const horizon = seconds + this.preparation.policy.prefetchLeadSeconds;
    return this.bundle.plan.assetRequirements
      .filter(
        (asset) =>
          asset.firstUseSeconds <= horizon && asset.lastUseSeconds >= seconds,
      )
      .map((asset) => asset.assetId);
  }

  private startAssetIds(assetIds: readonly string[]): string[] {
    const ids = new Set(assetIds);
    const soundfont = this.bundle.plan.assetRequirements.find(
      (asset) => asset.kind === "soundfont",
    );
    if (soundfont) ids.add(soundfont.assetId);
    return [...ids];
  }

  private startPrefetch(excluding: ReadonlySet<string>): void {
    this.prefetchController?.abort();
    const controller = new AbortController();
    this.prefetchController = controller;
    const deferred = this.preparation.assets
      .filter((asset) => !excluding.has(asset.assetId))
      .sort(
        (left, right) =>
          left.deadlineSeconds - right.deadlineSeconds ||
          left.priorityRank - right.priorityRank,
      );
    void (async () => {
      for (const asset of deferred) {
        if (controller.signal.aborted) return;
        try {
          await this.assetStore.prepare(asset.assetId, controller.signal);
        } catch (cause) {
          if (
            !controller.signal.aborted &&
            this.prefetchController === controller
          ) {
            this.prefetchController = undefined;
            this.operations.cancel("prefetch");
            this.haltPlayback();
            this.transportController.command({ type: "fail" });
            this.emit();
          }
          return;
        }
      }
      if (this.prefetchController === controller)
        this.prefetchController = undefined;
    })();
  }

  async play(): Promise<PlaybackEvidenceV0> {
    const snapshot = this.transport;
    return this.playAt(
      snapshot.status === "paused"
        ? snapshot.positionFrame / REFERENCE_SAMPLE_RATE
        : 0,
    );
  }

  async playAt(seconds: number): Promise<PlaybackEvidenceV0> {
    if (!Number.isFinite(seconds))
      throw new Error("Playback start time must be a finite number.");
    const operation = this.beginOperation("play");
    const commandReceivedAtMs = now();
    try {
      const targetFrame = Math.max(
        0,
        Math.min(
          Math.round(seconds * REFERENCE_SAMPLE_RATE),
          Math.round(
            this.bundle.plan.renderDurationSeconds * REFERENCE_SAMPLE_RATE,
          ),
        ),
      );
      this.transportController.command({ type: "prepare", targetFrame });
      this.emit();
      const planReadyMs = now() - commandReceivedAtMs;
      const openingIds = this.startAssetIds(
        targetFrame === 0
          ? this.preparation.openingClosure
          : this.assetIdsAround(targetFrame),
      );
      const openingAssets = await this.assetStore.prepareMany(
        openingIds,
        operation.signal,
      );
      this.operations.assertCurrent(operation);
      const openingBytesVerifiedMs = now() - commandReceivedAtMs;
      const openingDecodedMs = openingBytesVerifiedMs;
      await this.ensureAdapterReady(operation);
      this.operations.assertCurrent(operation);
      const adapterReadyMs = now() - commandReceivedAtMs;
      this.startPrefetch(new Set(openingIds));
      const firstGraphSound = this.observeFirstGraphSound(
        commandReceivedAtMs,
        operation.signal,
      );
      this.operations.assertCurrent(operation);
      this.startAt(targetFrame);
      const firstFrameScheduledMs = now() - commandReceivedAtMs;
      const firstGraphSoundMs = await firstGraphSound;
      this.operations.assertCurrent(operation);
      return {
        format: "refrain-playback-evidence@0-experimental",
        performancePlanSha256: this.bundle.planSha256,
        adapter: this.adapter,
        commandReceivedAtMs,
        planReadyMs,
        openingBytesVerifiedMs,
        openingDecodedMs,
        adapterReadyMs,
        firstFrameScheduledMs,
        ...(firstGraphSoundMs === undefined ? {} : { firstGraphSoundMs }),
        firstGraphSoundObserved: firstGraphSoundMs !== undefined,
        openingAssets,
        deferredAssetCount:
          this.bundle.plan.assetRequirements.length - openingIds.length,
        adaptationNotes: [
          "Realtime safety uses the renderer@1 causal browser limiter; deterministic Node WAV uses the two-pass reference peak policy.",
          "Worklet SoundFont seeking uses the installed sequencer state restoration and remains binding-preserving.",
        ],
      };
    } catch (cause) {
      this.failCurrentOperation(operation);
      throw cause;
    } finally {
      this.finishOperation(operation);
    }
  }

  private startAt(targetFrame: number): void {
    this.haltDirectNodes();
    this.generation += 1;
    const generation = this.generation;
    const targetSeconds = targetFrame / REFERENCE_SAMPLE_RATE;
    if (this.sequencer) {
      this.sequencer.currentTime = targetSeconds;
      this.sequencer.play();
    }
    const baseTime = this.context.currentTime + 0.08;
    this.scheduleSceneFades(baseTime, targetSeconds);
    this.originAudioTime = baseTime;
    this.originFrame = targetFrame;
    this.transportController.command({ type: "seek", targetFrame });
    this.transportController.command({ type: "play" });
    for (const eventIndex of activeEventIndexesAt(this.bundle, targetFrame)) {
      const reconstructed = reconstructExecutionEventAt(
        this.bundle,
        eventIndex,
        targetFrame,
      );
      if (reconstructed)
        this.scheduleDirectEvent(
          eventIndex,
          reconstructed.event,
          baseTime,
          reconstructed.state.elapsedFrames / REFERENCE_SAMPLE_RATE,
          reconstructed.state.phase,
          reconstructed.state.phase === "release"
            ? Math.max(
                0,
                (targetFrame - this.bundle.index.noteOffFrames[eventIndex]!) /
                  REFERENCE_SAMPLE_RATE,
              )
            : 0,
        );
    }
    const cursor = createExecutionCursor(this.bundle, targetFrame, generation);
    let timer: number | undefined;
    let cancelled = false;
    let lastEmittedFrame = targetFrame;
    const tick = () => {
      if (cancelled || generation !== this.generation) return;
      const nowFrame =
        targetFrame +
        Math.max(
          0,
          Math.round(
            (this.context.currentTime - baseTime) * REFERENCE_SAMPLE_RATE,
          ),
        );
      const horizonFrame = nowFrame + Math.round(0.25 * REFERENCE_SAMPLE_RATE);
      const executionWindow = pullExecutionWindow(
        this.bundle,
        cursor,
        nowFrame,
        horizonFrame,
      );
      if (nowFrame - lastEmittedFrame >= REFERENCE_SAMPLE_RATE / 5) {
        lastEmittedFrame = nowFrame;
        this.emit();
      }
      for (const eventIndex of executionWindow.attacks) {
        const event = performanceEventAt(this.bundle, eventIndex);
        const startFrame = this.bundle.index.eventStartFrames[eventIndex]!;
        const audioTime =
          baseTime + (startFrame - targetFrame) / REFERENCE_SAMPLE_RATE;
        this.scheduleDirectEvent(eventIndex, event, audioTime, 0, "attack", 0);
      }
      timer = globalThis.window.setTimeout(tick, 40);
    };
    tick();
    this.cancelSchedule = () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
    const remainingSeconds = Math.max(
      0,
      this.bundle.plan.renderDurationSeconds - targetSeconds,
    );
    this.endedTimer = window.setTimeout(
      () => {
        if (generation !== this.generation) return;
        this.transportController.command({
          type: "advance",
          positionFrame: Math.round(
            this.bundle.plan.renderDurationSeconds * REFERENCE_SAMPLE_RATE,
          ),
        });
        this.haltDirectNodes();
        this.emit();
      },
      Math.ceil((remainingSeconds + 0.1) * 1_000),
    );
    this.emit();
  }

  private scheduleDirectEvent(
    _eventIndex: number,
    event: PerformanceEvent,
    audioTime: number,
    elapsedSeconds: number,
    phase: "attack" | "sustain" | "release",
    releaseElapsedSeconds: number,
  ): void {
    const voice = this.voiceById.get(event.voiceId);
    if (!voice || voice.engine === "soundfont") return;
    if (voice.engine === "synth" && voice.patch) {
      this.createSynthVoice(
        event,
        voice,
        voice.patch,
        audioTime,
        elapsedSeconds,
        phase,
      );
    } else if (voice.engine === "sampler" && event.sample) {
      this.createSamplerVoice(
        event,
        voice,
        audioTime,
        elapsedSeconds,
        releaseElapsedSeconds,
        phase,
      );
    }
  }

  private createSynthVoice(
    event: PerformanceEvent,
    voice: PerformanceVoice,
    patch: SynthPatch,
    start: number,
    elapsedSeconds: number,
    phase: "attack" | "sustain" | "release",
  ): void {
    const noteSeconds =
      (event.soundingDurationBeats * 60) / this.bundle.compiled.tempo;
    const remainingHeld = Math.max(0, noteSeconds - elapsedSeconds);
    const releaseElapsed = Math.max(0, elapsedSeconds - noteSeconds);
    const remainingRelease = Math.max(0, patch.release - releaseElapsed);
    const releaseStart = start + remainingHeld;
    const stopAt =
      phase === "release"
        ? start + remainingRelease
        : releaseStart + patch.release;
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    panner.pan.value = voice.pan;
    if (patch.format === "refrain-synth-subtractive@0-experimental") {
      const filter = this.context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = patch.filterHz;
      filter.Q.value = patch.filterQ;
      gain
        .connect(filter)
        .connect(panner)
        .connect(this.destinationForVoice(voice));
    } else gain.connect(panner).connect(this.destinationForVoice(voice));
    const peak = Math.max(
      0.0001,
      dbToGain(event.effectiveGainDb) * event.performanceVelocity,
    );
    const initial = Math.max(
      0.0001,
      peak * envelopeLevel(elapsedSeconds, noteSeconds, patch),
    );
    gain.gain.setValueAtTime(initial, start);
    if (phase !== "release") {
      const attackRemaining = patch.attack - elapsedSeconds;
      if (attackRemaining > 0 && attackRemaining < remainingHeld)
        gain.gain.linearRampToValueAtTime(peak, start + attackRemaining);
      if (patch.format === "refrain-synth-subtractive@0-experimental") {
        const decayRemaining = patch.attack + patch.decay - elapsedSeconds;
        if (decayRemaining > 0 && decayRemaining < remainingHeld)
          gain.gain.linearRampToValueAtTime(
            Math.max(0.0001, peak * patch.sustain),
            start + decayRemaining,
          );
      }
      gain.gain.setValueAtTime(
        Math.max(
          0.0001,
          peak * heldEnvelopeLevel(elapsedSeconds + remainingHeld, patch),
        ),
        releaseStart,
      );
    }
    if (stopAt > releaseStart) {
      const releaseStartLevel = Math.max(
        0.0001,
        peak *
          envelopeLevel(elapsedSeconds + remainingHeld, noteSeconds, patch),
      );
      const releaseCurve = Float32Array.from({ length: 65 }, (_item, index) => {
        const remaining = 1 - index / 64;
        return Math.max(0.0001, releaseStartLevel * remaining ** 2);
      });
      gain.gain.setValueCurveAtTime(
        releaseCurve,
        releaseStart,
        stopAt - releaseStart,
      );
    } else gain.gain.setValueAtTime(0.0001, releaseStart);
    const frequency = 440 * 2 ** ((event.midi - 69) / 12);
    const oscillators = synthOscillatorProjection(patch).map((layer) => {
      const oscillator = this.context.createOscillator();
      const layerGain = this.context.createGain();
      oscillator.type = layer.type;
      oscillator.frequency.value = frequency * layer.ratio;
      oscillator.detune.value = layer.detune;
      if (elapsedSeconds > 0) {
        const detuneRatio = 2 ** (layer.detune / 1200);
        const phaseCycles =
          (elapsedSeconds * frequency * layer.ratio * detuneRatio) % 1;
        oscillator.setPeriodicWave(
          phaseShiftedPeriodicWave(this.context, layer.type, phaseCycles),
        );
      }
      const initialLayerGain =
        layer.decaySeconds === undefined
          ? layer.gain
          : layer.gain * Math.exp(-elapsedSeconds / layer.decaySeconds);
      layerGain.gain.setValueAtTime(Math.max(0.0001, initialLayerGain), start);
      if (layer.decaySeconds !== undefined) {
        layerGain.gain.exponentialRampToValueAtTime(
          Math.max(
            0.0001,
            layer.gain *
              Math.exp(
                -(elapsedSeconds + Math.max(0, stopAt - start)) /
                  layer.decaySeconds,
              ),
          ),
          Math.max(start + 0.001, stopAt),
        );
      }
      oscillator.connect(layerGain).connect(gain);
      oscillator.start(start);
      oscillator.stop(Math.max(start + 0.001, stopAt) + 0.03);
      return oscillator;
    });
    const active = { oscillators, gain };
    this.activeSynth.add(active);
    oscillators[0]?.addEventListener(
      "ended",
      () => this.activeSynth.delete(active),
      { once: true },
    );
  }

  private createSamplerVoice(
    event: PerformanceEvent,
    voice: PerformanceVoice,
    start: number,
    elapsedSeconds: number,
    releaseElapsedSeconds: number,
    phase: "attack" | "sustain" | "release",
  ): void {
    const sample = event.sample!;
    if (phase === "release" && sample.releaseSample) {
      const decoded = this.assetStore.decoded(sample.releaseSample.assetId);
      if (!decoded || decoded.kind !== "wav") return;
      this.startSampleSource(
        voice,
        decoded.buffer,
        start,
        releaseElapsedSeconds * sample.releaseSample.playbackRate,
        sample.releaseSample.playbackRate,
        voice.pan,
        event.effectiveGainDb + sample.gainDb + sample.releaseSample.gainDb,
        event.performanceVelocity,
      );
      return;
    }
    const decoded = this.assetStore.decoded(sample.attackAssetId);
    if (!decoded || decoded.kind !== "wav") {
      this.requestBufferAt(this.transport.positionFrame);
      return;
    }
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    const playable = this.browserLoopProjection(event, decoded);
    source.buffer = playable.buffer;
    source.playbackRate.value = sample.playbackRate;
    panner.pan.value = voice.pan;
    source
      .connect(gain)
      .connect(panner)
      .connect(this.destinationForVoice(voice));
    if (sample.loop.mode === "sustain") {
      source.loop = true;
      source.loopStart = playable.loopStart;
      source.loopEnd = playable.loopEnd;
    }
    const heldSeconds = Math.max(
      0,
      (event.soundingDurationBeats * 60) / this.bundle.compiled.tempo -
        elapsedSeconds,
    );
    const end = start + heldSeconds;
    const level = Math.max(
      0.0001,
      dbToGain(event.effectiveGainDb + sample.gainDb) *
        event.performanceVelocity,
    );
    const attackRemaining = Math.max(0, sample.attackSeconds - elapsedSeconds);
    const attackLevel =
      sample.attackSeconds === 0
        ? level
        : level * Math.min(1, elapsedSeconds / sample.attackSeconds);
    gain.gain.setValueAtTime(Math.max(0.0001, attackLevel), start);
    if (attackRemaining > 0)
      gain.gain.linearRampToValueAtTime(level, start + attackRemaining);
    const releaseSeconds =
      sample.release.mode === "envelope" ? sample.release.seconds : 0.01;
    gain.gain.setValueAtTime(level, end);
    gain.gain.linearRampToValueAtTime(0.0001, end + releaseSeconds);
    if (sample.releaseSample) {
      const release = this.assetStore.decoded(sample.releaseSample.assetId);
      if (release?.kind === "wav")
        this.startSampleSource(
          voice,
          release.buffer,
          end,
          0,
          sample.releaseSample.playbackRate,
          voice.pan,
          event.effectiveGainDb + sample.gainDb + sample.releaseSample.gainDb,
          event.performanceVelocity,
        );
    }
    let offset = elapsedSeconds * sample.playbackRate;
    if (sample.loop.mode === "sustain") {
      const loopStart = source.loopStart;
      const loopEnd = source.loopEnd;
      if (offset >= loopEnd)
        offset = loopStart + ((offset - loopStart) % (loopEnd - loopStart));
    }
    offset = Math.max(0, Math.min(offset, decoded.buffer.duration - 0.000_001));
    source.start(start, offset);
    source.stop(
      sample.loop.mode === "sustain"
        ? end + releaseSeconds
        : Math.min(
            end + releaseSeconds,
            start + (decoded.buffer.duration - offset) / sample.playbackRate,
          ),
    );
    this.trackSample(source);
  }

  private browserLoopProjection(
    event: PerformanceEvent,
    decoded: Extract<BrowserDecodedAsset, { kind: "wav" }>,
  ): { buffer: AudioBuffer; loopStart: number; loopEnd: number } {
    const buffer = decoded.buffer;
    const loop = event.sample!.loop;
    if (loop.mode !== "sustain")
      return { buffer, loopStart: 0, loopEnd: buffer.duration };
    const crossfade = loop.crossfadeFrames ?? 0;
    if (crossfade === 0)
      return {
        buffer,
        loopStart: loop.startFrame / buffer.sampleRate,
        loopEnd: loop.endFrame / buffer.sampleRate,
      };
    const key = loopProjectionKey(
      event.sample!.attackAssetId,
      loop.startFrame,
      loop.endFrame,
      crossfade,
    );
    const projected = decoded.loopBuffers.get(key);
    if (!projected)
      throw new Error(
        `Decoded loop projection ${key} is absent from its retained-memory accounting.`,
      );
    return {
      buffer: projected,
      loopStart: (loop.startFrame + crossfade) / buffer.sampleRate,
      loopEnd: loop.endFrame / buffer.sampleRate,
    };
  }

  private startSampleSource(
    voice: PerformanceVoice,
    buffer: AudioBuffer,
    start: number,
    offset: number,
    playbackRate: number,
    pan: number,
    gainDb: number,
    velocity: number,
  ): void {
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    panner.pan.value = pan;
    gain.gain.value = Math.max(0.0001, dbToGain(gainDb) * velocity);
    source
      .connect(gain)
      .connect(panner)
      .connect(this.destinationForVoice(voice));
    const bounded = Math.max(0, Math.min(offset, buffer.duration - 0.000_001));
    source.start(start, bounded);
    source.stop(start + (buffer.duration - bounded) / playbackRate);
    this.trackSample(source);
  }

  private trackSample(source: AudioBufferSourceNode): void {
    this.activeSamples.add(source);
    source.addEventListener("ended", () => this.activeSamples.delete(source), {
      once: true,
    });
  }

  private requestBufferAt(frame: number): void {
    if (this.bufferPromise) return;
    const request = this.bufferAt(frame).finally(() => {
      if (this.bufferPromise === request) this.bufferPromise = undefined;
    });
    this.bufferPromise = request;
    void request.catch(() => undefined);
  }

  private async bufferAt(frame: number): Promise<void> {
    const operation = this.beginOperation("buffer");
    try {
      const wasPlaying = this.transport.status === "playing";
      this.haltPlayback();
      this.transportController.command({ type: "buffer", targetFrame: frame });
      this.emit();
      const startingIds = this.startAssetIds(this.assetIdsAround(frame));
      await this.assetStore.prepareMany(startingIds, operation.signal);
      this.operations.assertCurrent(operation);
      if (wasPlaying) {
        await this.ensureAdapterReady(operation);
        this.operations.assertCurrent(operation);
        this.startPrefetch(new Set(startingIds));
        this.startAt(frame);
      }
    } catch (cause) {
      this.failCurrentOperation(operation);
      throw cause;
    } finally {
      this.finishOperation(operation);
    }
  }

  pause(): void {
    this.cancelOperations("pause");
    const snapshot = this.transport;
    if (snapshot.status !== "playing") return;
    this.haltPlayback();
    this.transportController.command({
      type: "advance",
      positionFrame: snapshot.positionFrame,
    });
    this.transportController.command({ type: "pause" });
    this.emit();
  }

  async resume(): Promise<void> {
    const operation = this.beginOperation("resume");
    try {
      const snapshot = this.transport;
      if (snapshot.status !== "paused" && snapshot.status !== "ready") return;
      const startingIds = this.startAssetIds(
        this.assetIdsAround(snapshot.positionFrame),
      );
      await this.assetStore.prepareMany(startingIds, operation.signal);
      this.operations.assertCurrent(operation);
      await this.ensureAdapterReady(operation);
      this.operations.assertCurrent(operation);
      this.startPrefetch(new Set(startingIds));
      this.startAt(snapshot.positionFrame);
    } catch (cause) {
      this.failCurrentOperation(operation);
      throw cause;
    } finally {
      this.finishOperation(operation);
    }
  }

  async seek(seconds: number): Promise<void> {
    if (!Number.isFinite(seconds))
      throw new Error("Seek time must be a finite number.");
    const operation = this.beginOperation("seek");
    try {
      const wasPlaying = this.transport.status === "playing";
      const frame = Math.max(
        0,
        Math.min(
          Math.round(seconds * REFERENCE_SAMPLE_RATE),
          Math.round(
            this.bundle.plan.renderDurationSeconds * REFERENCE_SAMPLE_RATE,
          ),
        ),
      );
      this.haltPlayback();
      this.transportController.command({ type: "prepare", targetFrame: frame });
      this.emit();
      const targetIds = wasPlaying
        ? this.startAssetIds(this.assetIdsAround(frame))
        : this.assetIdsAround(frame);
      await this.assetStore.prepareMany(targetIds, operation.signal);
      this.operations.assertCurrent(operation);
      this.transportController.command({ type: "seek", targetFrame: frame });
      if (wasPlaying) {
        await this.ensureAdapterReady(operation);
        this.operations.assertCurrent(operation);
        this.startPrefetch(new Set(targetIds));
        this.startAt(frame);
      } else {
        this.transportController.command({ type: "pause" });
        this.startPrefetch(new Set(targetIds));
        this.emit();
      }
    } catch (cause) {
      this.failCurrentOperation(operation);
      throw cause;
    } finally {
      this.finishOperation(operation);
    }
  }

  async jumpToSection(sectionId: string): Promise<void> {
    await this.seek(
      sectionFrame(this.bundle, sectionId) / REFERENCE_SAMPLE_RATE,
    );
  }

  async restart(): Promise<void> {
    const operation = this.beginOperation("restart");
    try {
      this.haltPlayback();
      this.transportController.command({ type: "restart" });
      const openingIds = this.startAssetIds(this.preparation.openingClosure);
      await this.assetStore.prepareMany(openingIds, operation.signal);
      this.operations.assertCurrent(operation);
      await this.ensureAdapterReady(operation);
      this.operations.assertCurrent(operation);
      this.startPrefetch(new Set(openingIds));
      this.startAt(0);
    } catch (cause) {
      this.failCurrentOperation(operation);
      throw cause;
    } finally {
      this.finishOperation(operation);
    }
  }

  stop(): void {
    this.cancelOperations("stop");
    this.haltPlayback();
    this.transportController.command({ type: "stop" });
    this.emit();
  }

  private haltPlayback(): void {
    this.generation += 1;
    this.sequencer?.pause();
    this.haltDirectNodes();
  }

  private haltDirectNodes(): void {
    this.cancelSchedule?.();
    this.cancelSchedule = undefined;
    if (this.endedTimer !== undefined) {
      window.clearTimeout(this.endedTimer);
      this.endedTimer = undefined;
    }
    for (const source of this.activeSamples) {
      try {
        source.stop();
      } catch {
        // The source ended between iteration and stop.
      }
    }
    this.activeSamples.clear();
    for (const active of this.activeSynth) {
      active.gain.gain.cancelScheduledValues(this.context.currentTime);
      active.gain.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.005);
      for (const oscillator of active.oscillators) {
        try {
          oscillator.stop(this.context.currentTime + 0.02);
        } catch {
          // The oscillator already ended.
        }
      }
    }
    this.activeSynth.clear();
  }

  private observeFirstGraphSound(
    commandReceivedAtMs: number,
    signal: AbortSignal,
  ): Promise<number | undefined> {
    const samples = new Float32Array(this.analyser.fftSize);
    return new Promise((resolve, reject) => {
      const deadline = now() + 2_000;
      let animationFrame: number | undefined;
      const finish = (value: number | undefined) => {
        signal.removeEventListener("abort", onAbort);
        if (animationFrame !== undefined)
          window.cancelAnimationFrame(animationFrame);
        resolve(value);
      };
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        if (animationFrame !== undefined)
          window.cancelAnimationFrame(animationFrame);
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("Playback observation was cancelled."),
        );
      };
      const inspect = () => {
        this.analyser.getFloatTimeDomainData(samples);
        if (samples.some((sample) => Math.abs(sample) > 0.000_001)) {
          finish(now() - commandReceivedAtMs);
          return;
        }
        if (now() >= deadline) {
          finish(undefined);
          return;
        }
        animationFrame = window.requestAnimationFrame(inspect);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      inspect();
    });
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelOperations("destroy");
    this.haltPlayback();
    this.listeners.clear();
    this.sampleSynth?.destroy();
    await this.context.close();
  }
}
