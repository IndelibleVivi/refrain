import type { CompiledAir, CompiledEvent } from "@refrain/compiler";
import type { CompiledAirV1 } from "@refrain/compiler/v1";
import {
  DEFAULT_PERFORMANCE_BINDING,
  INSTRUMENT_VOCABULARY,
  PERFORMANCE_PLAN_FORMAT,
  SOUND_REGISTRY,
  candidateContentSha256,
  createPerformanceBinding,
  instrumentById,
  soundAssetById,
  soundObjectContentSha256,
  soundProfileWithCandidates,
  validatePerformanceBinding,
  validateSoundProfile,
  validateSoundpackManifest,
  type CandidateEngine,
  type CandidateMapping,
  type InstrumentCandidate,
  type InstrumentDefinition,
  type InstrumentVocabulary,
  type MusicalArticulation,
  type PerformanceBinding,
  type SampleLoop,
  type SampleRegion,
  type SampleRelease,
  type SoundAssetDefinition,
  type SoundProfile,
  type SoundpackManifest,
  type SynthPatch,
} from "@refrain/soundpack";
import {
  CORE_AUTHORING_VOCABULARY,
  PERFORMANCE_BINDING_V1_FORMAT,
  PERFORMANCE_PLAN_V4_FORMAT,
  createAuthoringVocabularyClosure,
  validatePerformanceBindingV1,
  validateSoundProfileV2,
  type AuthoringVocabularyClosure,
  type PerformanceBindingV1,
  type RenderSceneV1,
  type SoundPaletteV1,
  type SoundProfileV2,
} from "@refrain/soundpack/vnext";
import { resolveSoundpackClosureFromManifest } from "@refrain/soundpack/factory";
import { assignVoiceChannels } from "./channels.js";
import { sha256Hex } from "./digest.js";

export const SOUND_RESOLVER_CONTRACT =
  "refrain-sound-resolver@1-experimental" as const;

export type AudioCompiledAir = CompiledAir | CompiledAirV1;

export interface ResolvedRenderProfile {
  masterGainDb: number;
  peakCeiling: number;
  velocityScale: number;
}

export interface ResolvedReleaseSample {
  regionId: string;
  assetId: string;
  rootMidi: number;
  playbackRate: number;
  gainDb: number;
}

export interface ResolvedSampleAttack {
  attackId: string;
  candidateId: string;
  regionId: string;
  attackAssetId: string;
  requestedArticulation: MusicalArticulation;
  resolvedArticulation: MusicalArticulation;
  velocityLayer: { min: number; max: number };
  roundRobinIndex?: number;
  roundRobinOrdinal?: number;
  rootMidi: number;
  playbackRate: number;
  gainDb: number;
  attackSeconds: number;
  loop: SampleLoop;
  release: SampleRelease;
  releaseSample?: ResolvedReleaseSample;
  renderEndSeconds: number;
}

export interface PerformanceVoice {
  voiceId: string;
  role: string;
  instrument: string;
  family: InstrumentDefinition["family"];
  engine: CandidateEngine;
  candidateId: string;
  candidateDigest: string;
  fallbackUsed: boolean;
  candidateGainDb: number;
  profileGainDb: number;
  assetId?: string;
  mapping: CandidateMapping;
  channel: number;
  voiceGainDb: number;
  effectiveGainDb: number;
  channelGain: number;
  midiChannelGain: number;
  pan: number;
  program?: number;
  midiFallbackProgram?: number;
  supportedNotes?: readonly number[];
  patch?: SynthPatch;
}

export interface PerformanceEvent extends CompiledEvent {
  channel: number;
  effectiveGainDb: number;
  noteOnVelocity: number;
  performanceVelocity: number;
  soundingDurationBeats: number;
  noteOffBeat: number;
  sample?: ResolvedSampleAttack;
}

export interface RequiredAsset {
  assetId: string;
  kind: SoundAssetDefinition["kind"];
  bytes: number;
  sha256: string;
  localPath: string;
  candidateIds: string[];
}

