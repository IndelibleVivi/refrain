import {
  COMPLETE_PIECE_PERFORMANCE_PLAN_FORMAT,
  COMPLETE_PIECE_PERFORMANCE_BINDING,
  type PerformanceBinding,
  type SoundpackManifest,
  type InstrumentVocabulary,
} from "@refrain/soundpack";
import {
  PERFORMANCE_BINDING_V1_FORMAT,
  PERFORMANCE_PLAN_V4_FORMAT,
  type AuthoringVocabularyClosure,
  type PerformanceBindingV1,
} from "@refrain/soundpack/vnext";
import { canonicalJson, sha256Hex } from "./digest.js";
import {
  createAuditionPerformancePlan,
  createPerformancePlan,
  type PerformanceEvent,
  type PerformanceVoice,
  type ResolvedRenderProfile,
  type ResolvedSampleAttack,
  type AudioCompiledAir,
} from "./performance.js";

export const EXECUTION_BUNDLE_FORMAT =
  "refrain-execution-bundle@0-experimental" as const;
export const EXECUTION_INDEX_FORMAT =
  "refrain-execution-index@0-experimental" as const;
export const PREPARATION_PLAN_FORMAT =
  "refrain-preparation-plan@0-experimental" as const;
export const REFERENCE_SAMPLE_RATE = 44_100;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/;

export interface CompiledIdentityV3 {
  format: AudioCompiledAir["format"];
  sha256: string;
  eventCount: number;
  segmentCount: number;
  motifOccurrenceCount: number;
  durationBeats: number;
  musicalDurationSeconds: number;
}

export type ResolvedSampleAttackV3 = Omit<ResolvedSampleAttack, "attackId">;

export interface PerformanceEventResolutionV3 {
  compiledEventIndex: number;
  channel: number;
  effectiveGainDb: number;
  noteOnVelocity: number;
  performanceVelocity: number;
  soundingDurationBeats: number;
  noteOffBeat: number;
  sampleAttackIndex?: number;
}

export interface AssetRequirementV3 {
  assetId: string;
  kind: "wav" | "soundfont";
  bytes: number;
  sha256: string;
  candidateIds: string[];
  firstUseSeconds: number;
  lastUseSeconds: number;
  useCount: number;
}

export interface PerformancePlanV3 {
  format: typeof COMPLETE_PIECE_PERFORMANCE_PLAN_FORMAT;
  sourceRevision: string;
  compilerContract: AudioCompiledAir["format"];
  resolverContract: "refrain-sound-resolver@1-experimental";
  compiledIdentity: CompiledIdentityV3;
  performanceBinding: PerformanceBinding;
  resolvedRenderProfile: ResolvedRenderProfile;
  vocabulary: { id: string; sha256: string };
  soundpack: { id: string; sha256: string };
  voices: PerformanceVoice[];
  eventResolutions: PerformanceEventResolutionV3[];
  sampleAttacks: ResolvedSampleAttackV3[];
  assetRequirements: AssetRequirementV3[];
  renderDurationSeconds: number;
}

export interface PerformancePlanV4 extends Omit<
  PerformancePlanV3,
  "format" | "performanceBinding"
> {
  format: typeof PERFORMANCE_PLAN_V4_FORMAT;
  performanceBinding: PerformanceBindingV1;
}

export interface RuntimeAssetLocator {
  assetId: string;
  localPath: string;
}

export interface ExecutionCheckpoint {
  frame: number;
  activeEventIndexes: number[];
}

export interface ExecutionIndexV0 {
  format: typeof EXECUTION_INDEX_FORMAT;
  sampleRate: typeof REFERENCE_SAMPLE_RATE;
  eventStartFrames: Uint32Array;
  noteOffFrames: Uint32Array;
  renderEndFrames: Uint32Array;
  releaseOrder: Uint32Array;
  sections: Array<{ id: string; startFrame: number; endFrame: number }>;
  checkpoints: ExecutionCheckpoint[];
  byteLength: number;
}

export interface ExecutionBundle {
  format: typeof EXECUTION_BUNDLE_FORMAT;
  sourceRevision: string;
  compiled: AudioCompiledAir;
  compiledSha256: string;
  plan: PerformancePlanV3 | PerformancePlanV4;
  planSha256: string;
  index: ExecutionIndexV0;
  runtimeAssets: RuntimeAssetLocator[];
}

export interface CreateExecutionBundleOptions {
  sourceRevision?: string;
  performanceBinding?: PerformanceBinding | PerformanceBindingV1;
  soundRegistry?: SoundpackManifest;
  instrumentVocabulary?: InstrumentVocabulary | AuthoringVocabularyClosure;
}

