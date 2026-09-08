import { sha256Hex } from "@refrain/identity";
import vocabularyJson from "./instrument-vocabulary.json" with { type: "json" };
import decisionsJson from "./listening-decisions.json" with { type: "json" };
import profilesJson from "./sound-profiles.json" with { type: "json" };
import { candidateShardJson } from "./candidate-shards.js";
import catalogJson from "./sound-catalog.json" with { type: "json" };

export { sha256Hex } from "@refrain/identity";

export type InstrumentFamily = "pitched" | "percussion" | "texture";
export type CandidateEngine = "soundfont" | "sampler" | "synth";
export type MusicalArticulation =
  "none" | "staccato" | "tenuto" | "accent" | "legato";

export interface InstrumentDefinition {
  id: string;
  label: string;
  family: InstrumentFamily;
  midiMin: number;
  midiMax: number;
  status: "active" | "deprecated";
  authoringMeaning: string;
  supportedNotes?: readonly number[];
}

export interface InstrumentVocabulary {
  format: "refrain-instrument-vocabulary@0-experimental";
  id: string;
  contentSha256: string;
  instruments: InstrumentDefinition[];
}

export interface SubtractiveSynthPatch {
  format: "refrain-synth-subtractive@0-experimental";
  oscillators: Array<{
    type: OscillatorType;
    ratio: number;
    gain: number;
    detune?: number;
  }>;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterHz: number;
  filterQ: number;
}

export interface ModalSynthPatch {
  format: "refrain-synth-modal@0-experimental";
  modes: Array<{
    ratio: number;
    gain: number;
    decaySeconds: number;
    detune?: number;
  }>;
  attack: number;
  release: number;
}

export type SynthPatch = SubtractiveSynthPatch | ModalSynthPatch;

export interface ProcessingStep {
  operation: string;
  tool: string;
  inputSha256: string;
  outputSha256: string;
  parameters: Readonly<Record<string, string | number | boolean>>;
}

export interface SoundAssetDefinition {
  id: string;
  kind: "soundfont" | "wav";
  source: {
    repository: string;
    ref: string;
    url: string;
    path?: string;
    container?: {
      format: "7z";
      bytes: number;
      sha256: string;
      memberPath: string;
    };
  };
  localPath: string;
  bytes: number;
  sha256: string;
  audio?: {
    sampleRate: number;
    frameCount: number;
    channels: 1 | 2;
  };
  license: {
    expression: string;
    path: string;
    assetScope: string;
  };
  processingHistory: ProcessingStep[];
  releaseStatus:
    | "audition-fallback"
    | "listening-candidate"
    | "listening-accepted"
    | "release-candidate";
  publicReleaseAccepted: false;
}

export type SampleLoop =
  | { mode: "none" }
  | {
      mode: "sustain";
      startFrame: number;
      endFrame: number;
      crossfadeFrames?: number;
    };

export type SampleRelease =
  | { mode: "envelope"; seconds: number }
  | { mode: "natural" }
  | { mode: "sample"; seconds?: number };

export interface SampleRegion {
  id: string;
  trigger: "attack" | "release";
  assetId: string;
  articulation: MusicalArticulation;
  pitch: {
    minMidi: number;
    rootMidi: number;
    maxMidi: number;
  };
  velocity: {
    min: number;
    max: number;
  };
  velocityGainCurve?: Array<{ velocity: number; gain: number }>;
  roundRobin?: {
    group: string;
    index: number;
    count: number;
  };
  gainDb: number;
  tuneCents: number;
  attackSeconds?: number;
  loop: SampleLoop;
  release?: SampleRelease;
}

export type CandidateMapping =
  | { type: "program"; program: number }
  | { type: "percussion-kit"; supportedNotes: number[] }
  | {
      type: "sample-map";
      playableMin: number;
      playableMax: number;
      midiFallbackProgram: number;
      articulationFallbacks: Readonly<Record<string, MusicalArticulation>>;
      regions: SampleRegion[];
    }
  | { type: "midi-fallback"; program: number };

export interface InstrumentCandidate {
  id: string;
  instrumentId: string;
  engine: CandidateEngine;
  assetId?: string;
  mapping: CandidateMapping;
  calibrationGainDb: number;
  tailSeconds?: number;
  releaseStatus:
    | "audition-fallback"
    | "listening-candidate"
    | "listening-accepted"
    | "development-identity"
    | "release-candidate";
  patch?: SynthPatch;
}

export interface SoundpackManifest {
  format: "refrain-soundpack@1-experimental";
  id: string;
  contentSha256: string;
  status: "development-candidates" | "release-candidate";
  assets: SoundAssetDefinition[];
  candidates: InstrumentCandidate[];
}

export interface SoundProfileSelection {
  candidateChain: readonly CandidatePin[];
  fallbackPolicy: "strict" | "whole-identity-audition";
  profileGainDb?: number;
}

export interface CandidatePin {
  id: string;
  sha256: string;
}

export interface SoundProfile {
  format: "refrain-sound-profile@1-experimental";
  id: string;
  contentSha256: string;
  vocabulary: { id: string; sha256: string };
  selections: Readonly<Record<string, SoundProfileSelection>>;
}

export const RENDER_SCENE_FORMAT =
  "refrain-render-scene@0-experimental" as const;
export const SOUND_PALETTE_FORMAT =
  "refrain-sound-palette@0-experimental" as const;
export const PERFORMANCE_BINDING_FORMAT =
  "refrain-performance-binding@0-experimental" as const;
export const REFRAIN_RENDERER_CONTRACT =
  "refrain-renderer@0-experimental" as const;
export const PERFORMANCE_PLAN_FORMAT =
  "performance-plan@2-experimental" as const;
export const COMPLETE_PIECE_RENDERER_CONTRACT =
  "refrain-renderer@1-experimental" as const;
export const COMPLETE_PIECE_PERFORMANCE_PLAN_FORMAT =
  "performance-plan@3-experimental" as const;

export interface RenderScene {
  format: typeof RENDER_SCENE_FORMAT;
  id: string;
  contentSha256: string;
  masterGainDb: number;
  peakCeiling: number;
  velocityScale: number;
}

export type PerformanceOverrideKey =
  "masterGainDb" | "peakCeiling" | "velocityScale";

export type PerformanceOverrides = Partial<
  Pick<RenderScene, PerformanceOverrideKey>
>;

export interface SoundPalette {
  format: typeof SOUND_PALETTE_FORMAT;
  id: string;
  contentSha256: string;
  status:
    | "engineering"
    | "listening-candidate"
    | "listening-accepted"
    | "release-candidate";
  soundProfile: { id: string; sha256: string };
  renderScene: { id: string; sha256: string };
  authoringGuide: string;
  descriptors: string[];
  strengths: string[];
  constraints: string[];
  intentionalContrasts: string[];
}

export const RENDER_ADAPTERS = [
  "browser-direct",
  "browser-prerender",
  "headless-pcm",
  "wav",
  "midi",
] as const;

export const COMPLETE_PIECE_RENDER_ADAPTERS = [
  "browser-direct",
  "browser-streaming-pcm",
  "worker-block-pcm",
  "node-block-pcm",
  "wav",
  "midi",
] as const;

export type RenderAdapterId =
  | (typeof RENDER_ADAPTERS)[number]
  | (typeof COMPLETE_PIECE_RENDER_ADAPTERS)[number];

export interface PerformanceBinding {
  format: typeof PERFORMANCE_BINDING_FORMAT;
  id: string;
  contentSha256: string;
  soundProfile: SoundProfile;
  soundProfileSha256: string;
  renderScene: RenderScene;
  soundPalette?: SoundPalette;
  soundPaletteSha256?: string;
  candidateDigests: Readonly<Record<string, string>>;
  permittedOverrides: PerformanceOverrideKey[];
  overrides: PerformanceOverrides;
  renderer: {
    contract:
      | typeof REFRAIN_RENDERER_CONTRACT
      | typeof COMPLETE_PIECE_RENDERER_CONTRACT;
    performancePlanFormat:
      | typeof PERFORMANCE_PLAN_FORMAT
      | typeof COMPLETE_PIECE_PERFORMANCE_PLAN_FORMAT;
    adapters: RenderAdapterId[];
  };
}

export interface CreatePerformanceBindingInput {
  id: string;
  soundProfile: SoundProfile;
  renderScene: RenderScene;
  soundPalette?: SoundPalette;
  permittedOverrides?: readonly PerformanceOverrideKey[];
  overrides?: PerformanceOverrides;
  renderer?: PerformanceBinding["renderer"];
}

export interface CreateSoundPaletteInput {
  id: string;
  status: SoundPalette["status"];
  soundProfile: SoundProfile;
  renderScene: RenderScene;
  authoringGuide: string;
  descriptors?: readonly string[];
  strengths?: readonly string[];
  constraints?: readonly string[];
  intentionalContrasts?: readonly string[];
}

export interface ListeningDecision {
  instrumentId: string;
  candidateId: string;
  decision: "accepted" | "rejected" | "replace";
  decidedBy: "Faye";
  decidedAt: string;
  scope: string;
  packetSha256: string;
  candidateAudioSha256: string;
  fallbackAudioSha256: string;
}

const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9_.@-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validMidi(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 127;
}

function rangesOverlap(
  left: { min: number; max: number },
  right: { min: number; max: number },
): boolean {
  return left.min <= right.max && right.min <= left.max;
}