export interface PerformancePlan {
  format: typeof PERFORMANCE_PLAN_FORMAT | typeof PERFORMANCE_PLAN_V4_FORMAT;
  resolverContract: typeof SOUND_RESOLVER_CONTRACT;
  compiled: AudioCompiledAir;
  performanceBinding: PerformanceBinding | PerformanceBindingV1;
  resolvedRenderProfile: ResolvedRenderProfile;
  soundProfile: SoundProfile | SoundProfileV2;
  renderScene: PerformanceBinding["renderScene"] | RenderSceneV1;
  soundPalette?:
    NonNullable<PerformanceBinding["soundPalette"]> | SoundPaletteV1;
  rendererContract:
    | PerformanceBinding["renderer"]["contract"]
    | PerformanceBindingV1["renderer"]["contract"];
  vocabulary: { id: string; sha256: string };
  soundpack: { id: string; sha256: string };
  voices: PerformanceVoice[];
  events: PerformanceEvent[];
  requiredAssets: RequiredAsset[];
  durationSeconds: number;
}

export interface CreatePerformancePlanOptions {
  performanceBinding?: PerformanceBinding | PerformanceBindingV1;
  soundRegistry?: SoundpackManifest;
  instrumentVocabulary?: InstrumentVocabulary | AuthoringVocabularyClosure;
}

export interface CreateAuditionPerformancePlanOptions extends CreatePerformancePlanOptions {
  candidateId?: string;
}

interface CandidateResolution {
  candidate: InstrumentCandidate;
  candidateDigest: string;
  candidateIndex: number;
  samples: Map<string, ResolvedSampleAttack>;
}

function clampMidi(value: number): number {
  return Math.max(1, Math.min(127, Math.round(value)));
}

export function resolvedRenderProfileOf(
  binding: PerformanceBinding | PerformanceBindingV1,
): ResolvedRenderProfile {
  if (binding.format === PERFORMANCE_BINDING_V1_FORMAT) {
    return {
      masterGainDb:
        binding.overrides.masterGainDb ?? binding.renderScene.master.gainDb,
      peakCeiling:
        binding.overrides.peakCeiling ?? binding.renderScene.master.peakCeiling,
      velocityScale:
        binding.overrides.velocityScale ??
        binding.renderScene.master.velocityScale,
    };
  }
  return {
    masterGainDb:
      binding.overrides.masterGainDb ?? binding.renderScene.masterGainDb,
    peakCeiling:
      binding.overrides.peakCeiling ?? binding.renderScene.peakCeiling,
    velocityScale:
      binding.overrides.velocityScale ?? binding.renderScene.velocityScale,
  };
}

function soundingDuration(event: CompiledEvent): number {
  return event.soundingDurationBeats ?? event.durationBeats;
}

function chooseRoundRobin(
  candidate: InstrumentCandidate,
  event: PerformanceEvent,
  articulation: MusicalArticulation,
  regions: SampleRegion[],
  candidateSeed: string,
  ordinals: Map<string, number>,
): { region: SampleRegion; ordinal?: number } {
  const ordered = [...regions].sort(
    (left, right) =>
      (left.roundRobin?.index ?? 0) - (right.roundRobin?.index ?? 0) ||
      left.id.localeCompare(right.id),
  );
  const roundRobin = ordered[0]?.roundRobin;
  if (!roundRobin) return { region: ordered[0]! };
  const ordinalKey = [
    candidate.id,
    event.voiceId,
    ordered[0]!.trigger,
    articulation,
    roundRobin.group,
  ].join("|");
  const ordinal = ordinals.get(ordinalKey) ?? 0;
  ordinals.set(ordinalKey, ordinal + 1);
  const seedKey = [
    SOUND_RESOLVER_CONTRACT,
    candidateSeed,
    event.voiceId,
    articulation,
    ordered[0]!.trigger,
    roundRobin.group,
  ].join("|");
  const offset =
    Number.parseInt(sha256Hex(seedKey).slice(0, 8), 16) % roundRobin.count;
  const index = (offset + ordinal) % roundRobin.count;
  return {
    region: ordered.find((item) => item.roundRobin?.index === index)!,
    ordinal,
  };
}