export interface PreparationPolicy {
  openingWindowSeconds: number;
  prefetchLeadSeconds: number;
  maxConcurrentFetches: number;
  maxConcurrentDecodes: number;
  rawCacheBudgetBytes: number;
  decodedCacheBudgetBytes: number;
}

export interface PreparationPlanV0 {
  format: typeof PREPARATION_PLAN_FORMAT;
  performancePlanSha256: string;
  policy: PreparationPolicy;
  openingClosure: string[];
  assets: Array<{
    assetId: string;
    firstUseSeconds: number;
    lastUseSeconds: number;
    deadlineSeconds: number;
    priorityRank: number;
  }>;
}

export const DEFAULT_PREPARATION_POLICY: Readonly<PreparationPolicy> = {
  openingWindowSeconds: 12,
  prefetchLeadSeconds: 15,
  maxConcurrentFetches: 4,
  maxConcurrentDecodes: 2,
  rawCacheBudgetBytes: 256 * 1024 * 1024,
  decodedCacheBudgetBytes: 256 * 1024 * 1024,
};

function sha256Id(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

function compactSample(sample: ResolvedSampleAttack): ResolvedSampleAttackV3 {
  const { attackId: _attackId, ...compact } = sample;
  return compact;
}

function eventRenderEndSeconds(
  event: PerformanceEvent,
  voice: PerformanceVoice | undefined,
  tempo: number,
): number {
  if (event.sample) return event.sample.renderEndSeconds;
  const noteOffSeconds = (event.noteOffBeat * 60) / tempo;
  return voice?.engine === "synth" && voice.patch
    ? noteOffSeconds + voice.patch.release
    : noteOffSeconds;
}

function createExecutionIndex(
  compiled: AudioCompiledAir,
  events: readonly PerformanceEvent[],
  voices: readonly PerformanceVoice[],
): ExecutionIndexV0 {
  const eventStartFrames = new Uint32Array(events.length);
  const noteOffFrames = new Uint32Array(events.length);
  const renderEndFrames = new Uint32Array(events.length);
  const secondsPerBeat = 60 / compiled.tempo;
  const byVoice = new Map(voices.map((voice) => [voice.voiceId, voice]));
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    eventStartFrames[index] = Math.round(
      event.startBeat * secondsPerBeat * REFERENCE_SAMPLE_RATE,
    );
    noteOffFrames[index] = Math.round(
      event.noteOffBeat * secondsPerBeat * REFERENCE_SAMPLE_RATE,
    );
    renderEndFrames[index] = Math.round(
      eventRenderEndSeconds(event, byVoice.get(event.voiceId), compiled.tempo) *
        REFERENCE_SAMPLE_RATE,
    );
  }
  const releaseOrder = Uint32Array.from(
    events
      .map((_event, index) => index)
      .sort(
        (left, right) =>
          noteOffFrames[left]! - noteOffFrames[right]! || left - right,
      ),
  );
  const checkpointFrames = new Set<number>();
  const durationFrame = Math.round(
    compiled.durationSeconds * REFERENCE_SAMPLE_RATE,
  );
  for (
    let frame = 0;
    frame <= durationFrame;
    frame += REFERENCE_SAMPLE_RATE * 2
  ) {
    checkpointFrames.add(frame);
  }
  for (const section of compiled.sections)
    checkpointFrames.add(
      Math.round(section.startBeat * secondsPerBeat * REFERENCE_SAMPLE_RATE),
    );
  const checkpoints = [...checkpointFrames]
    .sort((left, right) => left - right)
    .map((frame) => ({
      frame,
      activeEventIndexes: events.flatMap((_event, eventIndex) =>
        eventStartFrames[eventIndex]! < frame &&
        renderEndFrames[eventIndex]! > frame
          ? [eventIndex]
          : [],
      ),
    }));
  const sections = compiled.sections.map((section) => ({
    id: section.id,
    startFrame: Math.round(
      section.startBeat * secondsPerBeat * REFERENCE_SAMPLE_RATE,
    ),
    endFrame: Math.round(
      section.endBeat * secondsPerBeat * REFERENCE_SAMPLE_RATE,
    ),
  }));
  const checkpointBytes = checkpoints.reduce(
    (total, checkpoint) =>
      total +
      Uint32Array.BYTES_PER_ELEMENT *
        (1 + checkpoint.activeEventIndexes.length),
    0,
  );
  return {
    format: EXECUTION_INDEX_FORMAT,
    sampleRate: REFERENCE_SAMPLE_RATE,
    eventStartFrames,
    noteOffFrames,
    renderEndFrames,
    releaseOrder,
    sections,
    checkpoints,
    byteLength:
      eventStartFrames.byteLength +
      noteOffFrames.byteLength +
      renderEndFrames.byteLength +
      releaseOrder.byteLength +
      checkpointBytes,
  };
}