export function validateInstrumentVocabulary(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["Instrument vocabulary must be an object."];
  if (value.format !== "refrain-instrument-vocabulary@0-experimental")
    errors.push("Invalid instrument vocabulary format.");
  if (typeof value.id !== "string" || !ID.test(value.id))
    errors.push("Invalid instrument vocabulary ID.");
  if (
    typeof value.contentSha256 !== "string" ||
    !SHA256.test(value.contentSha256)
  )
    errors.push("Invalid instrument vocabulary content SHA-256.");
  if (!Array.isArray(value.instruments) || value.instruments.length === 0)
    return [...errors, "Instrument vocabulary must contain instruments."];
  const ids = new Set<string>();
  for (const item of value.instruments) {
    if (!isRecord(item)) {
      errors.push("Instrument entries must be objects.");
      continue;
    }
    const id = typeof item.id === "string" ? item.id : "<unknown>";
    if (!ID.test(id) || ids.has(id))
      errors.push(`Invalid or duplicate instrument ${id}.`);
    ids.add(id);
    if (
      typeof item.label !== "string" ||
      !["pitched", "percussion", "texture"].includes(String(item.family)) ||
      !validMidi(item.midiMin) ||
      !validMidi(item.midiMax) ||
      Number(item.midiMin) > Number(item.midiMax) ||
      !["active", "deprecated"].includes(String(item.status)) ||
      typeof item.authoringMeaning !== "string" ||
      item.authoringMeaning.length === 0
    ) {
      errors.push(`Invalid instrument definition ${id}.`);
    }
    if (
      item.supportedNotes !== undefined &&
      (!Array.isArray(item.supportedNotes) ||
        item.supportedNotes.length === 0 ||
        item.supportedNotes.some((note) => !validMidi(note)))
    ) {
      errors.push(`Invalid supported-note set for ${id}.`);
    }
  }
  return errors;
}

function validateArticulationFallbacks(
  candidateId: string,
  fallbacks: Readonly<Record<string, MusicalArticulation>>,
): string[] {
  const errors: string[] = [];
  for (const start of Object.keys(fallbacks)) {
    const seen = new Set<string>();
    let current: string | undefined = start;
    while (current !== undefined && fallbacks[current] !== undefined) {
      if (seen.has(current)) {
        errors.push(
          `Candidate ${candidateId} has a cyclic articulation fallback at ${current}.`,
        );
        break;
      }
      seen.add(current);
      current = fallbacks[current];
    }
  }
  return errors;
}

function validateSampleMap(
  candidate: InstrumentCandidate,
  assets: Map<string, SoundAssetDefinition>,
): string[] {
  if (candidate.mapping.type !== "sample-map") return [];
  const errors: string[] = [];
  const mapping = candidate.mapping;
  if (
    !validMidi(mapping.playableMin) ||
    !validMidi(mapping.playableMax) ||
    mapping.playableMin > mapping.playableMax ||
    !validMidi(mapping.midiFallbackProgram) ||
    !Array.isArray(mapping.regions) ||
    mapping.regions.length === 0
  ) {
    errors.push(
      `Candidate ${candidate.id} has an invalid sample-map envelope.`,
    );
    return errors;
  }
  errors.push(
    ...validateArticulationFallbacks(
      candidate.id,
      mapping.articulationFallbacks,
    ),
  );
  const ids = new Set<string>();
  for (const region of mapping.regions) {
    const asset = assets.get(region.assetId);
    if (!ID.test(region.id) || ids.has(region.id))
      errors.push(
        `Candidate ${candidate.id} has invalid or duplicate region ${region.id}.`,
      );
    ids.add(region.id);
    if (!asset || asset.kind !== "wav")
      errors.push(
        `Region ${region.id} references missing WAV asset ${region.assetId}.`,
      );
    if (
      !validMidi(region.pitch.minMidi) ||
      !validMidi(region.pitch.rootMidi) ||
      !validMidi(region.pitch.maxMidi) ||
      region.pitch.minMidi > region.pitch.rootMidi ||
      region.pitch.rootMidi > region.pitch.maxMidi ||
      !Number.isInteger(region.velocity.min) ||
      !Number.isInteger(region.velocity.max) ||
      region.velocity.min < 1 ||
      region.velocity.max > 127 ||
      region.velocity.min > region.velocity.max
    ) {
      errors.push(`Region ${region.id} has invalid pitch or velocity bounds.`);
    }
    if (!Number.isFinite(region.gainDb) || !Number.isFinite(region.tuneCents))
      errors.push(`Region ${region.id} has invalid calibration.`);
    if (region.velocityGainCurve !== undefined) {
      const curve = region.velocityGainCurve;
      if (
        !Array.isArray(curve) ||
        curve.length < 2 ||
        curve.some(
          (point, index) =>
            !Number.isInteger(point.velocity) ||
            point.velocity < 0 ||
            point.velocity > 127 ||
            !Number.isFinite(point.gain) ||
            point.gain < 0 ||
            point.gain > 1 ||
            (index > 0 && point.velocity <= curve[index - 1]!.velocity),
        )
      )
        errors.push(`Region ${region.id} has an invalid velocity-gain curve.`);
    }
    if (
      region.attackSeconds !== undefined &&
      (!Number.isFinite(region.attackSeconds) ||
        region.attackSeconds < 0 ||
        region.attackSeconds > 10)
    )
      errors.push(`Region ${region.id} has an invalid attack envelope.`);
    if (region.trigger === "attack" && !region.release)
      errors.push(`Attack region ${region.id} must declare release behavior.`);
    if (
      region.trigger === "release" &&
      (region.release !== undefined || region.loop.mode !== "none")
    ) {
      errors.push(
        `Release region ${region.id} must not declare attack release or sustain-loop behavior.`,
      );
    }
    if (
      region.release?.mode === "envelope" &&
      (!Number.isFinite(region.release.seconds) || region.release.seconds <= 0)
    ) {
      errors.push(`Region ${region.id} has an invalid envelope release.`);
    }
    if (
      region.release?.mode === "sample" &&
      region.release.seconds !== undefined &&
      (!Number.isFinite(region.release.seconds) || region.release.seconds <= 0)
    ) {
      errors.push(`Region ${region.id} has an invalid sampled release length.`);
    }
    if (region.loop.mode === "sustain") {
      const frameCount = asset?.audio?.frameCount;
      if (
        !Number.isInteger(region.loop.startFrame) ||
        !Number.isInteger(region.loop.endFrame) ||
        region.loop.startFrame < 0 ||
        region.loop.endFrame <= region.loop.startFrame ||
        (frameCount !== undefined && region.loop.endFrame > frameCount) ||
        (region.loop.crossfadeFrames !== undefined &&
          (!Number.isInteger(region.loop.crossfadeFrames) ||
            region.loop.crossfadeFrames < 0 ||
            region.loop.crossfadeFrames * 2 >=
              region.loop.endFrame - region.loop.startFrame))
      ) {
        errors.push(`Region ${region.id} has invalid sustain-loop frames.`);
      }
    }
  }
  for (const trigger of ["attack", "release"] as const) {
    const triggeredRegions = mapping.regions.filter(
      (region) => region.trigger === trigger,
    );
    for (
      let leftIndex = 0;
      leftIndex < triggeredRegions.length;
      leftIndex += 1
    ) {
      const left = triggeredRegions[leftIndex]!;
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < triggeredRegions.length;
        rightIndex += 1
      ) {
        const right = triggeredRegions[rightIndex]!;
        if (
          left.articulation !== right.articulation ||
          !rangesOverlap(
            { min: left.pitch.minMidi, max: left.pitch.maxMidi },
            { min: right.pitch.minMidi, max: right.pitch.maxMidi },
          ) ||
          !rangesOverlap(
            { min: left.velocity.min, max: left.velocity.max },
            { min: right.velocity.min, max: right.velocity.max },
          )
        ) {
          continue;
        }
        const sameRoundRobin =
          left.roundRobin !== undefined &&
          right.roundRobin !== undefined &&
          left.roundRobin.group === right.roundRobin.group &&
          left.roundRobin.count === right.roundRobin.count &&
          left.pitch.minMidi === right.pitch.minMidi &&
          left.pitch.maxMidi === right.pitch.maxMidi &&
          left.velocity.min === right.velocity.min &&
          left.velocity.max === right.velocity.max;
        if (!sameRoundRobin)
          errors.push(
            `Candidate ${candidate.id} has overlapping ${trigger} regions ${left.id} and ${right.id}.`,
          );
      }
    }
  }
  for (const attack of mapping.regions.filter(
    (region) =>
      region.trigger === "attack" && region.release?.mode === "sample",
  )) {
    const releaseRegions = mapping.regions.filter(
      (region) =>
        region.trigger === "release" &&
        region.articulation === attack.articulation,
    );
    let complete = true;
    for (
      let midi = attack.pitch.minMidi;
      midi <= attack.pitch.maxMidi;
      midi += 1
    ) {
      for (
        let velocity = attack.velocity.min;
        velocity <= attack.velocity.max;
        velocity += 1
      ) {
        if (
          !releaseRegions.some(
            (region) =>
              midi >= region.pitch.minMidi &&
              midi <= region.pitch.maxMidi &&
              velocity >= region.velocity.min &&
              velocity <= region.velocity.max,
          )
        ) {
          complete = false;
          break;
        }
      }
      if (!complete) break;
    }
    if (!complete) {
      errors.push(
        `Attack region ${attack.id} has no complete matching release-region coverage.`,
      );
    }
  }
  const roundRobinGroups = new Map<string, SampleRegion[]>();
  for (const region of mapping.regions) {
    if (!region.roundRobin) continue;
    const key = [
      region.trigger,
      region.articulation,
      region.pitch.minMidi,
      region.pitch.rootMidi,
      region.pitch.maxMidi,
      region.velocity.min,
      region.velocity.max,
      region.roundRobin.group,
    ].join(":");
    roundRobinGroups.set(key, [...(roundRobinGroups.get(key) ?? []), region]);
  }
  for (const regions of roundRobinGroups.values()) {
    const expected = regions[0]!.roundRobin!.count;
    const indexes = [
      ...new Set(regions.map((region) => region.roundRobin!.index)),
    ].sort((left, right) => left - right);
    if (
      !Number.isInteger(expected) ||
      expected < 2 ||
      regions.some((region) => region.roundRobin!.count !== expected) ||
      indexes.length !== expected ||
      indexes.some((index, position) => index !== position)
    ) {
      errors.push(
        `Candidate ${candidate.id} has an incomplete round-robin group ${regions[0]!.roundRobin!.group}.`,
      );
    }
  }
  return errors;
}