function matchingRegions(
  regions: readonly SampleRegion[],
  trigger: SampleRegion["trigger"],
  articulation: MusicalArticulation,
  midi: number,
  velocity: number,
): SampleRegion[] {
  return regions.filter(
    (region) =>
      region.trigger === trigger &&
      region.articulation === articulation &&
      midi >= region.pitch.minMidi &&
      midi <= region.pitch.maxMidi &&
      velocity >= region.velocity.min &&
      velocity <= region.velocity.max,
  );
}

function resolveArticulation(
  candidate: InstrumentCandidate,
  event: PerformanceEvent,
): { articulation?: MusicalArticulation; regions: SampleRegion[] } {
  if (candidate.mapping.type !== "sample-map") return { regions: [] };
  const mapping = candidate.mapping;
  let articulation: MusicalArticulation | undefined = event.articulation;
  const seen = new Set<string>();
  while (articulation !== undefined && !seen.has(articulation)) {
    seen.add(articulation);
    const regions = matchingRegions(
      mapping.regions,
      "attack",
      articulation,
      event.midi,
      event.noteOnVelocity,
    );
    if (regions.length) return { articulation, regions };
    articulation = mapping.articulationFallbacks[articulation];
  }
  return { regions: [] };
}

function assetDuration(
  asset: SoundAssetDefinition,
  playbackRate: number,
): number {
  if (!asset.audio) return 0;
  return asset.audio.frameCount / asset.audio.sampleRate / playbackRate;
}

function velocityGainCorrectionDb(
  region: SampleRegion,
  event: PerformanceEvent,
): number {
  const curve = region.velocityGainCurve;
  if (!curve) return 0;
  const velocity = event.noteOnVelocity;
  let lower = curve[0]!;
  let upper = curve.at(-1)!;
  for (let index = 1; index < curve.length; index += 1) {
    upper = curve[index]!;
    if (velocity <= upper.velocity) {
      lower = curve[index - 1]!;
      break;
    }
  }
  const span = upper.velocity - lower.velocity;
  const progress = span === 0 ? 0 : (velocity - lower.velocity) / span;
  const curveGain = lower.gain + (upper.gain - lower.gain) * progress;
  return (
    20 * Math.log10(Math.max(0.000_001, curveGain) / event.performanceVelocity)
  );
}

function resolveSampleAttack(
  candidate: InstrumentCandidate,
  event: PerformanceEvent,
  assetMap: Map<string, SoundAssetDefinition>,
  tempo: number,
  scopedCandidateSeed: string,
  roundRobinOrdinals: Map<string, number>,
): ResolvedSampleAttack | undefined {
  if (candidate.mapping.type !== "sample-map") return undefined;
  const match = resolveArticulation(candidate, event);
  if (!match.articulation || match.regions.length === 0) return undefined;
  const attackChoice = chooseRoundRobin(
    candidate,
    event,
    match.articulation,
    match.regions,
    scopedCandidateSeed,
    roundRobinOrdinals,
  );
  const region = attackChoice.region;
  const attackVelocityCorrectionDb = velocityGainCorrectionDb(region, event);
  const asset = assetMap.get(region.assetId);
  if (!asset) return undefined;
  const playbackRate =
    2 ** ((event.midi - region.pitch.rootMidi + region.tuneCents / 100) / 12);
  let releaseSample: ResolvedReleaseSample | undefined;
  if (region.release?.mode === "sample") {
    const releaseRegions = matchingRegions(
      candidate.mapping.regions,
      "release",
      match.articulation,
      event.midi,
      event.noteOnVelocity,
    );
    if (!releaseRegions.length) return undefined;
    const releaseChoice = chooseRoundRobin(
      candidate,
      event,
      match.articulation,
      releaseRegions,
      scopedCandidateSeed,
      roundRobinOrdinals,
    );
    const releaseRegion = releaseChoice.region;
    releaseSample = {
      regionId: releaseRegion.id,
      assetId: releaseRegion.assetId,
      rootMidi: releaseRegion.pitch.rootMidi,
      playbackRate:
        2 **
        ((event.midi -
          releaseRegion.pitch.rootMidi +
          releaseRegion.tuneCents / 100) /
          12),
      gainDb:
        releaseRegion.gainDb +
        velocityGainCorrectionDb(releaseRegion, event) -
        attackVelocityCorrectionDb,
    };
  }
  const secondsPerBeat = 60 / tempo;
  const startSeconds = event.startBeat * secondsPerBeat;
  const noteOffSeconds = event.noteOffBeat * secondsPerBeat;
  let renderEndSeconds = noteOffSeconds;
  if (region.release?.mode === "natural") {
    renderEndSeconds = startSeconds + assetDuration(asset, playbackRate);
  } else if (region.release?.mode === "envelope") {
    renderEndSeconds = noteOffSeconds + region.release.seconds;
  } else if (region.release?.mode === "sample" && releaseSample) {
    const releaseAsset = assetMap.get(releaseSample.assetId);
    renderEndSeconds =
      noteOffSeconds +
      (region.release.seconds ??
        (releaseAsset
          ? assetDuration(releaseAsset, releaseSample.playbackRate)
          : 0));
  }
  return {
    attackId: `${event.id}@${candidate.id}`,
    candidateId: candidate.id,
    regionId: region.id,
    attackAssetId: region.assetId,
    requestedArticulation: event.articulation,
    resolvedArticulation: match.articulation,
    velocityLayer: { ...region.velocity },
    ...(region.roundRobin === undefined
      ? {}
      : {
          roundRobinIndex: region.roundRobin.index,
          roundRobinOrdinal: attackChoice.ordinal,
        }),
    rootMidi: region.pitch.rootMidi,
    playbackRate,
    gainDb: region.gainDb + attackVelocityCorrectionDb,
    attackSeconds: region.attackSeconds ?? 0.005,
    loop: region.loop,
    release: region.release!,
    ...(releaseSample === undefined ? {} : { releaseSample }),
    renderEndSeconds,
  };
}

