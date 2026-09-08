import {
  SOUND_REGISTRY,
  type InstrumentCandidate,
  type SampleRegion,
  type SoundAssetDefinition,
  type SoundpackManifest,
} from "@refrain/soundpack";
import { resolveSoundpackClosureFromManifest } from "@refrain/soundpack/factory";
import { canonicalJson, sha256Hex } from "./digest.js";
import { performanceEventAt, type ExecutionBundle } from "./execution.js";
import {
  resolveSoundpackClosureForProfileV2,
  type PerformancePlan,
} from "./performance.js";
import type { SoundProfile } from "@refrain/soundpack";
import type { SoundProfileV2 } from "@refrain/soundpack/vnext";
import type { VerifiedRequiredAsset, WavAmplitudePolicy } from "./pcm.js";

export type RenderAdapter =
  | "browser-direct"
  | "browser-prerender"
  | "browser-streaming-pcm"
  | "headless-pcm"
  | "worker-block-pcm"
  | "node-block-pcm"
  | "wav"
  | "midi";

export const HISTORICAL_RENDER_RECEIPT_FORMAT =
  "refrain-render-receipt@2-experimental" as const;
export const RENDER_RECEIPT_V3_FORMAT =
  "refrain-render-receipt@3-experimental" as const;

export interface RenderReceiptV2 {
  format: "refrain-render-receipt@2-experimental";
  renderReceiptId: string;
  sourceRevision: string;
  compilerContract: string;
  resolverContract: string;
  vocabularyDigest: string;
  soundClosureDigest: string;
  soundProfileDigest: string;
  renderSceneDigest: string;
  soundPaletteDigest?: string;
  performanceBindingDigest: string;
  resolvedRenderProfileDigest: string;
  rendererContract: string;
  performancePlanDigest: string;
  selectedCandidates: Array<{
    instrumentId: string;
    candidateId: string;
    candidateDigest: string;
    fallbackUsed: boolean;
  }>;
  requiredAssets: Array<{
    assetId: string;
    sha256: string;
    bytes: number;
  }>;
  verifiedAssets?: VerifiedRequiredAsset[];
  adapter: RenderAdapter;
  sampleRate?: number;
  outputSha256?: string;
  outputAmplitude?: WavAmplitudePolicy;
  adaptationNotes?: string[];
}

export interface RenderReceiptV3 extends Omit<RenderReceiptV2, "format"> {
  format: typeof RENDER_RECEIPT_V3_FORMAT;
}

export type RenderReceipt = RenderReceiptV2 | RenderReceiptV3;

export interface AssetClosure {
  format: "refrain-asset-closure@0-experimental";
  soundpack: { id: string; sha256: string };
  candidates: InstrumentCandidate[];
  assets: SoundAssetDefinition[];
}

export interface CreateRenderReceiptInput {
  sourceRevision: string;
  adapter: RenderAdapter;
  sampleRate?: number;
  outputSha256?: string;
  adaptationNotes?: readonly string[];
  compilerContract?: string;
  verifiedAssets?: readonly VerifiedRequiredAsset[];
  outputAmplitude?: WavAmplitudePolicy;
}

const SHA256_ID = /^sha256:[0-9a-f]{64}$/;