export function validateSynthPatch(value: unknown): string[] {
  if (!isRecord(value)) return ["Synth patch must be an object."];
  const errors: string[] = [];
  const finite = (candidate: unknown, min: number, max: number) =>
    typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    candidate >= min &&
    candidate <= max;
  const validAttackRelease =
    finite(value.attack, 0, 10) && finite(value.release, 0.001, 30);
  if (!validAttackRelease)
    errors.push("Synth patch has an invalid attack or release envelope.");

  if (value.format === "refrain-synth-subtractive@0-experimental") {
    if (
      !exactKeys(value, [
        "attack",
        "decay",
        "filterHz",
        "filterQ",
        "format",
        "oscillators",
        "release",
        "sustain",
      ])
    )
      errors.push("Subtractive synth patch must use its closed contract.");
    if (
      !finite(value.decay, 0, 20) ||
      !finite(value.sustain, 0, 1) ||
      !finite(value.filterHz, 20, 24_000) ||
      !finite(value.filterQ, 0.05, 30)
    )
      errors.push(
        "Subtractive synth patch has invalid envelope or filter values.",
      );
    if (
      !Array.isArray(value.oscillators) ||
      value.oscillators.length < 1 ||
      value.oscillators.length > 8
    ) {
      errors.push("Subtractive synth patch needs one to eight oscillators.");
    } else {
      for (const [index, oscillator] of value.oscillators.entries()) {
        if (
          !isRecord(oscillator) ||
          !exactKeys(oscillator, [
            "gain",
            "ratio",
            "type",
            ...(oscillator.detune === undefined ? [] : ["detune"]),
          ]) ||
          !["sine", "triangle", "square", "sawtooth"].includes(
            String(oscillator.type),
          ) ||
          !finite(oscillator.ratio, 0.0625, 32) ||
          !finite(oscillator.gain, 0, 1) ||
          (oscillator.detune !== undefined &&
            !finite(oscillator.detune, -100, 100))
        )
          errors.push(`Subtractive oscillator ${index} is invalid.`);
      }
    }
  } else if (value.format === "refrain-synth-modal@0-experimental") {
    if (!exactKeys(value, ["attack", "format", "modes", "release"]))
      errors.push("Modal synth patch must use its closed contract.");
    if (
      !Array.isArray(value.modes) ||
      value.modes.length < 1 ||
      value.modes.length > 16
    ) {
      errors.push("Modal synth patch needs one to sixteen modes.");
    } else {
      for (const [index, mode] of value.modes.entries()) {
        if (
          !isRecord(mode) ||
          !exactKeys(mode, [
            "decaySeconds",
            "gain",
            "ratio",
            ...(mode.detune === undefined ? [] : ["detune"]),
          ]) ||
          !finite(mode.ratio, 0.0625, 32) ||
          !finite(mode.gain, 0, 1) ||
          !finite(mode.decaySeconds, 0.01, 60) ||
          (mode.detune !== undefined && !finite(mode.detune, -100, 100))
        )
          errors.push(`Modal synth mode ${index} is invalid.`);
      }
    }
  } else {
    errors.push("Unknown synth patch format.");
  }
  return errors;
}

export function validateSoundpackManifest(
  value: unknown,
  vocabulary: InstrumentVocabulary = INSTRUMENT_VOCABULARY,
): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["Soundpack manifest must be an object."];
  if (value.format !== "refrain-soundpack@1-experimental")
    errors.push("Invalid soundpack manifest format.");
  if (typeof value.id !== "string" || !ID.test(value.id))
    errors.push("Invalid soundpack manifest ID.");
  if (
    typeof value.contentSha256 !== "string" ||
    !SHA256.test(value.contentSha256)
  )
    errors.push("Invalid soundpack content SHA-256.");
  if (!Array.isArray(value.assets) || !Array.isArray(value.candidates))
    return [
      ...errors,
      "Soundpack manifest must contain assets and candidates.",
    ];
  const instrumentIds = new Set(vocabulary.instruments.map((item) => item.id));
  const assetIds = new Set<string>();
  const assets = new Map<string, SoundAssetDefinition>();
  for (const untyped of value.assets) {
    const asset = untyped as SoundAssetDefinition;
    if (
      !isRecord(untyped) ||
      !ID.test(asset.id) ||
      assetIds.has(asset.id) ||
      !SHA256.test(asset.sha256) ||
      !Number.isInteger(asset.bytes) ||
      asset.bytes <= 0 ||
      !asset.source?.ref ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(asset.source.ref) ||
      !asset.source.url ||
      !asset.localPath ||
      !asset.license?.expression ||
      !asset.license.path ||
      !Array.isArray(asset.processingHistory) ||
      asset.processingHistory.length === 0
    ) {
      errors.push(
        `Invalid or duplicate sound asset ${asset?.id ?? "<unknown>"}.`,
      );
      continue;
    }
    if (
      asset.source.container !== undefined &&
      (asset.source.container.format !== "7z" ||
        !Number.isInteger(asset.source.container.bytes) ||
        asset.source.container.bytes <= 0 ||
        !SHA256.test(asset.source.container.sha256) ||
        !asset.source.container.memberPath ||
        asset.source.ref !== asset.source.container.sha256 ||
        asset.source.path !== asset.source.container.memberPath)
    ) {
      errors.push(`Asset ${asset.id} has invalid source-container facts.`);
    }
    if (
      asset.processingHistory.some(
        (step) =>
          !step.operation ||
          !step.tool ||
          !SHA256.test(step.inputSha256) ||
          !SHA256.test(step.outputSha256) ||
          !isRecord(step.parameters),
      )
    ) {
      errors.push(
        `Asset ${asset.id} has invalid structured processing history.`,
      );
    }
    if (
      asset.kind === "wav" &&
      (!asset.audio ||
        !Number.isInteger(asset.audio.sampleRate) ||
        asset.audio.sampleRate <= 0 ||
        !Number.isInteger(asset.audio.frameCount) ||
        asset.audio.frameCount <= 0 ||
        ![1, 2].includes(asset.audio.channels))
    ) {
      errors.push(`WAV asset ${asset.id} has invalid audio metadata.`);
    }
    assetIds.add(asset.id);
    assets.set(asset.id, asset);
  }
  const candidateIds = new Set<string>();
  for (const untyped of value.candidates) {
    const candidate = untyped as InstrumentCandidate;
    if (
      !isRecord(untyped) ||
      !ID.test(candidate.id) ||
      candidateIds.has(candidate.id) ||
      !instrumentIds.has(candidate.instrumentId) ||
      !["soundfont", "sampler", "synth"].includes(candidate.engine) ||
      !Number.isFinite(candidate.calibrationGainDb) ||
      !isRecord(candidate.mapping)
    ) {
      errors.push(
        `Invalid or duplicate sound candidate ${candidate?.id ?? "<unknown>"}.`,
      );
      continue;
    }
    candidateIds.add(candidate.id);
    const instrument = vocabulary.instruments.find(
      (item) => item.id === candidate.instrumentId,
    );
    const mappingType = candidate.mapping.type;
    if (
      (candidate.engine === "sampler" && mappingType !== "sample-map") ||
      (candidate.engine === "synth" && mappingType !== "midi-fallback") ||
      (candidate.engine === "soundfont" &&
        mappingType !== "program" &&
        mappingType !== "percussion-kit")
    ) {
      errors.push(`Candidate ${candidate.id} has an engine/mapping mismatch.`);
    }
    if (candidate.engine === "synth" && !candidate.patch)
      errors.push(`Synth candidate ${candidate.id} has no patch.`);
    else if (candidate.engine === "synth") {
      for (const error of validateSynthPatch(candidate.patch))
        errors.push(`Synth candidate ${candidate.id}: ${error}`);
    }
    if (candidate.engine !== "synth" && candidate.patch)
      errors.push(
        `Non-synth candidate ${candidate.id} must not contain a synth patch.`,
      );
    if (
      (mappingType === "program" || mappingType === "midi-fallback") &&
      !validMidi(candidate.mapping.program)
    ) {
      errors.push(`Candidate ${candidate.id} has an invalid MIDI program.`);
    }
    if (
      mappingType === "percussion-kit" &&
      (!candidate.mapping.supportedNotes.length ||
        candidate.mapping.supportedNotes.some((note) => !validMidi(note)))
    ) {
      errors.push(`Candidate ${candidate.id} has an invalid percussion map.`);
    }
    if (candidate.engine === "soundfont") {
      const asset = candidate.assetId
        ? assets.get(candidate.assetId)
        : undefined;
      if (!asset || asset.kind !== "soundfont")
        errors.push(`SoundFont candidate ${candidate.id} has no bank asset.`);
      if (
        !Number.isFinite(candidate.tailSeconds) ||
        Number(candidate.tailSeconds) <= 0
      )
        errors.push(
          `SoundFont candidate ${candidate.id} must declare a positive tail.`,
        );
    } else if (candidate.assetId !== undefined) {
      errors.push(
        `Candidate ${candidate.id} must resolve assets through its implementation mapping.`,
      );
    }
    errors.push(...validateSampleMap(candidate, assets));
    if (candidate.releaseStatus === "release-candidate") {
      const referencedAssetIds = new Set<string>();
      if (candidate.assetId) referencedAssetIds.add(candidate.assetId);
      if (candidate.mapping.type === "sample-map") {
        for (const region of candidate.mapping.regions)
          referencedAssetIds.add(region.assetId);
      }
      for (const assetId of referencedAssetIds) {
        if (assets.get(assetId)?.releaseStatus !== "release-candidate") {
          errors.push(
            `Release candidate ${candidate.id} depends on non-release asset ${assetId}.`,
          );
        }
      }
    }
    if (
      candidate.releaseStatus === "release-candidate" &&
      candidate.mapping.type === "sample-map" &&
      instrument
    ) {
      const mapping = candidate.mapping;
      const requiredMidis =
        instrument.supportedNotes === undefined
          ? Array.from(
              { length: mapping.playableMax - mapping.playableMin + 1 },
              (_, index) => mapping.playableMin + index,
            )
          : [...instrument.supportedNotes];
      if (
        mapping.playableMin !== instrument.midiMin ||
        mapping.playableMax !== instrument.midiMax
      ) {
        errors.push(
          `Release candidate ${candidate.id} must cover the complete ${instrument.id} range.`,
        );
      }
      const articulations: MusicalArticulation[] = [
        "none",
        "staccato",
        "tenuto",
        "accent",
        "legato",
      ];
      let gap: string | undefined;
      for (const requested of articulations) {
        let resolved: MusicalArticulation | undefined = requested;
        const seen = new Set<string>();
        while (
          resolved !== undefined &&
          !seen.has(resolved) &&
          !mapping.regions.some(
            (region) =>
              region.trigger === "attack" && region.articulation === resolved,
          )
        ) {
          seen.add(resolved);
          resolved = mapping.articulationFallbacks[resolved];
        }
        if (!resolved || seen.has(resolved)) {
          gap = `${requested} articulation`;
          break;
        }
        for (const midi of requiredMidis) {
          for (let velocity = 1; velocity <= 127; velocity += 1) {
            if (
              !mapping.regions.some(
                (region) =>
                  region.trigger === "attack" &&
                  region.articulation === resolved &&
                  midi >= region.pitch.minMidi &&
                  midi <= region.pitch.maxMidi &&
                  velocity >= region.velocity.min &&
                  velocity <= region.velocity.max,
              )
            ) {
              gap = `${requested} at MIDI ${midi}, velocity ${velocity}`;
              break;
            }
          }
          if (gap) break;
        }
        if (gap) break;
      }
      if (gap)
        errors.push(
          `Release candidate ${candidate.id} has a coverage gap: ${gap}.`,
        );
    }
  }
  return errors;
}