function candidateCovers(
  candidate: InstrumentCandidate,
  candidateDigest: string,
  events: PerformanceEvent[],
  assetMap: Map<string, SoundAssetDefinition>,
  tempo: number,
): Map<string, ResolvedSampleAttack> | undefined {
  if (candidate.mapping.type === "percussion-kit") {
    return events.every((event) =>
      candidate.mapping.type === "percussion-kit"
        ? candidate.mapping.supportedNotes.includes(event.midi)
        : false,
    )
      ? new Map()
      : undefined;
  }
  if (candidate.mapping.type !== "sample-map") return new Map();
  const samples = new Map<string, ResolvedSampleAttack>();
  const scopedCandidateSeed = candidateDigest;
  const roundRobinOrdinals = new Map<string, number>();
  for (const event of events) {
    const sample = resolveSampleAttack(
      candidate,
      event,
      assetMap,
      tempo,
      scopedCandidateSeed,
      roundRobinOrdinals,
    );
    if (!sample) return undefined;
    samples.set(event.id, sample);
  }
  return samples;
}

function resolveCandidateForIdentity(
  instrumentId: string,
  events: PerformanceEvent[],
  profile: SoundProfile | SoundProfileV2,
  manifest: SoundpackManifest,
  assetMap: Map<string, SoundAssetDefinition>,
  tempo: number,
): CandidateResolution {
  const selection = profile.selections[instrumentId];
  if (!selection)
    throw new Error(`SoundProfile has no selection for ${instrumentId}.`);
  const candidates = new Map(
    manifest.candidates.map((item) => [item.id, item]),
  );
  for (let index = 0; index < selection.candidateChain.length; index += 1) {
    const pin = selection.candidateChain[index]!;
    const candidateId = pin.id;
    const candidate = candidates.get(candidateId)!;
    const candidateDigest = candidateContentSha256(candidate, manifest);
    if (candidateDigest !== pin.sha256)
      throw new Error(
        `SoundProfile candidate pin does not match ${candidateId}.`,
      );
    const samples = candidateCovers(
      candidate,
      candidateDigest,
      events,
      assetMap,
      tempo,
    );
    if (samples)
      return {
        candidate,
        candidateDigest,
        candidateIndex: index,
        samples,
      };
    if (selection.fallbackPolicy === "strict") break;
  }
  throw new Error(
    `${selection.candidateChain[0]!.id} does not cover every ${instrumentId} pitch, velocity, and articulation required by this air.`,
  );
}