function digest(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

function selectedCandidates(plan: Pick<PerformancePlan, "voices">) {
  return [
    ...new Map(
      plan.voices.map((voice) => [
        voice.instrument,
        {
          instrumentId: voice.instrument,
          candidateId: voice.candidateId,
          candidateDigest: `sha256:${voice.candidateDigest}`,
          fallbackUsed: voice.fallbackUsed,
        },
      ]),
    ).values(),
  ].sort((left, right) => left.instrumentId.localeCompare(right.instrumentId));
}

function performancePlanIdentity(plan: PerformancePlan): unknown {
  return {
    format: plan.format,
    resolverContract: plan.resolverContract,
    compiled: plan.compiled,
    performanceBinding: plan.performanceBinding,
    resolvedRenderProfile: plan.resolvedRenderProfile,
    soundProfile: plan.soundProfile,
    renderScene: plan.renderScene,
    soundPalette: plan.soundPalette,
    rendererContract: plan.rendererContract,
    vocabulary: plan.vocabulary,
    soundpack: plan.soundpack,
    voices: plan.voices,
    events: plan.events,
    requiredAssets: plan.requiredAssets,
    durationSeconds: plan.durationSeconds,
  };
}

export function createRenderReceipt(
  plan: PerformancePlan,
  input: CreateRenderReceiptInput,
): RenderReceiptV2 {
  if (!SHA256_ID.test(input.sourceRevision))
    throw new Error("A render receipt requires a complete sourceRevision.");
  if (input.outputSha256 !== undefined && !SHA256_ID.test(input.outputSha256))
    throw new Error("outputSha256 must be a complete lowercase SHA-256 ID.");
  const expectedAssets = [...plan.requiredAssets]
    .map((asset) => ({
      assetId: asset.assetId,
      sha256: asset.sha256,
      bytes: asset.bytes,
    }))
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
  const verifiedAssets = input.verifiedAssets
    ? [...input.verifiedAssets].sort((left, right) =>
        left.assetId.localeCompare(right.assetId),
      )
    : undefined;
  const defaultAdaptation =
    input.adapter === "midi"
      ? [
          "MIDI preserves schedule, channel, program/percussion approximation, velocity, gain, and pan where encodable; sample regions, loops, round robin, sampled releases, and synth timbre are omitted.",
          "MIDI does not encode the RenderScene peak ceiling or other non-MIDI production treatment.",
        ]
      : [];
  const core = {
    format: "refrain-render-receipt@2-experimental" as const,
    sourceRevision: input.sourceRevision,
    compilerContract: input.compilerContract ?? plan.compiled.format,
    resolverContract: plan.resolverContract,
    vocabularyDigest: `sha256:${plan.vocabulary.sha256}`,
    soundClosureDigest: `sha256:${plan.soundpack.sha256}`,
    soundProfileDigest: `sha256:${plan.performanceBinding.soundProfileSha256}`,
    renderSceneDigest: `sha256:${plan.renderScene.contentSha256}`,
    ...(plan.soundPalette === undefined
      ? {}
      : { soundPaletteDigest: `sha256:${plan.soundPalette.contentSha256}` }),
    performanceBindingDigest: `sha256:${plan.performanceBinding.contentSha256}`,
    resolvedRenderProfileDigest: digest(plan.resolvedRenderProfile),
    rendererContract: plan.rendererContract,
    performancePlanDigest: digest(performancePlanIdentity(plan)),
    selectedCandidates: selectedCandidates(plan),
    requiredAssets: expectedAssets,
    ...(verifiedAssets === undefined ? {} : { verifiedAssets }),
    adapter: input.adapter,
    ...(input.sampleRate === undefined ? {} : { sampleRate: input.sampleRate }),
    ...(input.outputSha256 === undefined
      ? {}
      : { outputSha256: input.outputSha256 }),
    ...(input.outputAmplitude === undefined
      ? {}
      : { outputAmplitude: input.outputAmplitude }),
    ...((input.adaptationNotes?.length ?? defaultAdaptation.length) === 0
      ? {}
      : {
          adaptationNotes: [...(input.adaptationNotes ?? defaultAdaptation)],
        }),
  };
  const receipt: RenderReceiptV2 = {
    ...core,
    renderReceiptId: digest(core),
  };
  const semanticErrors = validateRenderReceiptSemantics(receipt);
  if (semanticErrors.length) throw new Error(semanticErrors.join("\n"));
  return receipt;
}

export function createExecutionRenderReceipt(
  bundle: ExecutionBundle,
  input: CreateRenderReceiptInput,
): RenderReceipt {
  if (!SHA256_ID.test(input.sourceRevision))
    throw new Error("A render receipt requires a complete sourceRevision.");
  if (input.sourceRevision !== bundle.sourceRevision)
    throw new Error(
      "The render receipt sourceRevision does not match the sealed ExecutionBundle.",
    );
  if (input.outputSha256 !== undefined && !SHA256_ID.test(input.outputSha256))
    throw new Error("outputSha256 must be a complete lowercase SHA-256 ID.");
  const plan = bundle.plan;
  const expectedAssets = [...plan.assetRequirements]
    .map((asset) => ({
      assetId: asset.assetId,
      sha256: asset.sha256,
      bytes: asset.bytes,
    }))
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
  const verifiedAssets = input.verifiedAssets
    ? [...input.verifiedAssets].sort((left, right) =>
        left.assetId.localeCompare(right.assetId),
      )
    : undefined;
  const defaultAdaptation =
    input.adapter === "midi"
      ? [
          "MIDI preserves schedule, channel, program/percussion approximation, velocity, gain, and pan where encodable; sample regions, loops, round robin, sampled releases, and synth timbre are omitted.",
          "MIDI does not encode the RenderScene peak ceiling or other non-MIDI production treatment.",
        ]
      : [];
  const binding = plan.performanceBinding;
  const format =
    plan.format === "performance-plan@4-experimental" ||
    bundle.compiled.format === "compiled-air@1-experimental"
      ? RENDER_RECEIPT_V3_FORMAT
      : HISTORICAL_RENDER_RECEIPT_FORMAT;
  const core = {
    format,
    sourceRevision: input.sourceRevision,
    compilerContract: input.compilerContract ?? plan.compilerContract,
    resolverContract: plan.resolverContract,
    vocabularyDigest: `sha256:${plan.vocabulary.sha256}`,
    soundClosureDigest: `sha256:${plan.soundpack.sha256}`,
    soundProfileDigest: `sha256:${binding.soundProfileSha256}`,
    renderSceneDigest: `sha256:${binding.renderScene.contentSha256}`,
    ...(binding.soundPaletteSha256 === undefined
      ? {}
      : { soundPaletteDigest: `sha256:${binding.soundPaletteSha256}` }),
    performanceBindingDigest: `sha256:${binding.contentSha256}`,
    resolvedRenderProfileDigest: digest(plan.resolvedRenderProfile),
    rendererContract: binding.renderer.contract,
    performancePlanDigest: bundle.planSha256,
    selectedCandidates: selectedCandidates(plan),
    requiredAssets: expectedAssets,
    ...(verifiedAssets === undefined ? {} : { verifiedAssets }),
    adapter: input.adapter,
    ...(input.sampleRate === undefined ? {} : { sampleRate: input.sampleRate }),
    ...(input.outputSha256 === undefined
      ? {}
      : { outputSha256: input.outputSha256 }),
    ...(input.outputAmplitude === undefined
      ? {}
      : { outputAmplitude: input.outputAmplitude }),
    ...((input.adaptationNotes?.length ?? defaultAdaptation.length) === 0
      ? {}
      : {
          adaptationNotes: [...(input.adaptationNotes ?? defaultAdaptation)],
        }),
  };
  const receipt: RenderReceipt = {
    ...core,
    renderReceiptId: digest(core),
  };
  const semanticErrors = validateRenderReceiptSemantics(receipt);
  if (semanticErrors.length) throw new Error(semanticErrors.join("\n"));
  return receipt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function validAssets(items: unknown): items is RenderReceipt["requiredAssets"] {
  return (
    Array.isArray(items) &&
    items.every(
      (item) =>
        isRecord(item) &&
        exactKeys(item, ["assetId", "bytes", "sha256"]) &&
        typeof item.assetId === "string" &&
        typeof item.bytes === "number" &&
        Number.isInteger(item.bytes) &&
        item.bytes >= 0 &&
        typeof item.sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(item.sha256),
    )
  );
}

function canonicalAssetList(items: RenderReceipt["requiredAssets"]): string {
  return canonicalJson(
    [...items].sort((left, right) => left.assetId.localeCompare(right.assetId)),
  );
}

export function validateRenderReceiptSemantics(value: unknown): string[] {
  if (!isRecord(value)) return ["RenderReceipt must be an object."];
  const errors: string[] = [];
  const adapter = value.adapter;
  if (adapter === "wav" || adapter === "node-block-pcm") {
    if (value.outputAmplitude === undefined)
      errors.push("A WAV render receipt requires an outputAmplitude policy.");
    if (
      typeof value.sampleRate !== "number" ||
      !Number.isFinite(value.sampleRate) ||
      value.sampleRate <= 0
    )
      errors.push("A WAV render receipt requires a positive sampleRate.");
  } else if (value.outputAmplitude !== undefined) {
    errors.push(
      "Only a WAV or Node block-WAV render receipt may declare outputAmplitude.",
    );
  }

  if (!validAssets(value.requiredAssets)) return errors;
  const requiredAssets = value.requiredAssets;
  const verifiedAssets =
    value.verifiedAssets === undefined
      ? undefined
      : validAssets(value.verifiedAssets)
        ? value.verifiedAssets
        : undefined;
  if (
    new Set(requiredAssets.map((asset) => asset.assetId)).size !==
    requiredAssets.length
  )
    errors.push("RenderReceipt requiredAssets contain duplicate asset IDs.");
  if (Array.isArray(value.selectedCandidates)) {
    const selected = value.selectedCandidates.filter(isRecord);
    if (
      new Set(selected.map((candidate) => candidate.instrumentId)).size !==
      selected.length
    )
      errors.push(
        "RenderReceipt selectedCandidates contain duplicate instrument IDs.",
      );
    if (
      new Set(selected.map((candidate) => candidate.candidateId)).size !==
      selected.length
    )
      errors.push(
        "RenderReceipt selectedCandidates contain duplicate candidate IDs.",
      );
  }
  if (
    value.verifiedAssets !== undefined &&
    verifiedAssets !== undefined &&
    new Set(verifiedAssets.map((asset) => asset.assetId)).size !==
      verifiedAssets.length
  )
    errors.push("RenderReceipt verifiedAssets contain duplicate asset IDs.");
  if (adapter !== "midi" && requiredAssets.length > 0 && !verifiedAssets)
    errors.push(
      "An audible render receipt requires the assets actually verified during rendering.",
    );
  if (
    verifiedAssets &&
    canonicalAssetList(verifiedAssets) !== canonicalAssetList(requiredAssets)
  )
    errors.push(
      "Verified render assets do not match the PerformancePlan closure.",
    );
  return errors;
}

export function renderReceiptShapeIsValid(
  value: unknown,
): value is RenderReceipt {
  if (!isRecord(value)) return false;
  const expectedKeys = [
    "adapter",
    "compilerContract",
    "format",
    "performanceBindingDigest",
    "performancePlanDigest",
    "renderReceiptId",
    "renderSceneDigest",
    "rendererContract",
    "requiredAssets",
    "resolvedRenderProfileDigest",
    "resolverContract",
    "selectedCandidates",
    "soundProfileDigest",
    "soundClosureDigest",
    "sourceRevision",
    "vocabularyDigest",
    ...(value.soundPaletteDigest === undefined ? [] : ["soundPaletteDigest"]),
    ...(value.verifiedAssets === undefined ? [] : ["verifiedAssets"]),
    ...(value.sampleRate === undefined ? [] : ["sampleRate"]),
    ...(value.outputSha256 === undefined ? [] : ["outputSha256"]),
    ...(value.outputAmplitude === undefined ? [] : ["outputAmplitude"]),
    ...(value.adaptationNotes === undefined ? [] : ["adaptationNotes"]),
  ];
  if (!exactKeys(value, expectedKeys)) return false;
  if (
    ![HISTORICAL_RENDER_RECEIPT_FORMAT, RENDER_RECEIPT_V3_FORMAT].includes(
      value.format as typeof HISTORICAL_RENDER_RECEIPT_FORMAT,
    ) ||
    typeof value.renderReceiptId !== "string" ||
    !SHA256_ID.test(value.renderReceiptId) ||
    typeof value.sourceRevision !== "string" ||
    !SHA256_ID.test(value.sourceRevision) ||
    typeof value.compilerContract !== "string" ||
    typeof value.resolverContract !== "string" ||
    typeof value.rendererContract !== "string" ||
    ![
      "browser-direct",
      "browser-prerender",
      "browser-streaming-pcm",
      "headless-pcm",
      "worker-block-pcm",
      "node-block-pcm",
      "wav",
      "midi",
    ].includes(String(value.adapter))
  )
    return false;
  for (const key of [
    "vocabularyDigest",
    "soundClosureDigest",
    "soundProfileDigest",
    "renderSceneDigest",
    "performanceBindingDigest",
    "resolvedRenderProfileDigest",
    "performancePlanDigest",
  ] as const) {
    if (typeof value[key] !== "string" || !SHA256_ID.test(value[key]))
      return false;
  }
  if (
    value.soundPaletteDigest !== undefined &&
    (typeof value.soundPaletteDigest !== "string" ||
      !SHA256_ID.test(value.soundPaletteDigest))
  )
    return false;
  if (
    value.outputSha256 !== undefined &&
    (typeof value.outputSha256 !== "string" ||
      !SHA256_ID.test(value.outputSha256))
  )
    return false;
  if (
    value.sampleRate !== undefined &&
    (typeof value.sampleRate !== "number" || value.sampleRate <= 0)
  )
    return false;
  if (!Array.isArray(value.selectedCandidates)) return false;
  for (const item of value.selectedCandidates) {
    if (
      !isRecord(item) ||
      !exactKeys(item, [
        "candidateDigest",
        "candidateId",
        "fallbackUsed",
        "instrumentId",
      ]) ||
      typeof item.instrumentId !== "string" ||
      item.instrumentId.length === 0 ||
      typeof item.candidateId !== "string" ||
      item.candidateId.length === 0 ||
      typeof item.candidateDigest !== "string" ||
      !SHA256_ID.test(item.candidateDigest) ||
      typeof item.fallbackUsed !== "boolean"
    )
      return false;
  }
  if (!validAssets(value.requiredAssets)) return false;
  if (value.verifiedAssets !== undefined && !validAssets(value.verifiedAssets))
    return false;
  if (
    value.adaptationNotes !== undefined &&
    (!Array.isArray(value.adaptationNotes) ||
      !value.adaptationNotes.every((item) => typeof item === "string"))
  )
    return false;
  if (value.outputAmplitude !== undefined) {
    if (!isRecord(value.outputAmplitude)) return false;
    if (value.outputAmplitude.mode === "native-gain") {
      if (!exactKeys(value.outputAmplitude, ["mode"])) return false;
    } else if (
      value.outputAmplitude.mode === "audition-peak-matched" &&
      exactKeys(value.outputAmplitude, ["contract", "mode", "targetPeak"]) &&
      value.outputAmplitude.contract ===
        "refrain-audition-peak-match@0-experimental" &&
      typeof value.outputAmplitude.targetPeak === "number" &&
      value.outputAmplitude.targetPeak > 0 &&
      value.outputAmplitude.targetPeak <= 1
    ) {
      // Valid matched-output contract.
    } else return false;
  }
  if (validateRenderReceiptSemantics(value).length > 0) return false;
  const { renderReceiptId, ...core } = value;
  return renderReceiptId === digest(core);
}

function selectedRegionIds(plan: PerformancePlan): Set<string> {
  return new Set(
    plan.events.flatMap((event) =>
      event.sample
        ? [
            event.sample.regionId,
            ...(event.sample.releaseSample
              ? [event.sample.releaseSample.regionId]
              : []),
          ]
        : [],
    ),
  );
}

function compactCandidate(
  candidate: InstrumentCandidate,
  regionIds: Set<string>,
): InstrumentCandidate {
  if (candidate.mapping.type !== "sample-map")
    return structuredClone(candidate);
  return {
    ...structuredClone(candidate),
    mapping: {
      ...structuredClone(candidate.mapping),
      regions: candidate.mapping.regions.filter((region: SampleRegion) =>
        regionIds.has(region.id),
      ),
    },
  };
}

export function createAssetClosure(
  plan: PerformancePlan,
  registry: SoundpackManifest = SOUND_REGISTRY,
): AssetClosure {
  const manifest =
    plan.soundProfile.format === "refrain-sound-profile@2-experimental"
      ? resolveSoundpackClosureForProfileV2(
          plan.soundProfile as SoundProfileV2,
          registry,
        )
      : resolveSoundpackClosureFromManifest(
          plan.soundProfile as SoundProfile,
          registry,
        );
  if (
    manifest.id !== plan.soundpack.id ||
    manifest.contentSha256 !== plan.soundpack.sha256
  ) {
    throw new Error("The asset-closure manifest does not match the plan.");
  }
  const candidateIds = new Set(plan.voices.map((voice) => voice.candidateId));
  const regionIds = selectedRegionIds(plan);
  const candidates = manifest.candidates
    .filter((candidate) => candidateIds.has(candidate.id))
    .map((candidate) => compactCandidate(candidate, regionIds))
    .sort((left, right) => left.id.localeCompare(right.id));
  const requiredAssetIds = new Set(
    plan.requiredAssets.map((asset) => asset.assetId),
  );
  const assets = manifest.assets
    .filter((asset) => requiredAssetIds.has(asset.id))
    .map((asset) => structuredClone(asset))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (
    candidates.length !== candidateIds.size ||
    assets.length !== requiredAssetIds.size
  )
    throw new Error("The manifest cannot satisfy the plan's asset closure.");
  return {
    format: "refrain-asset-closure@0-experimental",
    soundpack: { ...plan.soundpack },
    candidates,
    assets,
  };
}

export function createExecutionAssetClosure(
  bundle: ExecutionBundle,
  registry: SoundpackManifest = SOUND_REGISTRY,
): AssetClosure {
  const profile = bundle.plan.performanceBinding.soundProfile;
  const manifest =
    profile.format === "refrain-sound-profile@2-experimental"
      ? resolveSoundpackClosureForProfileV2(profile as SoundProfileV2, registry)
      : resolveSoundpackClosureFromManifest(profile as SoundProfile, registry);
  if (
    manifest.id !== bundle.plan.soundpack.id ||
    manifest.contentSha256 !== bundle.plan.soundpack.sha256
  ) {
    throw new Error("The asset-closure manifest does not match the plan.");
  }
  const candidateIds = new Set(
    bundle.plan.voices.map((voice) => voice.candidateId),
  );
  const regionIds = new Set<string>();
  for (let index = 0; index < bundle.compiled.events.length; index += 1) {
    const sample = performanceEventAt(bundle, index).sample;
    if (!sample) continue;
    regionIds.add(sample.regionId);
    if (sample.releaseSample) regionIds.add(sample.releaseSample.regionId);
  }
  const candidates = manifest.candidates
    .filter((candidate) => candidateIds.has(candidate.id))
    .map((candidate) => compactCandidate(candidate, regionIds))
    .sort((left, right) => left.id.localeCompare(right.id));
  const requiredAssetIds = new Set(
    bundle.plan.assetRequirements.map((asset) => asset.assetId),
  );
  const assets = manifest.assets
    .filter((asset) => requiredAssetIds.has(asset.id))
    .map((asset) => structuredClone(asset))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (
    candidates.length !== candidateIds.size ||
    assets.length !== requiredAssetIds.size
  )
    throw new Error("The manifest cannot satisfy the plan's asset closure.");
  return {
    format: "refrain-asset-closure@0-experimental",
    soundpack: { ...bundle.plan.soundpack },
    candidates,
    assets,
  };
}
