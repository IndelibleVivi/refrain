import type { CompiledAir } from "@refrain/compiler";
import type { CompiledAirV1 } from "@refrain/compiler/v1";
import {
  type PerformanceBinding,
  soundAssetById,
  type SynthPatch,
} from "@refrain/soundpack";
import { heldEnvelopeLevel } from "./envelope.js";
import { verifyAssetBytes } from "./digest.js";
import { scheduleWithLookahead, type LookaheadAction } from "./lookahead.js";
import { createNoteLifecycle } from "./note-lifecycle.js";
import { synthOscillatorProjection } from "./synth-kernel.js";
import {
  createAuditionPerformancePlan,
  createPerformancePlan,
  resolvedRenderProfileOf,
  type PerformanceEvent,
  type PerformancePlan,
  type PerformanceVoice,
  type ResolvedRenderProfile,
} from "./performance.js";

export interface AudioEngineOptions {
  soundBankUrl?: string;
  assetBaseUrl?: string;
  workletUrl?: string;
  performanceBinding: PerformanceBinding;
  forceMode?: AudioEngineMode;
}

export interface AssetLoadMetric {
  assetId: string;
  bytes: number;
  cache: "cold" | "warm";
  loadMs: number;
  decodeMs: number;
  sha256: string;
  verified: true;
}

export interface PlaybackReceipt {
  performanceBindingId: string;
  performanceBindingSha256: string;
  rendererContract: string;
  mode: AudioEngineMode;
  startedAt: number;
  durationSeconds: number;
  eventCount: number;
  preparationMs: number;
  firstSoundDelayMs: number;
  assetLoads: AssetLoadMetric[];
}

export type AudioEngineMode = "direct" | "worklet" | "prerender";

const dbToGain = (db: number): number => 10 ** (db / 20);

function now(): number {
  return globalThis.performance.now();
}

function createLimiter(
  context: AudioContext,
  profile: ResolvedRenderProfile,
): DynamicsCompressorNode {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = 20 * Math.log10(profile.peakCeiling);
  limiter.knee.value = 3;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.24;
  return limiter;
}

interface ActiveSynthVoice {
  oscillators: OscillatorNode[];
  gain: GainNode;
}

interface LoadedSample {
  bytes: ArrayBuffer;
  buffer: AudioBuffer;
}

type WorkletSynthesizer = import("spessasynth_lib").WorkletSynthesizer;

export class BrowserAudioEngine {
  readonly context: AudioContext;
  private readonly options: AudioEngineOptions;
  private readonly limiter: DynamicsCompressorNode;
  private readonly master: GainNode;
  private resolvedRenderProfile: ResolvedRenderProfile;
  private sampleSynth?: WorkletSynthesizer;
  private soundBank?: ArrayBuffer;
  private soundBankAssetId?: string;
  private soundBankDecoded = false;
  private workletAttempted = false;
  private readonly samples = new Map<string, LoadedSample>();
  private currentMode: AudioEngineMode = "direct";
  private readonly activeSynth = new Set<ActiveSynthVoice>();
  private readonly activeSamples = new Set<AudioBufferSourceNode>();
  private activeBufferSource?: AudioBufferSourceNode;
  private stopTimer?: number;
  private cancelSchedule?: () => void;
  private playbackGeneration = 0;

  private constructor(
    context: AudioContext,
    options: AudioEngineOptions,
    profile: ResolvedRenderProfile,
  ) {
    this.context = context;
    this.options = options;
    this.resolvedRenderProfile = profile;
    this.master = context.createGain();
    this.master.gain.value = dbToGain(profile.masterGainDb);
    this.limiter = createLimiter(context, profile);
    this.limiter.connect(context.destination);
    this.master.connect(this.limiter);
  }

  get mode(): AudioEngineMode {
    return this.currentMode;
  }

  static async create(
    options: AudioEngineOptions,
  ): Promise<BrowserAudioEngine> {
    const context = new AudioContext({
      latencyHint: "interactive",
      sampleRate: 44_100,
    });
    try {
      const engine = new BrowserAudioEngine(
        context,
        options,
        resolvedRenderProfileOf(options.performanceBinding),
      );
      await context.resume();
      return engine;
    } catch (cause) {
      await context.close();
      throw cause;
    }
  }

  async resume(): Promise<void> {
    if (this.context.state !== "running") await this.context.resume();
  }