function addRequiredAsset(
  closure: Map<
    string,
    { asset: SoundAssetDefinition; candidateIds: Set<string> }
  >,
  assetId: string,
  candidateId: string,
  assetMap: Map<string, SoundAssetDefinition>,
): void {
  const asset = assetMap.get(assetId);
  if (!asset)
    throw new Error(`Resolved asset ${assetId} is absent from the manifest.`);
  const present = closure.get(assetId) ?? {
    asset,
    candidateIds: new Set<string>(),
  };
  present.candidateIds.add(candidateId);
  closure.set(assetId, present);
}

export function resolveSoundpackClosureForProfileV2(
  profile: SoundProfileV2,
  registry: SoundpackManifest,
): SoundpackManifest {
  const candidateMap = new Map(
    registry.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const assetMap = new Map(registry.assets.map((asset) => [asset.id, asset]));
  const pins = new Map<string, string>();
  for (const selection of Object.values(profile.selections)) {
    for (const pin of selection.candidateChain) {
      const present = pins.get(pin.id);
      if (present && present !== pin.sha256)
        throw new Error(`SoundProfile@2 pins two identities for ${pin.id}.`);
      pins.set(pin.id, pin.sha256);
    }
  }
  const candidates = [...pins]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([candidateId, expectedDigest]) => {
      const candidate = candidateMap.get(candidateId);
      if (!candidate)
        throw new Error(`Sound candidate ${candidateId} is not installed.`);
      if (candidateContentSha256(candidate, registry) !== expectedDigest)
        throw new Error(
          `Sound candidate ${candidateId} does not match its exact pin.`,
        );
      return candidate;
    });
  const assetIds = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.assetId) assetIds.add(candidate.assetId);
    if (candidate.mapping.type === "sample-map")
      for (const region of candidate.mapping.regions)
        assetIds.add(region.assetId);
  }
  const assets = [...assetIds].sort().map((assetId) => {
    const asset = assetMap.get(assetId);
    if (!asset)
      throw new Error(`Sound candidate closure is missing asset ${assetId}.`);
    return asset;
  });
  const core = {
    format: "refrain-soundpack@1-experimental" as const,
    id: `${profile.id}-candidate-closure`,
    status: registry.status,
    assets,
    candidates,
  };
  return { ...core, contentSha256: soundObjectContentSha256(core) };
}

function sceneTailSeconds(scene: PerformancePlan["renderScene"]): number {
  if (scene.format !== "refrain-render-scene@1-experimental") return 0;
  let tail = 0;
  for (const bus of scene.buses) {
    for (const processor of bus.processors) {
      if (processor.type === "fade")
        tail = Math.max(tail, processor.tailSeconds);
      if (processor.type === "room")
        tail = Math.max(tail, processor.decaySeconds);
      if (processor.type === "delay")
        tail = Math.max(
          tail,
          (processor.delayMs / 1_000) *
            Math.max(
              1,
              Math.ceil(
                Math.log(0.001) / Math.log(Math.max(0.001, processor.feedback)),
              ),
            ),
        );
    }
  }
  return Math.min(30, tail);
}