export const INSTRUMENT_VOCABULARY: Readonly<InstrumentVocabulary> =
  vocabularyJson as InstrumentVocabulary;

function registryFromCandidateShards(): SoundpackManifest {
  const shards = candidateShardJson as unknown as ReadonlyArray<{
    candidate: InstrumentCandidate;
    assets: SoundAssetDefinition[];
  }>;
  const assets = new Map<string, SoundAssetDefinition>();
  for (const shard of shards) {
    for (const asset of shard.assets) {
      const existing = assets.get(asset.id);
      if (
        existing &&
        (existing.sha256 !== asset.sha256 || existing.bytes !== asset.bytes)
      )
        throw new Error(`Asset identity collision for ${asset.id}.`);
      assets.set(asset.id, asset);
    }
  }
  const core = {
    format: "refrain-soundpack@1-experimental" as const,
    id: `${catalogJson.id}-registry`,
    status: "development-candidates" as const,
    assets: [...assets.values()],
    candidates: shards.map((shard) => shard.candidate),
  };
  return { ...core, contentSha256: soundObjectContentSha256(core) };
}

export const SOUND_REGISTRY: Readonly<SoundpackManifest> =
  registryFromCandidateShards();

const vocabularyErrors = validateInstrumentVocabulary(INSTRUMENT_VOCABULARY);
if (vocabularyErrors.length) throw new Error(vocabularyErrors.join("\n"));
const manifestErrors = validateSoundpackManifest(SOUND_REGISTRY);
if (manifestErrors.length) throw new Error(manifestErrors.join("\n"));

export const INSTRUMENTS: readonly InstrumentDefinition[] =
  INSTRUMENT_VOCABULARY.instruments;
export type InstrumentId = (typeof INSTRUMENTS)[number]["id"];
export const instrumentById = new Map(
  INSTRUMENTS.map((instrument) => [instrument.id, instrument]),
);
export const SOUND_ASSETS: readonly SoundAssetDefinition[] =
  SOUND_REGISTRY.assets;
export const soundAssetById = new Map(
  SOUND_ASSETS.map((asset) => [asset.id, asset]),
);
export const SOUND_CANDIDATES: readonly InstrumentCandidate[] =
  SOUND_REGISTRY.candidates;
export const candidateById = new Map(
  SOUND_CANDIDATES.map((candidate) => [candidate.id, candidate]),
);

export const LISTENING_DECISIONS: readonly ListeningDecision[] = (
  decisionsJson as { decisions: ListeningDecision[] }
).decisions;

const builtInProfiles = (profilesJson as { profiles: SoundProfile[] }).profiles;

export function validateSoundProfileContract(profile: unknown): string[] {
  if (!isRecord(profile)) return ["SoundProfile must be an object."];
  const errors: string[] = [];
  if (
    !exactKeys(profile, [
      "contentSha256",
      "format",
      "id",
      "selections",
      "vocabulary",
    ])
  )
    errors.push("SoundProfile must use the closed current contract.");
  if (profile.format !== "refrain-sound-profile@1-experimental")
    errors.push("Invalid SoundProfile format.");
  if (typeof profile.id !== "string" || !ID.test(profile.id))
    errors.push("Invalid SoundProfile ID.");
  if (
    typeof profile.contentSha256 !== "string" ||
    !SHA256.test(profile.contentSha256)
  )
    errors.push("Invalid SoundProfile content SHA-256.");
  else if (profile.contentSha256 !== soundObjectContentSha256(profile))
    errors.push("SoundProfile content SHA-256 does not match its content.");

  const reference = profile.vocabulary;
  if (!isRecord(reference)) {
    errors.push("SoundProfile vocabulary reference must be an object.");
  } else {
    if (!exactKeys(reference, ["id", "sha256"]))
      errors.push(
        "SoundProfile vocabulary reference must use the closed current contract.",
      );
    if (typeof reference.id !== "string" || !ID.test(reference.id))
      errors.push("SoundProfile vocabulary reference has an invalid ID.");
    if (typeof reference.sha256 !== "string" || !SHA256.test(reference.sha256))
      errors.push("SoundProfile vocabulary reference has an invalid SHA-256.");
  }

  if (!isRecord(profile.selections)) {
    errors.push("SoundProfile selections must be an object.");
    return errors;
  }
  for (const [instrumentId, selection] of Object.entries(profile.selections)) {
    if (!ID.test(instrumentId))
      errors.push(`SoundProfile selection key ${instrumentId} is invalid.`);
    if (!isRecord(selection)) {
      errors.push(`Selection for ${instrumentId} must be an object.`);
      continue;
    }
    if (
      !exactKeys(selection, [
        "candidateChain",
        "fallbackPolicy",
        ...(selection.profileGainDb === undefined ? [] : ["profileGainDb"]),
      ])
    )
      errors.push(
        `Selection for ${instrumentId} must use the closed current contract.`,
      );
    if (
      !Array.isArray(selection.candidateChain) ||
      selection.candidateChain.length === 0 ||
      !selection.candidateChain.every(
        (pin) =>
          isRecord(pin) &&
          exactKeys(pin, ["id", "sha256"]) &&
          typeof pin.id === "string" &&
          ID.test(pin.id) &&
          typeof pin.sha256 === "string" &&
          SHA256.test(pin.sha256),
      )
    ) {
      errors.push(
        `Selection for ${instrumentId} must contain a non-empty exact candidate-pin chain.`,
      );
    } else if (
      new Set(
        selection.candidateChain.map((pin) =>
          isRecord(pin) ? String(pin.id) : "",
        ),
      ).size !== selection.candidateChain.length
    ) {
      errors.push(
        `Selection for ${instrumentId} contains duplicate candidates.`,
      );
    }
    if (
      selection.fallbackPolicy !== "strict" &&
      selection.fallbackPolicy !== "whole-identity-audition"
    ) {
      errors.push(
        `Selection for ${instrumentId} has invalid fallback policy ${String(selection.fallbackPolicy)}.`,
      );
    } else if (
      selection.fallbackPolicy === "strict" &&
      Array.isArray(selection.candidateChain) &&
      selection.candidateChain.length !== 1
    ) {
      errors.push(
        `Strict selection for ${instrumentId} must contain exactly one candidate.`,
      );
    }
    if (
      selection.profileGainDb !== undefined &&
      (typeof selection.profileGainDb !== "number" ||
        !Number.isFinite(selection.profileGainDb))
    ) {
      errors.push(`Selection for ${instrumentId} has invalid profile gain.`);
    }
  }
  return errors;
}

function soundProfileStructureIsUsable(value: unknown): value is SoundProfile {
  return (
    isRecord(value) &&
    isRecord(value.vocabulary) &&
    isRecord(value.selections) &&
    Object.values(value.selections).every(
      (selection) =>
        isRecord(selection) && Array.isArray(selection.candidateChain),
    )
  );
}

export function validateSoundProfile(
  profile: unknown,
  manifest: SoundpackManifest = SOUND_REGISTRY,
  vocabulary: InstrumentVocabulary = INSTRUMENT_VOCABULARY,
): string[] {
  const errors = validateSoundProfileContract(profile);
  if (!soundProfileStructureIsUsable(profile)) return errors;
  if (
    profile.vocabulary.id !== vocabulary.id ||
    profile.vocabulary.sha256 !== vocabulary.contentSha256
  ) {
    errors.push(
      "SoundProfile vocabulary reference does not match the active vocabulary.",
    );
  }
  const candidates = new Map(
    manifest.candidates.map((item) => [item.id, item]),
  );
  const active = vocabulary.instruments.filter(
    (item) => item.status === "active",
  );
  for (const instrument of active) {
    const selection = profile.selections[instrument.id];
    if (!selection || selection.candidateChain.length === 0) {
      errors.push(`SoundProfile has no selection for ${instrument.id}.`);
      continue;
    }
    for (const pin of selection.candidateChain) {
      const candidate = candidates.get(pin.id);
      if (!candidate)
        errors.push(`SoundProfile references unknown candidate ${pin.id}.`);
      else if (candidate.instrumentId !== instrument.id)
        errors.push(`Candidate ${pin.id} does not implement ${instrument.id}.`);
      else if (candidateContentSha256(candidate, manifest) !== pin.sha256)
        errors.push(`SoundProfile candidate pin does not match ${pin.id}.`);
    }
  }
  for (const instrumentId of Object.keys(profile.selections)) {
    if (!vocabulary.instruments.some((item) => item.id === instrumentId))
      errors.push(`SoundProfile selects unknown instrument ${instrumentId}.`);
  }
  return errors;
}