  private applyResolvedRenderProfile(profile: ResolvedRenderProfile): void {
    this.resolvedRenderProfile = profile;
    this.master.gain.setTargetAtTime(
      dbToGain(profile.masterGainDb),
      this.context.currentTime,
      0.02,
    );
    this.limiter.threshold.setTargetAtTime(
      20 * Math.log10(profile.peakCeiling),
      this.context.currentTime,
      0.02,
    );
  }

  private assetUrl(localPath: string): string {
    const base = this.options.assetBaseUrl?.replace(/\/$/, "") ?? "";
    return `${base}/${localPath}`;
  }

  private async fetchAsset(
    assetId: string,
    url: string,
    expectedBytes: number,
    expectedSha256: string,
  ): Promise<{ bytes: ArrayBuffer; loadMs: number }> {
    const started = now();
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${assetId} failed to load: HTTP ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
    const verified = await verifyAssetBytes(
      { assetId, bytes: expectedBytes, sha256: expectedSha256 },
      bytes,
    );
    return { bytes: verified.data, loadMs: now() - started };
  }

  private async ensureSoundfont(assetId: string): Promise<AssetLoadMetric> {
    const asset = soundAssetById.get(assetId);
    if (!asset || asset.kind !== "soundfont") {
      throw new Error(`Unknown SoundFont asset ${assetId}.`);
    }
    const url =
      asset.id === "generaluser-gs-2.0.3" && this.options.soundBankUrl
        ? this.options.soundBankUrl
        : this.assetUrl(asset.localPath);
    if (this.soundBankAssetId && this.soundBankAssetId !== assetId) {
      throw new Error(
        "One browser playback cannot initialize more than one SoundFont bank.",
      );
    }
    if (!this.soundBank) {
      const loaded = await this.fetchAsset(
        asset.id,
        url,
        asset.bytes,
        asset.sha256,
      );
      this.soundBank = loaded.bytes;
      this.soundBankAssetId = assetId;
      const decodeStarted = now();
      await this.initializeWorklet();
      return {
        assetId: asset.id,
        bytes: asset.bytes,
        cache: "cold",
        loadMs: loaded.loadMs,
        decodeMs: now() - decodeStarted,
        sha256: asset.sha256,
        verified: true,
      };
    }
    const decodeStarted = now();
    await this.initializeWorklet();
    return {
      assetId: asset.id,
      bytes: asset.bytes,
      cache: "warm",
      loadMs: 0,
      decodeMs: this.soundBankDecoded ? 0 : now() - decodeStarted,
      sha256: asset.sha256,
      verified: true,
    };
  }

  private async initializeWorklet(): Promise<void> {
    if (this.soundBankDecoded) {
      this.currentMode = "worklet";
      return;
    }
    if (this.options.forceMode === "prerender") {
      this.currentMode = "prerender";
      return;
    }
    if (this.workletAttempted) {
      this.currentMode = "prerender";
      return;
    }
    this.workletAttempted = true;
    if (!this.context.audioWorklet || !this.options.workletUrl) {
      if (this.options.forceMode === "worklet") {
        throw new Error("Worklet mode requires a reachable worklet module.");
      }
      this.currentMode = "prerender";
      return;
    }
    let synth: WorkletSynthesizer | undefined;
    try {
      await this.context.audioWorklet.addModule(this.options.workletUrl);
      const { WorkletSynthesizer } = await import("spessasynth_lib");
      synth = new WorkletSynthesizer(this.context);
      await synth.isReady;
      await synth.soundBankManager.addSoundBank(
        this.soundBank!.slice(0),
        "refrain-audition",
      );
      synth.connect(this.master);
      this.sampleSynth = synth;
      this.soundBankDecoded = true;
      this.currentMode = "worklet";
    } catch (cause) {
      synth?.destroy();
      if (this.options.forceMode === "worklet") throw cause;
      this.sampleSynth = undefined;
      this.currentMode = "prerender";
    }
  }

  private async ensureSampler(assetId: string): Promise<AssetLoadMetric> {
    const asset = soundAssetById.get(assetId);
    if (!asset || asset.kind !== "wav") {
      throw new Error(`Unknown sampler asset ${assetId}.`);
    }
    if (this.samples.has(assetId)) {
      return {
        assetId,
        bytes: asset.bytes,
        cache: "warm",
        loadMs: 0,
        decodeMs: 0,
        sha256: asset.sha256,
        verified: true,
      };
    }
    const loaded = await this.fetchAsset(
      assetId,
      this.assetUrl(asset.localPath),
      asset.bytes,
      asset.sha256,
    );
    const decodeStarted = now();
    const buffer = await this.context.decodeAudioData(loaded.bytes.slice(0));
    const decodeMs = now() - decodeStarted;
    this.samples.set(assetId, { bytes: loaded.bytes, buffer });
    return {
      assetId,
      bytes: asset.bytes,
      cache: "cold",
      loadMs: loaded.loadMs,
      decodeMs,
      sha256: asset.sha256,
      verified: true,
    };
  }