export function createPerformancePlan(
  compiled: AudioCompiledAir,
  options: CreatePerformancePlanOptions = {},
): PerformancePlan {
  const performanceBinding =
    options.performanceBinding ?? DEFAULT_PERFORMANCE_BINDING;
  const registry = options.soundRegistry ?? SOUND_REGISTRY;
  const isVnext = performanceBinding.format === PERFORMANCE_BINDING_V1_FORMAT;
  const vocabulary =
    options.instrumentVocabulary ??
    (isVnext ? CORE_AUTHORING_VOCABULARY : INSTRUMENT_VOCABULARY);
  if (registry !== SOUND_REGISTRY) {
    const manifestErrors = validateSoundpackManifest(
      registry,
      INSTRUMENT_VOCABULARY,
    );
    if (manifestErrors.length) throw new Error(manifestErrors.join("\n"));
  }
  const bindingErrors = isVnext
    ? validatePerformanceBindingV1(performanceBinding, registry)
    : validatePerformanceBinding(
        performanceBinding,
        registry,
        vocabulary as InstrumentVocabulary,
      );
  if (bindingErrors.length) throw new Error(bindingErrors.join("\n"));
  const soundProfile = performanceBinding.soundProfile;
  const resolvedRenderProfile = resolvedRenderProfileOf(performanceBinding);
  const vnextVocabulary =
    "contentSha256" in vocabulary &&
    vocabulary.format === "refrain-authoring-vocabulary-closure@0-experimental"
      ? vocabulary
      : createAuthoringVocabularyClosure({
          id: vocabulary.id,
          instruments: vocabulary.instruments,
        });
  const profileErrors = isVnext
    ? validateSoundProfileV2(soundProfile, registry, vnextVocabulary)
    : validateSoundProfile(
        soundProfile,
        registry,
        vocabulary as InstrumentVocabulary,
      );
  if (profileErrors.length) throw new Error(profileErrors.join("\n"));
  const manifest = isVnext
    ? resolveSoundpackClosureForProfileV2(
        soundProfile as SoundProfileV2,
        registry,
      )
    : resolveSoundpackClosureFromManifest(
        soundProfile as SoundProfile,
        registry,
      );

  if (isVnext) {
    const used = [
      ...new Set(compiled.events.map((event) => event.instrument)),
    ].sort();
    if (
      JSON.stringify(used) !==
      JSON.stringify(performanceBinding.requiredInstrumentIds)
    )
      throw new Error(
        "PerformanceBinding@1 requiredInstrumentIds must equal the AIR instrument closure.",
      );
  }

  const channels = assignVoiceChannels(compiled);
  const channelByVoice = new Map(
    channels.map((item) => [item.voiceId, item.channel]),
  );
  const preliminaryEvents: PerformanceEvent[] = compiled.events.map((event) => {
    const duration = soundingDuration(event);
    const performanceVelocity = Math.max(
      0.01,
      Math.min(1, event.velocity * resolvedRenderProfile.velocityScale),
    );
    const channel = channelByVoice.get(event.voiceId);
    if (channel === undefined)
      throw new Error(`Missing channel for ${event.voiceId}.`);
    return {
      ...event,
      channel,
      effectiveGainDb: event.gainDb,
      noteOnVelocity: clampMidi(performanceVelocity * 127),
      performanceVelocity,
      soundingDurationBeats: duration,
      noteOffBeat: event.startBeat + duration,
    };
  });
  const eventsByInstrument = new Map<string, PerformanceEvent[]>();
  for (const event of preliminaryEvents) {
    const grouped = eventsByInstrument.get(event.instrument);
    if (grouped) grouped.push(event);
    else eventsByInstrument.set(event.instrument, [event]);
  }
  const assetMap = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  const resolutions = new Map<string, CandidateResolution>();
  for (const [instrumentId, events] of eventsByInstrument) {
    resolutions.set(
      instrumentId,
      resolveCandidateForIdentity(
        instrumentId,
        events,
        soundProfile,
        manifest,
        assetMap,
        compiled.tempo,
      ),
    );
  }

  const voices = channels.map(({ voiceId, instrument, channel }) => {
    const firstEvent = preliminaryEvents.find(
      (event) => event.voiceId === voiceId,
    );
    const definition = vocabulary.instruments.find(
      (item) => item.id === instrument,
    );
    const resolution = resolutions.get(instrument);
    const selection = soundProfile.selections[instrument];
    if (!firstEvent || !definition || !resolution || !selection)
      throw new Error(`Cannot build a performance voice for ${voiceId}.`);
    const candidate = resolution.candidate;
    if (
      performanceBinding.candidateDigests[candidate.id] !==
      resolution.candidateDigest
    )
      throw new Error(
        `PerformanceBinding does not pin the resolved candidate ${candidate.id}.`,
      );
    const profileGainDb = selection.profileGainDb ?? 0;
    const effectiveGainDb =
      candidate.calibrationGainDb + profileGainDb + firstEvent.gainDb;
    const mapping = candidate.mapping;
    return {
      voiceId,
      role: firstEvent.role,
      instrument,
      family: definition.family,
      engine: candidate.engine,
      candidateId: candidate.id,
      candidateDigest: resolution.candidateDigest,
      fallbackUsed: resolution.candidateIndex > 0,
      candidateGainDb: candidate.calibrationGainDb,
      profileGainDb,
      ...(candidate.assetId === undefined
        ? {}
        : { assetId: candidate.assetId }),
      mapping,
      channel,
      voiceGainDb: firstEvent.gainDb,
      effectiveGainDb,
      channelGain: clampMidi(10 ** (effectiveGainDb / 20) * 127),
      midiChannelGain: clampMidi(
        10 ** ((effectiveGainDb + resolvedRenderProfile.masterGainDb) / 20) *
          127,
      ),
      pan: Math.max(-1, Math.min(1, firstEvent.pan)),
      ...(mapping.type === "program" ? { program: mapping.program } : {}),
      ...(mapping.type === "midi-fallback"
        ? { midiFallbackProgram: mapping.program }
        : {}),
      ...(mapping.type === "sample-map"
        ? { midiFallbackProgram: mapping.midiFallbackProgram }
        : {}),
      ...(definition.supportedNotes === undefined
        ? {}
        : { supportedNotes: definition.supportedNotes }),
      ...(candidate.patch === undefined ? {} : { patch: candidate.patch }),
    } satisfies PerformanceVoice;
  });
  const voiceById = new Map(voices.map((voice) => [voice.voiceId, voice]));
  const events = preliminaryEvents.map((event) => {
    const voice = voiceById.get(event.voiceId);
    const resolution = resolutions.get(event.instrument);
    if (!voice || !resolution)
      throw new Error(`Missing performance voice ${event.voiceId}.`);
    const sample = resolution.samples.get(event.id);
    return {
      ...event,
      effectiveGainDb: voice.effectiveGainDb,
      ...(sample === undefined ? {} : { sample }),
    } satisfies PerformanceEvent;
  });

  const closure = new Map<
    string,
    { asset: SoundAssetDefinition; candidateIds: Set<string> }
  >();
  for (const resolution of resolutions.values()) {
    if (resolution.candidate.assetId)
      addRequiredAsset(
        closure,
        resolution.candidate.assetId,
        resolution.candidate.id,
        assetMap,
      );
    for (const sample of resolution.samples.values()) {
      addRequiredAsset(
        closure,
        sample.attackAssetId,
        resolution.candidate.id,
        assetMap,
      );
      if (sample.releaseSample)
        addRequiredAsset(
          closure,
          sample.releaseSample.assetId,
          resolution.candidate.id,
          assetMap,
        );
    }
  }
  const requiredAssets = [...closure.values()]
    .map(({ asset, candidateIds }) => ({
      assetId: asset.id,
      kind: asset.kind,
      bytes: asset.bytes,
      sha256: asset.sha256,
      localPath: asset.localPath,
      candidateIds: [...candidateIds].sort(),
    }))
    .sort((left, right) => left.assetId.localeCompare(right.assetId));

  const secondsPerBeat = 60 / compiled.tempo;
  let durationSeconds =
    compiled.durationSeconds + sceneTailSeconds(performanceBinding.renderScene);
  for (const resolution of resolutions.values()) {
    if (resolution.candidate.tailSeconds !== undefined) {
      durationSeconds = Math.max(
        durationSeconds,
        compiled.durationSeconds + resolution.candidate.tailSeconds,
      );
    }
  }
  for (const event of events) {
    const voice = voiceById.get(event.voiceId)!;
    const candidate = resolutions.get(event.instrument)!.candidate;
    const noteOffSeconds = event.noteOffBeat * secondsPerBeat;
    if (event.sample)
      durationSeconds = Math.max(
        durationSeconds,
        event.sample.renderEndSeconds,
      );
    else if (voice.engine === "synth" && voice.patch)
      durationSeconds = Math.max(
        durationSeconds,
        noteOffSeconds + voice.patch.release,
      );
    else if (voice.engine === "soundfont")
      durationSeconds = Math.max(
        durationSeconds,
        noteOffSeconds + (candidate.tailSeconds ?? 0),
      );
  }

  return {
    format: isVnext ? PERFORMANCE_PLAN_V4_FORMAT : PERFORMANCE_PLAN_FORMAT,
    resolverContract: SOUND_RESOLVER_CONTRACT,
    compiled,
    performanceBinding,
    resolvedRenderProfile,
    soundProfile,
    renderScene: performanceBinding.renderScene,
    ...(performanceBinding.soundPalette === undefined
      ? {}
      : { soundPalette: performanceBinding.soundPalette }),
    rendererContract: performanceBinding.renderer.contract,
    vocabulary: {
      id: vocabulary.id,
      sha256: vocabulary.contentSha256,
    },
    soundpack: { id: manifest.id, sha256: manifest.contentSha256 },
    voices,
    events,
    requiredAssets,
    durationSeconds,
  };
}