for (const profile of builtInProfiles) {
  const errors = validateSoundProfile(profile);
  if (errors.length) throw new Error(errors.join("\n"));
}

export const BUILT_IN_SOUND_PROFILES: readonly SoundProfile[] = builtInProfiles;
export const G3A_AUDITION_SOUND_PROFILE = builtInProfiles.find(
  (profile) => profile.id === "g3a-audition@1",
)!;
export const G3B_VCSL_LISTENING_SOUND_PROFILE = builtInProfiles.find(
  (profile) => profile.id === "g3b-vcsl-listening@1",
)!;
export const E_VSCO_WIND_PILOT_SOUND_PROFILE = builtInProfiles.find(
  (profile) => profile.id === "e-vsco-wind-pilots@1",
)!;
export const F_ACOUSTIC_CHAMBER_SOUND_PROFILE = builtInProfiles.find(
  (profile) => profile.id === "f-acoustic-chamber@1",
)!;
export const F_LUMINOUS_HYBRID_SOUND_PROFILE = builtInProfiles.find(
  (profile) => profile.id === "f-luminous-hybrid@1",
)!;
export const F_LOFI_DEGRADED_SOUND_PROFILE = builtInProfiles.find(
  (profile) => profile.id === "f-lofi-degraded@1",
)!;
export const F_SYNTHETIC_BEAT_SOUND_PROFILE = builtInProfiles.find(
  (profile) => profile.id === "f-synthetic-beat@1",
)!;

export function candidatesForInstrument(
  instrumentId: string,
  manifest: SoundpackManifest = SOUND_REGISTRY,
): InstrumentCandidate[] {
  return manifest.candidates.filter(
    (candidate) => candidate.instrumentId === instrumentId,
  );
}

export function candidateForInstrument(
  instrumentId: string,
  candidateId: string,
  manifest: SoundpackManifest = SOUND_REGISTRY,
): InstrumentCandidate {
  const candidate = manifest.candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error(`Unknown sound candidate ${candidateId}.`);
  if (candidate.instrumentId !== instrumentId)
    throw new Error(
      `Candidate ${candidateId} does not implement ${instrumentId}.`,
    );
  return candidate;
}

export function soundProfileWithCandidates(
  base: SoundProfile,
  overrides: Readonly<Record<string, string>>,
  id = `${base.id}-runtime-selection`,
): SoundProfile {
  const selections = { ...base.selections };
  for (const [instrumentId, candidateId] of Object.entries(overrides)) {
    const candidate = candidateForInstrument(instrumentId, candidateId);
    selections[instrumentId] = {
      candidateChain: [
        {
          id: candidateId,
          sha256: candidateContentSha256(candidate),
        },
      ],
      fallbackPolicy: "strict",
    };
  }
  const core = {
    format: base.format,
    id,
    vocabulary: { ...base.vocabulary },
    selections,
  };
  const profile: SoundProfile = {
    ...core,
    contentSha256: soundObjectContentSha256(core),
  };
  const errors = validateSoundProfile(profile);
  if (errors.length) throw new Error(errors.join("\n"));
  return profile;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => key !== "contentSha256")
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

export function canonicalSoundObjectJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function soundObjectContentSha256(value: unknown): string {
  return sha256Hex(canonicalSoundObjectJson(value));
}

export function soundProfileContentSha256(profile: SoundProfile): string {
  return soundObjectContentSha256(profile);
}

export function candidateContentSha256(
  candidate: InstrumentCandidate,
  manifest: SoundpackManifest = SOUND_REGISTRY,
): string {
  const assetIds = new Set<string>();
  if (candidate.assetId) assetIds.add(candidate.assetId);
  if (candidate.mapping.type === "sample-map") {
    for (const region of candidate.mapping.regions)
      assetIds.add(region.assetId);
  }
  const assets = [...assetIds]
    .map((assetId) => manifest.assets.find((asset) => asset.id === assetId))
    .filter((asset): asset is SoundAssetDefinition => asset !== undefined)
    .map((asset) => ({
      id: asset.id,
      bytes: asset.bytes,
      sha256: asset.sha256,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return soundObjectContentSha256({ candidate, assets });
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expected].sort())
  );
}

export function validateRenderScene(value: unknown): string[] {
  if (!isRecord(value)) return ["RenderScene must be an object."];
  const errors: string[] = [];
  if (
    !exactKeys(value, [
      "contentSha256",
      "format",
      "id",
      "masterGainDb",
      "peakCeiling",
      "velocityScale",
    ])
  )
    errors.push("RenderScene must use the closed current contract.");
  if (value.format !== RENDER_SCENE_FORMAT)
    errors.push("Invalid RenderScene format.");
  if (typeof value.id !== "string" || !ID.test(value.id))
    errors.push("Invalid RenderScene ID.");
  if (
    typeof value.masterGainDb !== "number" ||
    !Number.isFinite(value.masterGainDb) ||
    value.masterGainDb < -60 ||
    value.masterGainDb > -6
  )
    errors.push("RenderScene masterGainDb must be between -60 and -6.");
  if (
    typeof value.peakCeiling !== "number" ||
    !Number.isFinite(value.peakCeiling) ||
    value.peakCeiling < 0.05 ||
    value.peakCeiling > 1
  )
    errors.push("RenderScene peakCeiling must be between 0.05 and 1.");
  if (
    typeof value.velocityScale !== "number" ||
    !Number.isFinite(value.velocityScale) ||
    value.velocityScale < 0.05 ||
    value.velocityScale > 2
  )
    errors.push("RenderScene velocityScale must be between 0.05 and 2.");
  if (
    typeof value.contentSha256 !== "string" ||
    !SHA256.test(value.contentSha256)
  )
    errors.push("Invalid RenderScene content SHA-256.");
  else if (value.contentSha256 !== soundObjectContentSha256(value))
    errors.push("RenderScene content SHA-256 does not match its content.");
  return errors;
}

export function createRenderScene(
  input: Omit<RenderScene, "contentSha256" | "format">,
): RenderScene {
  const core = { format: RENDER_SCENE_FORMAT, ...input };
  const scene: RenderScene = {
    ...core,
    contentSha256: soundObjectContentSha256(core),
  };
  const errors = validateRenderScene(scene);
  if (errors.length) throw new Error(errors.join("\n"));
  return scene;
}

export function validateSoundPalette(
  value: unknown,
  soundProfile?: SoundProfile,
  renderScene?: RenderScene,
): string[] {
  if (!isRecord(value)) return ["SoundPalette must be an object."];
  const errors: string[] = [];
  if (
    !exactKeys(value, [
      "authoringGuide",
      "constraints",
      "contentSha256",
      "descriptors",
      "format",
      "id",
      "intentionalContrasts",
      "renderScene",
      "soundProfile",
      "status",
      "strengths",
    ])
  )
    errors.push("SoundPalette must use the closed current contract.");
  if (value.format !== SOUND_PALETTE_FORMAT)
    errors.push("Invalid SoundPalette format.");
  if (typeof value.id !== "string" || !ID.test(value.id))
    errors.push("Invalid SoundPalette ID.");
  if (
    ![
      "engineering",
      "listening-candidate",
      "listening-accepted",
      "release-candidate",
    ].includes(String(value.status))
  )
    errors.push("Invalid SoundPalette status.");
  for (const key of [
    "descriptors",
    "strengths",
    "constraints",
    "intentionalContrasts",
  ] as const) {
    const list = value[key];
    if (
      !Array.isArray(list) ||
      !list.every((item) => typeof item === "string" && item.length > 0)
    )
      errors.push(`SoundPalette ${key} must be a string array.`);
  }
  if (
    typeof value.authoringGuide !== "string" ||
    value.authoringGuide.length === 0 ||
    value.authoringGuide.length > 2000
  )
    errors.push("SoundPalette authoringGuide must contain 1-2000 characters.");
  if (
    !isRecord(value.soundProfile) ||
    !exactKeys(value.soundProfile, ["id", "sha256"]) ||
    typeof value.soundProfile.id !== "string" ||
    !ID.test(value.soundProfile.id) ||
    typeof value.soundProfile.sha256 !== "string" ||
    !SHA256.test(value.soundProfile.sha256)
  )
    errors.push("SoundPalette needs an exact SoundProfile reference.");
  if (
    !isRecord(value.renderScene) ||
    !exactKeys(value.renderScene, ["id", "sha256"]) ||
    typeof value.renderScene.id !== "string" ||
    !ID.test(value.renderScene.id) ||
    typeof value.renderScene.sha256 !== "string" ||
    !SHA256.test(value.renderScene.sha256)
  )
    errors.push("SoundPalette needs an exact RenderScene reference.");
  if (soundProfile && isRecord(value.soundProfile)) {
    if (
      value.soundProfile.id !== soundProfile.id ||
      value.soundProfile.sha256 !== soundProfileContentSha256(soundProfile)
    )
      errors.push("SoundPalette SoundProfile reference does not match.");
  }
  if (renderScene && isRecord(value.renderScene)) {
    if (
      value.renderScene.id !== renderScene.id ||
      value.renderScene.sha256 !== renderScene.contentSha256
    )
      errors.push("SoundPalette RenderScene reference does not match.");
  }
  if (
    typeof value.contentSha256 !== "string" ||
    !SHA256.test(value.contentSha256)
  )
    errors.push("Invalid SoundPalette content SHA-256.");
  else if (value.contentSha256 !== soundObjectContentSha256(value))
    errors.push("SoundPalette content SHA-256 does not match its content.");
  return errors;
}