  private async prepareAssets(
    plan: PerformancePlan,
  ): Promise<AssetLoadMetric[]> {
    const samplerIds = plan.requiredAssets
      .filter((asset) => asset.kind === "wav")
      .map((asset) => asset.assetId);
    const samplerMetrics = await Promise.all(
      samplerIds.map((assetId) => this.ensureSampler(assetId)),
    );
    const soundfontAssets = plan.requiredAssets.filter(
      (asset) => asset.kind === "soundfont",
    );
    if (soundfontAssets.length > 1) {
      throw new Error(
        "A performance plan may resolve at most one SoundFont bank.",
      );
    }
    const soundfontMetric = soundfontAssets[0]
      ? await this.ensureSoundfont(soundfontAssets[0].assetId)
      : undefined;
    const needsSoundfont = soundfontAssets.length > 0;
    if (!needsSoundfont && this.options.forceMode === "prerender") {
      this.currentMode = "prerender";
    } else if (!needsSoundfont) {
      this.currentMode = "direct";
    }
    return [...(soundfontMetric ? [soundfontMetric] : []), ...samplerMetrics];
  }

  private createSynthVoice(
    event: PerformanceEvent,
    voice: PerformanceVoice,
    patch: SynthPatch,
    start: number,
    end: number,
  ): void {
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    panner.pan.value = voice.pan;
    if (patch.format === "refrain-synth-subtractive@0-experimental") {
      const filter = this.context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = patch.filterHz;
      filter.Q.value = patch.filterQ;
      gain.connect(filter).connect(panner).connect(this.master);
    } else gain.connect(panner).connect(this.master);

    const peak = Math.max(
      0.0001,
      dbToGain(event.effectiveGainDb) * event.performanceVelocity,
    );
    const duration = Math.max(0, end - start);
    const attackOffset = Math.min(duration, patch.attack);
    gain.gain.setValueAtTime(0.0001, start);
    if (attackOffset > 0) {
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, peak * heldEnvelopeLevel(attackOffset, patch)),
        start + attackOffset,
      );
    }
    if (patch.format === "refrain-synth-subtractive@0-experimental") {
      const decayOffset = Math.min(duration, patch.attack + patch.decay);
      if (decayOffset > attackOffset) {
        gain.gain.exponentialRampToValueAtTime(
          Math.max(0.0001, peak * heldEnvelopeLevel(decayOffset, patch)),
          start + decayOffset,
        );
      }
    }
    gain.gain.setValueAtTime(
      Math.max(0.0001, peak * heldEnvelopeLevel(duration, patch)),
      end,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, end + patch.release);

    const baseFrequency = 440 * 2 ** ((event.midi - 69) / 12);
    const oscillators = synthOscillatorProjection(patch).map((layer) => {
      const oscillator = this.context.createOscillator();
      const layerGain = this.context.createGain();
      oscillator.type = layer.type;
      oscillator.frequency.value = baseFrequency * layer.ratio;
      oscillator.detune.value = layer.detune;
      layerGain.gain.setValueAtTime(layer.gain, start);
      if (layer.decaySeconds !== undefined) {
        layerGain.gain.exponentialRampToValueAtTime(
          Math.max(
            0.0001,
            layer.gain *
              Math.exp(-(duration + patch.release) / layer.decaySeconds),
          ),
          end + patch.release,
        );
      }
      oscillator.connect(layerGain).connect(gain);
      oscillator.start(start);
      oscillator.stop(end + patch.release + 0.05);
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
    secondsPerBeat: number,
  ): void {
    const sample = event.sample;
    if (!sample) return;
    if (sample.loop.mode === "sustain" || sample.release.mode === "sample")
      return;
    const loaded = this.samples.get(sample.attackAssetId);
    if (!loaded) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    source.buffer = loaded.buffer;
    source.playbackRate.value = sample.playbackRate;
    panner.pan.value = voice.pan;
    source.connect(gain).connect(panner).connect(this.master);
    const level = Math.max(
      0.0001,
      dbToGain(event.effectiveGainDb + sample.gainDb) *
        event.performanceVelocity,
    );
    const end = start + event.soundingDurationBeats * secondsPerBeat;
    gain.gain.setValueAtTime(0.0001, start);
    if (sample.attackSeconds > 0)
      gain.gain.linearRampToValueAtTime(level, start + sample.attackSeconds);
    else gain.gain.setValueAtTime(level, start);
    if (sample.release.mode === "natural") {
      gain.gain.setValueAtTime(level, end);
    } else if (sample.release.mode === "envelope") {
      gain.gain.setValueAtTime(level, end);
      gain.gain.linearRampToValueAtTime(0.0001, end + sample.release.seconds);
    } else {
      return;
    }
    source.start(start);
    const naturalEnd =
      start + loaded.buffer.duration / source.playbackRate.value;
    const requestedEnd =
      sample.release.mode === "natural"
        ? naturalEnd
        : end + sample.release.seconds + 0.01;
    source.stop(Math.min(requestedEnd, naturalEnd));
    this.activeSamples.add(source);
    source.addEventListener("ended", () => this.activeSamples.delete(source), {
      once: true,
    });
  }

  private async playPrerendered(
    plan: PerformancePlan,
    generation: number,
  ): Promise<{ baseTime: number; durationSeconds: number } | undefined> {
    const { renderPcm } = await import("./pcm.js");
    const samples = Object.fromEntries(
      [...this.samples].map(([assetId, loaded]) => [
        assetId,
        loaded.bytes.slice(0),
      ]),
    );
    const pcm = await renderPcm(
      plan.compiled,
      {
        ...(this.soundBank ? { soundfont: this.soundBank.slice(0) } : {}),
        samples,
      },
      this.context.sampleRate,
      {
        isCancelled: () => generation !== this.playbackGeneration,
        applyMasterGain: false,
        applyPeakCeiling: false,
        plan,
      },
    );
    if (!pcm || generation !== this.playbackGeneration) return undefined;
    const buffer = this.context.createBuffer(
      2,
      pcm.left.length,
      pcm.sampleRate,
    );
    buffer.getChannelData(0).set(pcm.left);
    buffer.getChannelData(1).set(pcm.right);
    const baseTime = this.context.currentTime + 0.08;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master);
    source.start(baseTime);
    this.activeBufferSource = source;
    source.addEventListener(
      "ended",
      () => {
        if (this.activeBufferSource === source)
          this.activeBufferSource = undefined;
      },
      { once: true },
    );
    return { baseTime, durationSeconds: pcm.durationSeconds };
  }

  async play(
    compiled: CompiledAir | CompiledAirV1,
    performanceBinding: PerformanceBinding = this.options.performanceBinding,
  ): Promise<PlaybackReceipt | undefined> {
    this.stop();
    const generation = this.playbackGeneration;
    const requestedAt = now();
    await this.resume();
    const plan = createPerformancePlan(compiled, { performanceBinding });
    this.applyResolvedRenderProfile(plan.resolvedRenderProfile);
    const assetLoads = await this.prepareAssets(plan);
    if (generation !== this.playbackGeneration) return undefined;

    const mustPrerender =
      this.options.forceMode === "prerender" ||
      (plan.voices.some((voice) => voice.engine === "soundfont") &&
        !this.sampleSynth) ||
      plan.events.some(
        (event) =>
          event.sample?.loop.mode === "sustain" ||
          event.sample?.release.mode === "sample",
      );
    if (mustPrerender) {
      this.currentMode = "prerender";
      const result = await this.playPrerendered(plan, generation);
      if (!result) return undefined;
      const preparationMs = now() - requestedAt;
      this.stopTimer = window.setTimeout(
        () => {
          if (generation === this.playbackGeneration) this.stop();
        },
        Math.ceil((result.durationSeconds + 0.2) * 1000),
      );
      return {
        performanceBindingId: plan.performanceBinding.id,
        performanceBindingSha256: plan.performanceBinding.contentSha256,
        rendererContract: plan.rendererContract,
        mode: this.currentMode,
        startedAt: result.baseTime,
        durationSeconds: result.durationSeconds,
        eventCount: compiled.events.length,
        preparationMs,
        firstSoundDelayMs: preparationMs + 80,
        assetLoads,
      };
    }

    const secondsPerBeat = 60 / compiled.tempo;
    const baseTime = this.context.currentTime + 0.08;
    const actions: LookaheadAction[] = [];
    const configured = new Set<string>();
    const soundfontEvents: PerformanceEvent[] = [];
    const voiceById = new Map(
      plan.voices.map((voice) => [voice.voiceId, voice]),
    );
    for (const event of plan.events) {
      const voice = voiceById.get(event.voiceId);
      if (!voice) continue;
      if (voice.engine === "synth") {
        actions.push({
          offsetSeconds: event.startBeat * secondsPerBeat,
          order: 3,
          run: (time) => {
            if (!voice.patch) return;
            this.createSynthVoice(
              event,
              voice,
              voice.patch,
              time,
              time + event.soundingDurationBeats * secondsPerBeat,
            );
          },
        });
      } else if (voice.engine === "sampler") {
        actions.push({
          offsetSeconds: event.startBeat * secondsPerBeat,
          order: 3,
          run: (time) =>
            this.createSamplerVoice(event, voice, time, secondsPerBeat),
        });
      } else {
        soundfontEvents.push(event);
        if (!configured.has(voice.voiceId)) {
          configured.add(voice.voiceId);
          const synth = this.sampleSynth!;
          if (voice.mapping.type === "program") {
            const program = voice.mapping.program;
            actions.push({
              offsetSeconds: 0,
              order: 0,
              run: (time) =>
                synth.programChange(voice.channel, program, {
                  time,
                }),
            });
          }
          const pan = Math.max(
            0,
            Math.min(127, Math.round((voice.pan + 1) * 63.5)),
          );
          actions.push({
            offsetSeconds: 0,
            order: 1,
            run: (time) =>
              synth.sendMessage(
                [0xb0 | voice.channel, 7, voice.channelGain],
                0,
                { time },
              ),
          });
          actions.push({
            offsetSeconds: 0,
            order: 1,
            run: (time) =>
              synth.sendMessage([0xb0 | voice.channel, 10, pan], 0, { time }),
          });
        }
      }
    }
    for (const action of createNoteLifecycle(soundfontEvents)) {
      const synth = this.sampleSynth!;
      actions.push({
        offsetSeconds: action.beat * secondsPerBeat,
        order: action.type === "noteOff" ? 2 : 3,
        run: (time) => {
          if (action.type === "noteOn") {
            synth.noteOn(
              action.event.channel,
              action.event.midi,
              action.event.noteOnVelocity,
              { time },
            );
          } else {
            synth.noteOff(action.event.channel, action.event.midi, { time });
          }
        },
      });
    }
    this.cancelSchedule = scheduleWithLookahead(actions, baseTime, {
      now: () => this.context.currentTime,
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      clearTimer: (timer) => window.clearTimeout(timer),
    });
    this.stopTimer = window.setTimeout(
      () => {
        if (generation === this.playbackGeneration) this.stop();
      },
      Math.ceil((plan.durationSeconds + 0.2) * 1000),
    );
    const preparationMs = now() - requestedAt;
    return {
      performanceBindingId: plan.performanceBinding.id,
      performanceBindingSha256: plan.performanceBinding.contentSha256,
      rendererContract: plan.rendererContract,
      mode: this.currentMode,
      startedAt: baseTime,
      durationSeconds: plan.durationSeconds,
      eventCount: compiled.events.length,
      preparationMs,
      firstSoundDelayMs: preparationMs + 80,
      assetLoads,
    };
  }

  async audition(
    instrumentId: string,
    midi = 60,
    candidateId?: string,
    performanceBinding: PerformanceBinding = this.options.performanceBinding,
  ): Promise<PlaybackReceipt | undefined> {
    const plan = createAuditionPerformancePlan(instrumentId, midi, {
      performanceBinding,
      ...(candidateId === undefined ? {} : { candidateId }),
    });
    return this.play(
      plan.compiled,
      plan.performanceBinding as PerformanceBinding,
    );
  }

  stop(): void {
    this.playbackGeneration += 1;
    this.cancelSchedule?.();
    this.cancelSchedule = undefined;
    if (this.stopTimer !== undefined) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = undefined;
    }
    this.sampleSynth?.stopAll(true);
    if (this.activeBufferSource) {
      try {
        this.activeBufferSource.stop();
      } catch {
        // It ended between the reference check and stop.
      }
      this.activeBufferSource = undefined;
    }
    for (const source of this.activeSamples) {
      try {
        source.stop();
      } catch {
        // It ended between the set iteration and stop.
      }
    }
    this.activeSamples.clear();
    for (const active of this.activeSynth) {
      active.gain.gain.cancelScheduledValues(this.context.currentTime);
      active.gain.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.005);
      for (const oscillator of active.oscillators) {
        try {
          oscillator.stop(this.context.currentTime + 0.03);
        } catch {
          // An already-ended oscillator needs no further stop message.
        }
      }
    }
    this.activeSynth.clear();
  }

  async destroy(): Promise<void> {
    this.stop();
    this.sampleSynth?.destroy();
    await this.context.close();
  }
}