function assetUsage(
  events: readonly PerformanceEvent[],
  voices: readonly PerformanceVoice[],
  localAssets: ReadonlyMap<
    string,
    {
      assetId: string;
      kind: "wav" | "soundfont";
      bytes: number;
      sha256: string;
      localPath: string;
      candidateIds: string[];
    }
  >,
  tempo: number,
): AssetRequirementV3[] {
  const byVoice = new Map(voices.map((voice) => [voice.voiceId, voice]));
  const usage = new Map<
    string,
    { first: number; last: number; count: number }
  >();
  const touch = (assetId: string, first: number, last: number) => {
    const present = usage.get(assetId) ?? {
      first: Number.POSITIVE_INFINITY,
      last: 0,
      count: 0,
    };
    present.first = Math.min(present.first, first);
    present.last = Math.max(present.last, last);
    present.count += 1;
    usage.set(assetId, present);
  };
  const secondsPerBeat = 60 / tempo;
  for (const event of events) {
    const voice = byVoice.get(event.voiceId);
    if (!voice) continue;
    const start = event.startBeat * secondsPerBeat;
    const end = eventRenderEndSeconds(event, voice, tempo);
    if (voice.engine === "soundfont" && voice.assetId)
      touch(voice.assetId, start, end);
    if (event.sample) {
      touch(event.sample.attackAssetId, start, end);
      if (event.sample.releaseSample) {
        touch(
          event.sample.releaseSample.assetId,
          event.noteOffBeat * secondsPerBeat,
          end,
        );
      }
    }
  }
  return [...usage]
    .map(([assetId, observed]) => {
      const asset = localAssets.get(assetId);
      if (!asset)
        throw new Error(
          `Execution asset ${assetId} is absent from the plan closure.`,
        );
      return {
        assetId,
        kind: asset.kind,
        bytes: asset.bytes,
        sha256: asset.sha256,
        candidateIds: [...asset.candidateIds],
        firstUseSeconds: observed.first,
        lastUseSeconds: observed.last,
        useCount: observed.count,
      };
    })
    .sort(
      (left, right) =>
        left.firstUseSeconds - right.firstUseSeconds ||
        left.assetId.localeCompare(right.assetId),
    );
}

export function createExecutionBundle(
  compiled: AudioCompiledAir,
  options: CreateExecutionBundleOptions = {},
): ExecutionBundle {
  const compiledSha256 = sha256Id(compiled);
  const sourceRevision = options.sourceRevision ?? compiledSha256;
  if (!SHA256_ID.test(sourceRevision))
    throw new Error(
      "ExecutionBundle sourceRevision must be a complete SHA-256 ID.",
    );
  const performanceBinding =
    options.performanceBinding ?? COMPLETE_PIECE_PERFORMANCE_BINDING;
  const expectedPlanFormat =
    performanceBinding.format === PERFORMANCE_BINDING_V1_FORMAT
      ? PERFORMANCE_PLAN_V4_FORMAT
      : COMPLETE_PIECE_PERFORMANCE_PLAN_FORMAT;
  if (performanceBinding.renderer.performancePlanFormat !== expectedPlanFormat)
    throw new Error(
      `ExecutionBundle requires ${expectedPlanFormat}; binding ${performanceBinding.id} pins ${performanceBinding.renderer.performancePlanFormat}.`,
    );
  const expanded = createPerformancePlan(compiled, {
    performanceBinding,
    ...(options.soundRegistry ? { soundRegistry: options.soundRegistry } : {}),
    ...(options.instrumentVocabulary
      ? { instrumentVocabulary: options.instrumentVocabulary }
      : {}),
  });
  const sampleAttacks: ResolvedSampleAttackV3[] = [];
  const sampleIndexes = new Map<string, number>();
  const eventResolutions = expanded.events.map((event, compiledEventIndex) => {
    let sampleAttackIndex: number | undefined;
    if (event.sample) {
      const compact = compactSample(event.sample);
      const key = canonicalJson(compact);
      sampleAttackIndex = sampleIndexes.get(key);
      if (sampleAttackIndex === undefined) {
        sampleAttackIndex = sampleAttacks.length;
        sampleIndexes.set(key, sampleAttackIndex);
        sampleAttacks.push(compact);
      }
    }
    return {
      compiledEventIndex,
      channel: event.channel,
      effectiveGainDb: event.effectiveGainDb,
      noteOnVelocity: event.noteOnVelocity,
      performanceVelocity: event.performanceVelocity,
      soundingDurationBeats: event.soundingDurationBeats,
      noteOffBeat: event.noteOffBeat,
      ...(sampleAttackIndex === undefined ? {} : { sampleAttackIndex }),
    } satisfies PerformanceEventResolutionV3;
  });
  const localAssets = new Map(
    expanded.requiredAssets.map((asset) => [asset.assetId, asset]),
  );
  const assetRequirements = assetUsage(
    expanded.events,
    expanded.voices,
    localAssets,
    compiled.tempo,
  );
  const plan = {
    format: expectedPlanFormat,
    sourceRevision,
    compilerContract: compiled.format,
    resolverContract: expanded.resolverContract,
    compiledIdentity: {
      format: compiled.format,
      sha256: compiledSha256,
      eventCount: compiled.events.length,
      segmentCount: compiled.segments.length,
      motifOccurrenceCount: compiled.motifOccurrences.length,
      durationBeats: compiled.durationBeats,
      musicalDurationSeconds: compiled.durationSeconds,
    },
    performanceBinding,
    resolvedRenderProfile: expanded.resolvedRenderProfile,
    vocabulary: expanded.vocabulary,
    soundpack: expanded.soundpack,
    voices: expanded.voices,
    eventResolutions,
    sampleAttacks,
    assetRequirements,
    renderDurationSeconds: expanded.durationSeconds,
  } as PerformancePlanV3 | PerformancePlanV4;
  const planSha256 = sha256Id(plan);
  const index = createExecutionIndex(
    compiled,
    expanded.events,
    expanded.voices,
  );
  const bundle: ExecutionBundle = {
    format: EXECUTION_BUNDLE_FORMAT,
    sourceRevision,
    compiled,
    compiledSha256,
    plan,
    planSha256,
    index,
    runtimeAssets: expanded.requiredAssets.map((asset) => ({
      assetId: asset.assetId,
      localPath: asset.localPath,
    })),
  };
  return Object.freeze(bundle);
}