export function createSoundPalette(
  input: CreateSoundPaletteInput,
): SoundPalette {
  const core = {
    format: SOUND_PALETTE_FORMAT,
    id: input.id,
    status: input.status,
    soundProfile: {
      id: input.soundProfile.id,
      sha256: soundProfileContentSha256(input.soundProfile),
    },
    renderScene: {
      id: input.renderScene.id,
      sha256: input.renderScene.contentSha256,
    },
    authoringGuide: input.authoringGuide,
    descriptors: [...(input.descriptors ?? [])],
    strengths: [...(input.strengths ?? [])],
    constraints: [...(input.constraints ?? [])],
    intentionalContrasts: [...(input.intentionalContrasts ?? [])],
  };
  const palette: SoundPalette = {
    ...core,
    contentSha256: soundObjectContentSha256(core),
  };
  const errors = validateSoundPalette(
    palette,
    input.soundProfile,
    input.renderScene,
  );
  if (errors.length) throw new Error(errors.join("\n"));
  return palette;
}

function expectedCandidateDigests(
  profile: SoundProfile,
  manifest: SoundpackManifest,
): Record<string, string> {
  const candidateMap = new Map(
    manifest.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const pins = new Map<string, string>();
  for (const selection of Object.values(profile.selections)) {
    for (const pin of selection.candidateChain) {
      const existing = pins.get(pin.id);
      if (existing && existing !== pin.sha256)
        throw new Error(`SoundProfile pins two identities for ${pin.id}.`);
      pins.set(pin.id, pin.sha256);
    }
  }
  return Object.fromEntries(
    [...pins]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([candidateId, pinnedSha256]) => {
        const candidate = candidateMap.get(candidateId);
        if (!candidate)
          throw new Error(`Unknown sound candidate ${candidateId}.`);
        const actual = candidateContentSha256(candidate, manifest);
        if (actual !== pinnedSha256)
          throw new Error(
            `SoundProfile candidate pin does not match ${candidateId}.`,
          );
        return [candidateId, pinnedSha256];
      }),
  );
}

function validOverrideValue(
  key: PerformanceOverrideKey,
  value: unknown,
): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (key === "masterGainDb") return value >= -60 && value <= -6;
  if (key === "peakCeiling") return value >= 0.05 && value <= 1;
  return value >= 0.05 && value <= 2;
}

function performanceBindingStructureIsUsable(
  value: unknown,
): value is PerformanceBinding {
  return (
    isRecord(value) &&
    soundProfileStructureIsUsable(value.soundProfile) &&
    isRecord(value.renderScene) &&
    (value.soundPalette === undefined || isRecord(value.soundPalette)) &&
    isRecord(value.candidateDigests) &&
    Array.isArray(value.permittedOverrides) &&
    isRecord(value.overrides) &&
    isRecord(value.renderer)
  );
}

export function validateHistoricalPerformanceBinding(value: unknown): string[] {
  if (!isRecord(value)) return ["PerformanceBinding must be an object."];
  const errors: string[] = [];
  const hasPalette = value.soundPalette !== undefined;
  if (
    !exactKeys(value, [
      "candidateDigests",
      "contentSha256",
      "format",
      "id",
      "overrides",
      "permittedOverrides",
      "renderScene",
      "renderer",
      "soundProfile",
      "soundProfileSha256",
      ...(hasPalette ? ["soundPalette", "soundPaletteSha256"] : []),
    ])
  )
    errors.push("PerformanceBinding must use the closed current contract.");
  if (value.format !== PERFORMANCE_BINDING_FORMAT)
    errors.push("Invalid PerformanceBinding format.");
  if (typeof value.id !== "string" || !ID.test(value.id))
    errors.push("Invalid PerformanceBinding ID.");
  if (!isRecord(value.soundProfile)) {
    errors.push("PerformanceBinding needs a complete SoundProfile.");
  } else {
    try {
      errors.push(...validateSoundProfileContract(value.soundProfile));
      const digest = soundProfileContentSha256(
        value.soundProfile as unknown as SoundProfile,
      );
      if (value.soundProfileSha256 !== digest)
        errors.push("PerformanceBinding SoundProfile digest does not match.");
    } catch {
      errors.push("PerformanceBinding SoundProfile is malformed.");
    }
  }
  errors.push(...validateRenderScene(value.renderScene));
  if (hasPalette) {
    errors.push(
      ...validateSoundPalette(
        value.soundPalette,
        isRecord(value.soundProfile)
          ? (value.soundProfile as unknown as SoundProfile)
          : undefined,
        isRecord(value.renderScene)
          ? (value.renderScene as unknown as RenderScene)
          : undefined,
      ),
    );
    if (
      !isRecord(value.soundPalette) ||
      value.soundPaletteSha256 !== value.soundPalette.contentSha256
    )
      errors.push("PerformanceBinding SoundPalette digest does not match.");
  } else if (value.soundPaletteSha256 !== undefined) {
    errors.push("PerformanceBinding has a palette digest without a palette.");
  }
  if (!isRecord(value.candidateDigests)) {
    errors.push("PerformanceBinding needs exact candidate digests.");
  } else {
    for (const [candidateId, digest] of Object.entries(
      value.candidateDigests,
    )) {
      if (
        !ID.test(candidateId) ||
        typeof digest !== "string" ||
        !SHA256.test(digest)
      )
        errors.push(
          `PerformanceBinding candidate digest for ${candidateId} is invalid.`,
        );
    }
    if (soundProfileStructureIsUsable(value.soundProfile)) {
      const expectedCandidateIds = [
        ...new Set(
          Object.values(value.soundProfile.selections).flatMap((selection) =>
            selection.candidateChain.map((pin) => pin.id),
          ),
        ),
      ].sort();
      const actualCandidateIds = Object.keys(value.candidateDigests).sort();
      if (
        JSON.stringify(expectedCandidateIds) !==
        JSON.stringify(actualCandidateIds)
      ) {
        errors.push(
          "PerformanceBinding candidate digests do not match its SoundProfile chain.",
        );
      }
    }
  }
  const allowedKeys: PerformanceOverrideKey[] = [
    "masterGainDb",
    "peakCeiling",
    "velocityScale",
  ];
  if (
    !Array.isArray(value.permittedOverrides) ||
    !value.permittedOverrides.every(
      (item) =>
        typeof item === "string" &&
        allowedKeys.includes(item as PerformanceOverrideKey),
    ) ||
    new Set(value.permittedOverrides).size !== value.permittedOverrides.length
  )
    errors.push("PerformanceBinding permittedOverrides are invalid.");
  if (!isRecord(value.overrides)) {
    errors.push("PerformanceBinding overrides must be an object.");
  } else {
    for (const [key, override] of Object.entries(value.overrides)) {
      if (!allowedKeys.includes(key as PerformanceOverrideKey)) {
        errors.push(`PerformanceBinding has unknown override ${key}.`);
        continue;
      }
      if (
        !Array.isArray(value.permittedOverrides) ||
        !value.permittedOverrides.includes(key)
      )
        errors.push(`PerformanceBinding overrides ${key} without permission.`);
      if (!validOverrideValue(key as PerformanceOverrideKey, override))
        errors.push(`PerformanceBinding override ${key} is out of range.`);
    }
  }
  if (!isRecord(value.renderer)) {
    errors.push("PerformanceBinding needs renderer compatibility facts.");
  } else if (
    !exactKeys(value.renderer, [
      "adapters",
      "contract",
      "performancePlanFormat",
    ]) ||
    typeof value.renderer.contract !== "string" ||
    !/^refrain-renderer@\d+-experimental$/.test(value.renderer.contract) ||
    typeof value.renderer.performancePlanFormat !== "string" ||
    !/^performance-plan@\d+-experimental$/.test(
      value.renderer.performancePlanFormat,
    ) ||
    !Array.isArray(value.renderer.adapters) ||
    value.renderer.adapters.length === 0 ||
    !value.renderer.adapters.every(
      (adapter) => typeof adapter === "string" && adapter.length > 0,
    ) ||
    new Set(value.renderer.adapters).size !== value.renderer.adapters.length
  ) {
    errors.push("PerformanceBinding renderer compatibility is malformed.");
  }
  if (
    typeof value.contentSha256 !== "string" ||
    !SHA256.test(value.contentSha256)
  )
    errors.push("Invalid PerformanceBinding content SHA-256.");
  else if (value.contentSha256 !== soundObjectContentSha256(value))
    errors.push(
      "PerformanceBinding content SHA-256 does not match its content.",
    );
  return errors;
}

function rendererCompatibilityIsSupported(
  renderer: PerformanceBinding["renderer"],
): boolean {
  const legacy =
    renderer.contract === REFRAIN_RENDERER_CONTRACT &&
    renderer.performancePlanFormat === PERFORMANCE_PLAN_FORMAT &&
    JSON.stringify(renderer.adapters) === JSON.stringify(RENDER_ADAPTERS);
  const completePiece =
    renderer.contract === COMPLETE_PIECE_RENDERER_CONTRACT &&
    renderer.performancePlanFormat === COMPLETE_PIECE_PERFORMANCE_PLAN_FORMAT &&
    JSON.stringify(renderer.adapters) ===
      JSON.stringify(COMPLETE_PIECE_RENDER_ADAPTERS);
  return legacy || completePiece;
}