export function createAuditionPerformancePlan(
  instrumentId: string,
  midi = 60,
  options: CreateAuditionPerformancePlanOptions = {},
): PerformancePlan {
  const vocabulary = options.instrumentVocabulary ?? INSTRUMENT_VOCABULARY;
  const definition = vocabulary.instruments.find(
    (item) => item.id === instrumentId,
  );
  if (!definition) throw new Error(`Unknown instrument ${instrumentId}.`);
  const auditionMidi =
    definition.supportedNotes?.includes(midi) === false
      ? (definition.supportedNotes[0] ?? midi)
      : midi;
  const compiled: CompiledAir = {
    format: "compiled-air@0-experimental",
    sourceFormat: "air@0-experimental",
    title: `Audition ${instrumentId}`,
    tempo: 120,
    meter: "4/4",
    beatsPerBar: 4,
    durationBeats: 3,
    durationSeconds: 1.5,
    events: [
      {
        id: "audition:1:1",
        voiceId: "audition",
        role: "audition",
        instrument: instrumentId,
        midi: auditionMidi,
        note: String(auditionMidi),
        startBeat: 0,
        durationBeats: 3,
        soundingDurationBeats: 3,
        velocity: 0.68,
        gainDb: 0,
        pan: 0,
        bar: 1,
        articulation: "none",
        gate: 1,
        source: { voiceId: "audition", authoring: "part" },
      },
    ],
    motifFamilies: [],
    motifOccurrences: [],
    segments: [],
    sections: [],
  };
  const baseBinding = options.performanceBinding ?? DEFAULT_PERFORMANCE_BINDING;
  if (baseBinding.format === PERFORMANCE_BINDING_V1_FORMAT)
    throw new Error(
      "Audition candidate rebinding currently uses the historical engineering binding; render AIR-scoped PerformanceBinding@1 through complete-piece execution.",
    );
  const soundProfile = options.candidateId
    ? soundProfileWithCandidates(
        baseBinding.soundProfile,
        { [instrumentId]: options.candidateId },
        `${baseBinding.soundProfile.id}-audition-${options.candidateId}`,
      )
    : baseBinding.soundProfile;
  const performanceBinding = options.candidateId
    ? createPerformanceBinding({
        id: `${baseBinding.id}-audition-${options.candidateId}`,
        soundProfile,
        renderScene: baseBinding.renderScene,
        permittedOverrides: baseBinding.permittedOverrides,
        overrides: baseBinding.overrides,
        renderer: baseBinding.renderer,
      })
    : baseBinding;
  return createPerformancePlan(compiled, {
    ...options,
    performanceBinding,
    instrumentVocabulary: vocabulary,
  });
}

export function instrumentDefinition(
  instrumentId: string,
): InstrumentDefinition {
  const definition = instrumentById.get(instrumentId);
  if (!definition) throw new Error(`Unknown instrument ${instrumentId}.`);
  return definition;
}

export function currentAsset(assetId: string): SoundAssetDefinition {
  const asset = soundAssetById.get(assetId);
  if (!asset) throw new Error(`Unknown sound asset ${assetId}.`);
  return asset;
}