export function performanceEventAt(
  bundle: ExecutionBundle,
  eventIndex: number,
): PerformanceEvent {
  const compiled = bundle.compiled.events[eventIndex];
  const resolution = bundle.plan.eventResolutions[eventIndex];
  if (!compiled || !resolution || resolution.compiledEventIndex !== eventIndex)
    throw new Error(
      `Execution event ${eventIndex} is outside the sealed bundle.`,
    );
  const sample =
    resolution.sampleAttackIndex === undefined
      ? undefined
      : bundle.plan.sampleAttacks[resolution.sampleAttackIndex];
  return {
    ...compiled,
    channel: resolution.channel,
    effectiveGainDb: resolution.effectiveGainDb,
    noteOnVelocity: resolution.noteOnVelocity,
    performanceVelocity: resolution.performanceVelocity,
    soundingDurationBeats: resolution.soundingDurationBeats,
    noteOffBeat: resolution.noteOffBeat,
    ...(sample
      ? {
          sample: {
            ...sample,
            attackId: `${compiled.id}@${sample.candidateId}`,
          },
        }
      : {}),
  };
}

export function performanceEventsOf(
  bundle: ExecutionBundle,
): PerformanceEvent[] {
  return bundle.plan.eventResolutions.map((_resolution, eventIndex) =>
    performanceEventAt(bundle, eventIndex),
  );
}

export function createPreparationPlan(
  bundle: ExecutionBundle,
  policy: PreparationPolicy = DEFAULT_PREPARATION_POLICY,
): PreparationPlanV0 {
  const assets = bundle.plan.assetRequirements.map((asset, priorityRank) => ({
    assetId: asset.assetId,
    firstUseSeconds: asset.firstUseSeconds,
    lastUseSeconds: asset.lastUseSeconds,
    deadlineSeconds: Math.max(
      0,
      asset.firstUseSeconds - policy.prefetchLeadSeconds,
    ),
    priorityRank,
  }));
  return {
    format: PREPARATION_PLAN_FORMAT,
    performancePlanSha256: bundle.planSha256,
    policy: { ...policy },
    openingClosure: assets
      .filter((asset) => asset.firstUseSeconds < policy.openingWindowSeconds)
      .map((asset) => asset.assetId),
    assets,
  };
}

export function createAuditionExecutionBundle(
  instrumentId: string,
  midi = 60,
  options: CreateExecutionBundleOptions & { candidateId?: string } = {},
): ExecutionBundle {
  const audition = createAuditionPerformancePlan(instrumentId, midi, {
    performanceBinding:
      options.performanceBinding ?? COMPLETE_PIECE_PERFORMANCE_BINDING,
    ...(options.candidateId ? { candidateId: options.candidateId } : {}),
    ...(options.soundRegistry ? { soundRegistry: options.soundRegistry } : {}),
    ...(options.instrumentVocabulary
      ? { instrumentVocabulary: options.instrumentVocabulary }
      : {}),
  });
  return createExecutionBundle(audition.compiled, {
    ...options,
    performanceBinding: audition.performanceBinding as PerformanceBinding,
  });
}