export function validatePerformanceBinding(
  value: unknown,
  manifest: SoundpackManifest = SOUND_REGISTRY,
  vocabulary: InstrumentVocabulary = INSTRUMENT_VOCABULARY,
): string[] {
  const errors = validateHistoricalPerformanceBinding(value);
  if (!performanceBindingStructureIsUsable(value)) return errors;
  for (const error of validateSoundProfile(
    value.soundProfile,
    manifest,
    vocabulary,
  )) {
    if (!errors.includes(error)) errors.push(error);
  }
  try {
    const expected = expectedCandidateDigests(value.soundProfile, manifest);
    for (const [candidateId, digest] of Object.entries(expected)) {
      if (value.candidateDigests[candidateId] !== digest)
        errors.push(
          `PerformanceBinding candidate digest does not match ${candidateId}.`,
        );
    }
    for (const candidateId of Object.keys(value.candidateDigests)) {
      if (!(candidateId in expected))
        errors.push(
          `PerformanceBinding contains unselected candidate ${candidateId}.`,
        );
    }
  } catch (cause) {
    errors.push(cause instanceof Error ? cause.message : "Invalid candidates.");
  }
  if (!rendererCompatibilityIsSupported(value.renderer)) {
    errors.push("PerformanceBinding renderer compatibility does not match.");
  }
  return errors;
}

export type PerformanceBindingUnavailableReason =
  | "performance-binding-invalid"
  | "instrument-vocabulary-not-installed"
  | "renderer-contract-not-supported"
  | "candidate-not-installed"
  | "candidate-content-mismatch"
  | "soundfont-origin-missing"
  | "sample-origin-missing"
  | "runtime-validation-failed";

export type PerformanceBindingRuntimeStatus =
  | { status: "available" }
  | {
      status: "unavailable";
      reason: PerformanceBindingUnavailableReason;
      message: string;
      errors: string[];
    };

function unavailablePerformanceBinding(
  reason: PerformanceBindingUnavailableReason,
  message: string,
  errors: string[] = [message],
): PerformanceBindingRuntimeStatus {
  return { status: "unavailable", reason, message, errors };
}

export function resolvePerformanceBindingAgainstRuntime(
  value: unknown,
  manifest: SoundpackManifest = SOUND_REGISTRY,
  vocabulary: InstrumentVocabulary = INSTRUMENT_VOCABULARY,
): PerformanceBindingRuntimeStatus {
  const historicalErrors = validateHistoricalPerformanceBinding(value);
  if (historicalErrors.length || !performanceBindingStructureIsUsable(value))
    return unavailablePerformanceBinding(
      "performance-binding-invalid",
      "The historical PerformanceBinding is not internally valid.",
      historicalErrors,
    );
  if (
    value.soundProfile.vocabulary.id !== vocabulary.id ||
    value.soundProfile.vocabulary.sha256 !== vocabulary.contentSha256
  )
    return unavailablePerformanceBinding(
      "instrument-vocabulary-not-installed",
      `Instrument vocabulary ${value.soundProfile.vocabulary.id} sha256:${value.soundProfile.vocabulary.sha256} is not installed.`,
    );
  if (!rendererCompatibilityIsSupported(value.renderer))
    return unavailablePerformanceBinding(
      "renderer-contract-not-supported",
      `Renderer ${String(value.renderer.contract)} with ${String(value.renderer.performancePlanFormat)} is not supported.`,
    );
  for (const candidateId of Object.keys(value.candidateDigests).sort()) {
    const candidate = manifest.candidates.find(
      (item) => item.id === candidateId,
    );
    if (!candidate)
      return unavailablePerformanceBinding(
        "candidate-not-installed",
        `Sound candidate ${candidateId} is not installed.`,
      );
    if (
      value.candidateDigests[candidateId] !==
      candidateContentSha256(candidate, manifest)
    )
      return unavailablePerformanceBinding(
        "candidate-content-mismatch",
        `Sound candidate ${candidateId} does not match the historical content digest.`,
      );
  }
  const runtimeErrors = validatePerformanceBinding(value, manifest, vocabulary);
  if (runtimeErrors.length)
    return unavailablePerformanceBinding(
      "runtime-validation-failed",
      "The historical PerformanceBinding cannot be resolved by this runtime.",
      runtimeErrors,
    );
  return { status: "available" };
}

export function performanceBindingShapeIsValid(
  value: unknown,
): value is PerformanceBinding {
  return validateHistoricalPerformanceBinding(value).length === 0;
}

export function createPerformanceBinding(
  input: CreatePerformanceBindingInput,
  manifest: SoundpackManifest = SOUND_REGISTRY,
): PerformanceBinding {
  const core = {
    format: PERFORMANCE_BINDING_FORMAT,
    id: input.id,
    soundProfile: structuredClone(input.soundProfile),
    soundProfileSha256: soundProfileContentSha256(input.soundProfile),
    renderScene: structuredClone(input.renderScene),
    ...(input.soundPalette === undefined
      ? {}
      : {
          soundPalette: structuredClone(input.soundPalette),
          soundPaletteSha256: input.soundPalette.contentSha256,
        }),
    candidateDigests: expectedCandidateDigests(input.soundProfile, manifest),
    permittedOverrides: [...(input.permittedOverrides ?? [])].sort(),
    overrides: { ...(input.overrides ?? {}) },
    renderer: structuredClone(
      input.renderer ?? {
        contract: REFRAIN_RENDERER_CONTRACT,
        performancePlanFormat: PERFORMANCE_PLAN_FORMAT,
        adapters: [...RENDER_ADAPTERS],
      },
    ),
  };
  const binding: PerformanceBinding = {
    ...core,
    contentSha256: soundObjectContentSha256(core),
  };
  const errors = validatePerformanceBinding(binding, manifest);
  if (errors.length) throw new Error(errors.join("\n"));
  return binding;
}

export const DEFAULT_RENDER_SCENE: Readonly<RenderScene> = createRenderScene({
  id: "transparent-native@0",
  masterGainDb: -9,
  peakCeiling: 0.72,
  velocityScale: 1,
});

export const F_ACOUSTIC_CHAMBER_SCENE: Readonly<RenderScene> =
  createRenderScene({
    id: "f-acoustic-chamber-native@0",
    masterGainDb: -11,
    peakCeiling: 0.72,
    velocityScale: 1,
  });

export const F_LUMINOUS_HYBRID_SCENE: Readonly<RenderScene> = createRenderScene(
  {
    id: "f-luminous-hybrid-native@0",
    masterGainDb: -12,
    peakCeiling: 0.68,
    velocityScale: 0.95,
  },
);

export const F_LOFI_DEGRADED_SCENE: Readonly<RenderScene> = createRenderScene({
  id: "f-lofi-degraded-native@0",
  masterGainDb: -10,
  peakCeiling: 0.58,
  velocityScale: 0.9,
});

export const F_SYNTHETIC_BEAT_SCENE: Readonly<RenderScene> = createRenderScene({
  id: "f-synthetic-beat-native@0",
  masterGainDb: -13,
  peakCeiling: 0.64,
  velocityScale: 1.05,
});

export const ENGINEERING_AUDITION_PALETTE: Readonly<SoundPalette> =
  createSoundPalette({
    id: "engineering-audition@0",
    status: "engineering",
    soundProfile: G3A_AUDITION_SOUND_PROFILE,
    renderScene: DEFAULT_RENDER_SCENE,
    authoringGuide:
      "A transparent engineering room for exact AIR inspection and fallback audition; do not treat it as Refrain release identity.",
    descriptors: ["transparent", "engineering", "audition"],
    strengths: ["stable fallback coverage", "native amplitude evidence"],
    constraints: ["GeneralUser is audition fallback, not release identity"],
    intentionalContrasts: [],
  });

export const G3B_VCSL_LISTENING_PALETTE: Readonly<SoundPalette> =
  createSoundPalette({
    id: "g3b-vcsl-listening@0",
    status: "listening-candidate",
    soundProfile: G3B_VCSL_LISTENING_SOUND_PROFILE,
    renderScene: DEFAULT_RENDER_SCENE,
    authoringGuide:
      "Exercise the current independent acoustic candidates in a transparent scene while preserving whole-identity fallback.",
    descriptors: ["acoustic-first", "listening-candidate", "transparent"],
    strengths: ["candidate A/B", "sparse asset closure"],
    constraints: ["partial identities remain bounded probes"],
    intentionalContrasts: [
      "original synth air_pad and glass_bell remain available",
    ],
  });

export const E_VSCO_WIND_PILOT_PALETTE: Readonly<SoundPalette> =
  createSoundPalette({
    id: "e-vsco-wind-pilots@0",
    status: "listening-candidate",
    soundProfile: E_VSCO_WIND_PILOT_SOUND_PROFILE,
    renderScene: DEFAULT_RENDER_SCENE,
    authoringGuide:
      "Exercise the pinned SFZ-compiled flute and clarinet sustain pilots with explicit whole-identity audition fallback.",
    descriptors: ["woodwind", "sfz-pilot", "transparent"],
    strengths: ["full sustain pitch and velocity coverage", "exact source map"],
    constraints: [
      "sustain articulation only",
      "mechanical candidate; no Faye listening acceptance",
    ],
    intentionalContrasts: ["independent flute and clarinet source mappings"],
  });

export const F_ACOUSTIC_CHAMBER_PALETTE: Readonly<SoundPalette> =
  createSoundPalette({
    id: "f-acoustic-chamber@0",
    status: "listening-candidate",
    soundProfile: F_ACOUSTIC_CHAMBER_SOUND_PROFILE,
    renderScene: F_ACOUSTIC_CHAMBER_SCENE,
    authoringGuide:
      "Write primarily with piano, nylon guitar, harp, chamber strings, solo cello, winds, marimba, and restrained acoustic percussion. Let register, breath, decay, and ensemble handoff carry the form; reserve synthetic identities for one clearly authored contrast rather than ambient filler.",
    descriptors: ["acoustic", "chamber", "breath", "resonant"],
    strengths: [
      "independent full-range acoustic sample identities",
      "lyrical counterpoint and long sectional form",
    ],
    constraints: [
      "Faye listening acceptance pending",
      "articulation requests currently resolve through explicit whole-identity fallbacks",
    ],
    intentionalContrasts: [
      "one sparse glass or air event may puncture the acoustic room",
    ],
  });

export const F_LUMINOUS_HYBRID_PALETTE: Readonly<SoundPalette> =
  createSoundPalette({
    id: "f-luminous-hybrid@0",
    status: "listening-candidate",
    soundProfile: F_LUMINOUS_HYBRID_SOUND_PROFILE,
    renderScene: F_LUMINOUS_HYBRID_SCENE,
    authoringGuide:
      "Interleave harp, flute, marimba, and high strings with air pad, glass bell, lattice pluck, and prism lead. Build brightness through recurrence, register, and complementary attacks; keep the synthetic layer articulated and motif-bearing rather than using it as a generic glow wash.",
    descriptors: ["luminous", "hybrid", "prismatic", "motif-forward"],
    strengths: [
      "acoustic and synthetic attack pairing",
      "clear returning motifs across timbral changes",
    ],
    constraints: [
      "Faye listening acceptance pending",
      "avoid dense sustained stacking above the native ceiling",
    ],
    intentionalContrasts: [
      "rounded clarinet or cello against glass and lattice transients",
    ],
  });

export const F_LOFI_DEGRADED_PALETTE: Readonly<SoundPalette> =
  createSoundPalette({
    id: "f-lofi-degraded@0",
    status: "listening-candidate",
    soundProfile: F_LOFI_DEGRADED_SOUND_PROFILE,
    renderScene: F_LOFI_DEGRADED_SCENE,
    authoringGuide:
      "Use exposed piano, nylon guitar, clarinet, soft percussion, and dust texture in a narrow, worn room. Degradation must come from authored spacing, unstable synthetic partials, repeated fragments, and reduced headroom—not from a hidden mastering preset or indiscriminate noise laid over every section.",
    descriptors: ["lofi", "worn", "close", "deliberately-unstable"],
    strengths: [
      "fragile repetitions and negative space",
      "explicit degraded texture with exact synth identity",
    ],
    constraints: [
      "Faye listening acceptance pending",
      "no tape or saturation transform is implied by the palette name",
    ],
    intentionalContrasts: [
      "an undamaged solo-cello or flute line may surface through the worn field",
    ],
  });

export const F_SYNTHETIC_BEAT_PALETTE: Readonly<SoundPalette> =
  createSoundPalette({
    id: "f-synthetic-beat@0",
    status: "listening-candidate",
    soundProfile: F_SYNTHETIC_BEAT_SOUND_PROFILE,
    renderScene: F_SYNTHETIC_BEAT_SCENE,
    authoringGuide:
      "Let sub bass, rhythm pulse, lattice pluck, prism lead, dust texture, and glass bell own the arrangement. Write beat structure as AIR rhythm and motif recurrence, leaving deliberate holes for transients; acoustic identities are available as quoted bodies or sectional counterweights, never as an automatic orchestral layer.",
    descriptors: ["synthetic", "beat-led", "angular", "spatial"],
    strengths: [
      "explicit electronic pulse and bass roles",
      "deterministic synth parity across realtime and offline renderers",
    ],
    constraints: [
      "Faye listening acceptance pending",
      "rhythm pulse is a tuned electronic identity, not a sampled drum-kit claim",
    ],
    intentionalContrasts: [
      "brief nylon guitar, marimba, or chamber-string quotations",
    ],
  });

export const DEFAULT_PERFORMANCE_BINDING: Readonly<PerformanceBinding> =
  createPerformanceBinding({
    id: "engineering-audition-transparent@0",
    soundProfile: G3A_AUDITION_SOUND_PROFILE,
    renderScene: DEFAULT_RENDER_SCENE,
    soundPalette: ENGINEERING_AUDITION_PALETTE,
    permittedOverrides: ["masterGainDb", "peakCeiling", "velocityScale"],
  });

export const G3B_VCSL_LISTENING_PERFORMANCE_BINDING: Readonly<PerformanceBinding> =
  createPerformanceBinding({
    id: "g3b-vcsl-listening-transparent@0",
    soundProfile: G3B_VCSL_LISTENING_SOUND_PROFILE,
    renderScene: DEFAULT_RENDER_SCENE,
    soundPalette: G3B_VCSL_LISTENING_PALETTE,
    permittedOverrides: ["masterGainDb", "peakCeiling", "velocityScale"],
  });

export const COMPLETE_PIECE_PERFORMANCE_BINDING: Readonly<PerformanceBinding> =
  createPerformanceBinding({
    id: "complete-piece-engineering@0",
    soundProfile: G3A_AUDITION_SOUND_PROFILE,
    renderScene: DEFAULT_RENDER_SCENE,
    soundPalette: ENGINEERING_AUDITION_PALETTE,
    permittedOverrides: ["masterGainDb", "peakCeiling", "velocityScale"],
    renderer: {
      contract: COMPLETE_PIECE_RENDERER_CONTRACT,
      performancePlanFormat: COMPLETE_PIECE_PERFORMANCE_PLAN_FORMAT,
      adapters: [...COMPLETE_PIECE_RENDER_ADAPTERS],
    },
  });

export const COMPLETE_PIECE_VCSL_PERFORMANCE_BINDING: Readonly<PerformanceBinding> =
  createPerformanceBinding({
    id: "complete-piece-vcsl-engineering@0",
    soundProfile: G3B_VCSL_LISTENING_SOUND_PROFILE,
    renderScene: DEFAULT_RENDER_SCENE,
    soundPalette: G3B_VCSL_LISTENING_PALETTE,
    permittedOverrides: ["masterGainDb", "peakCeiling", "velocityScale"],
    renderer: {
      contract: COMPLETE_PIECE_RENDERER_CONTRACT,
      performancePlanFormat: COMPLETE_PIECE_PERFORMANCE_PLAN_FORMAT,
      adapters: [...COMPLETE_PIECE_RENDER_ADAPTERS],
    },
  });

export const E_VSCO_WIND_PILOT_PERFORMANCE_BINDING: Readonly<PerformanceBinding> =
  createPerformanceBinding({
    id: "e-vsco-wind-pilots@0",
    soundProfile: E_VSCO_WIND_PILOT_SOUND_PROFILE,
    renderScene: DEFAULT_RENDER_SCENE,
    soundPalette: E_VSCO_WIND_PILOT_PALETTE,
    permittedOverrides: ["masterGainDb", "peakCeiling", "velocityScale"],
    renderer: {
      contract: COMPLETE_PIECE_RENDERER_CONTRACT,
      performancePlanFormat: COMPLETE_PIECE_PERFORMANCE_PLAN_FORMAT,
      adapters: [...COMPLETE_PIECE_RENDER_ADAPTERS],
    },
  });

function createFCompletePieceBinding(
  id: string,
  soundProfile: SoundProfile,
  soundPalette: SoundPalette,
  renderScene: RenderScene,
): PerformanceBinding {
  return createPerformanceBinding({
    id,
    soundProfile,
    renderScene,
    soundPalette,
    permittedOverrides: ["masterGainDb", "peakCeiling", "velocityScale"],
    renderer: {
      contract: COMPLETE_PIECE_RENDERER_CONTRACT,
      performancePlanFormat: COMPLETE_PIECE_PERFORMANCE_PLAN_FORMAT,
      adapters: [...COMPLETE_PIECE_RENDER_ADAPTERS],
    },
  });
}

export const F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING: Readonly<PerformanceBinding> =
  createFCompletePieceBinding(
    "f-acoustic-chamber@0",
    F_ACOUSTIC_CHAMBER_SOUND_PROFILE,
    F_ACOUSTIC_CHAMBER_PALETTE,
    F_ACOUSTIC_CHAMBER_SCENE,
  );
export const F_LUMINOUS_HYBRID_PERFORMANCE_BINDING: Readonly<PerformanceBinding> =
  createFCompletePieceBinding(
    "f-luminous-hybrid@0",
    F_LUMINOUS_HYBRID_SOUND_PROFILE,
    F_LUMINOUS_HYBRID_PALETTE,
    F_LUMINOUS_HYBRID_SCENE,
  );
export const F_LOFI_DEGRADED_PERFORMANCE_BINDING: Readonly<PerformanceBinding> =
  createFCompletePieceBinding(
    "f-lofi-degraded@0",
    F_LOFI_DEGRADED_SOUND_PROFILE,
    F_LOFI_DEGRADED_PALETTE,
    F_LOFI_DEGRADED_SCENE,
  );
export const F_SYNTHETIC_BEAT_PERFORMANCE_BINDING: Readonly<PerformanceBinding> =
  createFCompletePieceBinding(
    "f-synthetic-beat@0",
    F_SYNTHETIC_BEAT_SOUND_PROFILE,
    F_SYNTHETIC_BEAT_PALETTE,
    F_SYNTHETIC_BEAT_SCENE,
  );

export const BUILT_IN_PERFORMANCE_BINDINGS: readonly PerformanceBinding[] = [
  DEFAULT_PERFORMANCE_BINDING,
  G3B_VCSL_LISTENING_PERFORMANCE_BINDING,
  COMPLETE_PIECE_PERFORMANCE_BINDING,
  COMPLETE_PIECE_VCSL_PERFORMANCE_BINDING,
  E_VSCO_WIND_PILOT_PERFORMANCE_BINDING,
  F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING,
  F_LUMINOUS_HYBRID_PERFORMANCE_BINDING,
  F_LOFI_DEGRADED_PERFORMANCE_BINDING,
  F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
];

export const performanceBindingById = new Map(
  BUILT_IN_PERFORMANCE_BINDINGS.map((binding) => [binding.id, binding]),
);
