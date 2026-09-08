import catalogJson from "./sound-catalog.json" with { type: "json" };
import { candidateShardJson } from "./candidate-shards.js";
import {
  INSTRUMENT_VOCABULARY,
  candidateContentSha256,
  soundObjectContentSha256,
  soundProfileContentSha256,
  validateSoundProfile,
  validateSoundpackManifest,
  type CandidatePin,
  type InstrumentCandidate,
  type InstrumentVocabulary,
  type PerformanceBinding,
  type SoundAssetDefinition,
  type SoundPalette,
  type SoundpackManifest,
  type SoundProfile,
} from "./index.js";

export const CANDIDATE_SHARD_FORMAT =
  "refrain-candidate-shard@0-experimental" as const;
export const SOUND_CATALOG_FORMAT =
  "refrain-sound-catalog@0-experimental" as const;

const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9_.@-]*$/;

export interface CandidateShard {
  format: typeof CANDIDATE_SHARD_FORMAT;
  id: string;
  contentSha256: string;
  candidateContentSha256: string;
  candidate: InstrumentCandidate;
  assets: SoundAssetDefinition[];
}

export interface CandidateCatalogEntry {
  candidateId: string;
  instrumentId: string;
  engine: InstrumentCandidate["engine"];
  releaseStatus: InstrumentCandidate["releaseStatus"];
  candidateContentSha256: string;
  shard: { path: string; sha256: string };
}

export interface SoundCatalog {
  format: typeof SOUND_CATALOG_FORMAT;
  id: string;
  contentSha256: string;
  candidates: CandidateCatalogEntry[];
}

export interface ResolvedCandidate {
  pin: CandidatePin;
  candidate: InstrumentCandidate;
  assets: readonly SoundAssetDefinition[];
  shard: { path: string; sha256: string };
}

export type CandidateAvailability =
  | { status: "available"; candidate: ResolvedCandidate }
  | {
      status: "unavailable";
      reason: "candidate-not-installed" | "candidate-content-mismatch";
      message: string;
    };

export interface CandidateProvider {
  resolveExact(pin: CandidatePin): ResolvedCandidate;
  checkAvailability(pin: CandidatePin): CandidateAvailability;
  registry(): SoundpackManifest;
}

export interface SoundContentClosure {
  candidatePins: CandidatePin[];
  shards: Array<{ path: string; sha256: string }>;
  assets: SoundAssetDefinition[];
  bytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function assetsForCandidate(
  candidate: InstrumentCandidate,
  assets: readonly SoundAssetDefinition[],
): SoundAssetDefinition[] {
  const assetIds = new Set<string>();
  if (candidate.assetId) assetIds.add(candidate.assetId);
  if (candidate.mapping.type === "sample-map") {
    for (const region of candidate.mapping.regions)
      assetIds.add(region.assetId);
  }
  return assets.filter((asset) => assetIds.has(asset.id));
}

function manifestOf(
  id: string,
  candidates: InstrumentCandidate[],
  assets: SoundAssetDefinition[],
): SoundpackManifest {
  const core = {
    format: "refrain-soundpack@1-experimental" as const,
    id,
    status: "development-candidates" as const,
    assets,
    candidates,
  };
  return { ...core, contentSha256: soundObjectContentSha256(core) };
}

function shardManifest(shard: CandidateShard): SoundpackManifest {
  return manifestOf(
    `${shard.id}-shard-validation`,
    [shard.candidate],
    shard.assets,
  );
}

export function validateCandidateShard(
  value: unknown,
  vocabulary: InstrumentVocabulary = INSTRUMENT_VOCABULARY,
): string[] {
  if (!isRecord(value)) return ["Candidate shard must be an object."];
  const errors: string[] = [];
  if (
    !exactKeys(value, [
      "assets",
      "candidate",
      "candidateContentSha256",
      "contentSha256",
      "format",
      "id",
    ])
  )
    errors.push("Candidate shard must use the closed current contract.");
  if (value.format !== CANDIDATE_SHARD_FORMAT)
    errors.push("Invalid candidate shard format.");
  if (typeof value.id !== "string" || !ID.test(value.id))
    errors.push("Invalid candidate shard ID.");
  if (!SHA256.test(String(value.contentSha256)))
    errors.push("Invalid candidate shard SHA-256.");
  else if (value.contentSha256 !== soundObjectContentSha256(value))
    errors.push("Candidate shard SHA-256 does not match its content.");
  if (!SHA256.test(String(value.candidateContentSha256)))
    errors.push("Invalid candidate content SHA-256.");
  if (!isRecord(value.candidate) || !Array.isArray(value.assets))
    return [...errors, "Candidate shard needs one candidate and its assets."];

  const shard = value as unknown as CandidateShard;
  if (shard.id !== shard.candidate.id)
    errors.push("Candidate shard ID does not match its candidate.");
  const manifest = shardManifest(shard);
  errors.push(...validateSoundpackManifest(manifest, vocabulary));
  const required = assetsForCandidate(shard.candidate, shard.assets);
  if (required.length !== shard.assets.length)
    errors.push("Candidate shard contains assets outside its exact closure.");
  if (new Set(required.map((asset) => asset.id)).size !== shard.assets.length)
    errors.push("Candidate shard contains duplicate assets.");
  if (
    shard.candidateContentSha256 !==
    candidateContentSha256(shard.candidate, manifest)
  )
    errors.push("Candidate content SHA-256 does not match its content.");
  return errors;
}

export function validateSoundCatalog(value: unknown): string[] {
  if (!isRecord(value)) return ["Sound catalog must be an object."];
  const errors: string[] = [];
  if (!exactKeys(value, ["candidates", "contentSha256", "format", "id"]))
    errors.push("Sound catalog must use the closed current contract.");
  if (value.format !== SOUND_CATALOG_FORMAT)
    errors.push("Invalid sound catalog format.");
  if (typeof value.id !== "string" || !ID.test(value.id))
    errors.push("Invalid sound catalog ID.");
  if (!SHA256.test(String(value.contentSha256)))
    errors.push("Invalid sound catalog SHA-256.");
  else if (value.contentSha256 !== soundObjectContentSha256(value))
    errors.push("Sound catalog SHA-256 does not match its content.");
  if (!Array.isArray(value.candidates))
    return [...errors, "Sound catalog needs candidate entries."];
  const candidateIds = new Set<string>();
  const shardDigests = new Set<string>();
  for (const [index, entry] of value.candidates.entries()) {
    const label = `Sound catalog candidate ${index}`;
    if (!isRecord(entry)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    if (
      !exactKeys(entry, [
        "candidateContentSha256",
        "candidateId",
        "engine",
        "instrumentId",
        "releaseStatus",
        "shard",
      ])
    )
      errors.push(`${label} must use the closed current contract.`);
    if (
      typeof entry.candidateId !== "string" ||
      !ID.test(entry.candidateId) ||
      candidateIds.has(entry.candidateId)
    )
      errors.push(`${label} has an invalid or duplicate candidate ID.`);
    else candidateIds.add(entry.candidateId);
    if (
      typeof entry.instrumentId !== "string" ||
      !ID.test(entry.instrumentId) ||
      !["soundfont", "sampler", "synth"].includes(String(entry.engine)) ||
      !SHA256.test(String(entry.candidateContentSha256))
    )
      errors.push(`${label} has invalid routing facts.`);
    if (
      !isRecord(entry.shard) ||
      !exactKeys(entry.shard, ["path", "sha256"]) ||
      typeof entry.shard.path !== "string" ||
      !entry.shard.path.startsWith("./candidates/sha256/") ||
      !SHA256.test(String(entry.shard.sha256)) ||
      shardDigests.has(String(entry.shard.sha256))
    )
      errors.push(`${label} has an invalid or duplicate shard reference.`);
    else shardDigests.add(String(entry.shard.sha256));
  }
  return errors;
}

export class ShardCandidateProvider implements CandidateProvider {
  private readonly entries = new Map<string, CandidateCatalogEntry>();
  private readonly shards = new Map<string, CandidateShard>();
  private readonly soundpackRegistry: SoundpackManifest;

  constructor(
    readonly catalog: SoundCatalog,
    shards: readonly CandidateShard[],
  ) {
    const catalogErrors = validateSoundCatalog(catalog);
    if (catalogErrors.length) throw new Error(catalogErrors.join("\n"));
    for (const shard of shards) {
      const errors = validateCandidateShard(shard);
      if (errors.length) throw new Error(errors.join("\n"));
      this.shards.set(shard.contentSha256, shard);
    }
    for (const entry of catalog.candidates) {
      const shard = this.shards.get(entry.shard.sha256);
      if (
        !shard ||
        shard.id !== entry.candidateId ||
        shard.candidate.instrumentId !== entry.instrumentId ||
        shard.candidate.engine !== entry.engine ||
        shard.candidate.releaseStatus !== entry.releaseStatus ||
        shard.candidateContentSha256 !== entry.candidateContentSha256
      )
        throw new Error(
          `Catalog entry ${entry.candidateId} does not match its exact shard.`,
        );
      this.entries.set(entry.candidateId, entry);
    }
    const orderedShards = catalog.candidates.map((entry) =>
      this.shards.get(entry.shard.sha256)!,
    );
    const assets = new Map<string, SoundAssetDefinition>();
    for (const shard of orderedShards) {
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
    this.soundpackRegistry = manifestOf(
      `${catalog.id}-registry`,
      orderedShards.map((shard) => shard.candidate),
      [...assets.values()],
    );
  }

  registry(): SoundpackManifest {
    return this.soundpackRegistry;
  }

  resolveExact(pin: CandidatePin): ResolvedCandidate {
    const entry = this.entries.get(pin.id);
    if (!entry) throw new Error(`Sound candidate ${pin.id} is not installed.`);
    if (entry.candidateContentSha256 !== pin.sha256)
      throw new Error(
        `Sound candidate ${pin.id} does not match sha256:${pin.sha256}.`,
      );
    const shard = this.shards.get(entry.shard.sha256)!;
    return {
      pin: { ...pin },
      candidate: shard.candidate,
      assets: shard.assets,
      shard: { ...entry.shard },
    };
  }

  checkAvailability(pin: CandidatePin): CandidateAvailability {
    try {
      return { status: "available", candidate: this.resolveExact(pin) };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return {
        status: "unavailable",
        reason: message.includes("not installed")
          ? "candidate-not-installed"
          : "candidate-content-mismatch",
        message,
      };
    }
  }
}

function uniquePins(profile: SoundProfile): CandidatePin[] {
  const pins = new Map<string, CandidatePin>();
  for (const selection of Object.values(profile.selections)) {
    for (const pin of selection.candidateChain) {
      const existing = pins.get(pin.id);
      if (existing && existing.sha256 !== pin.sha256)
        throw new Error(`SoundProfile pins two identities for ${pin.id}.`);
      pins.set(pin.id, pin);
    }
  }
  return [...pins.values()];
}

export function collectCandidateFullClosure(
  pin: CandidatePin,
  provider: CandidateProvider,
): SoundContentClosure {
  const resolved = provider.resolveExact(pin);
  return {
    candidatePins: [{ ...pin }],
    shards: [{ ...resolved.shard }],
    assets: [...resolved.assets],
    bytes: resolved.assets.reduce((sum, asset) => sum + asset.bytes, 0),
  };
}

export function collectProfileFullClosure(
  profile: SoundProfile,
  provider: CandidateProvider,
): SoundContentClosure {
  const errors = validateSoundProfile(profile, provider.registry());
  if (errors.length) throw new Error(errors.join("\n"));
  const candidatePins = uniquePins(profile);
  const shards = new Map<string, { path: string; sha256: string }>();
  const assets = new Map<string, SoundAssetDefinition>();
  for (const pin of candidatePins) {
    const resolved = provider.resolveExact(pin);
    shards.set(resolved.shard.sha256, resolved.shard);
    for (const asset of resolved.assets) {
      const existing = assets.get(asset.id);
      if (
        existing &&
        (existing.sha256 !== asset.sha256 || existing.bytes !== asset.bytes)
      )
        throw new Error(`Asset identity collision for ${asset.id}.`);
      assets.set(asset.id, asset);
    }
  }
  const selectedAssets = [...assets.values()];
  return {
    candidatePins,
    shards: [...shards.values()],
    assets: selectedAssets,
    bytes: selectedAssets.reduce((sum, asset) => sum + asset.bytes, 0),
  };
}

export function collectPaletteFullClosure(
  palette: SoundPalette,
  binding: PerformanceBinding,
  provider: CandidateProvider,
): SoundContentClosure {
  if (
    !binding.soundPalette ||
    binding.soundPalette.contentSha256 !== palette.contentSha256 ||
    binding.soundPalette.id !== palette.id ||
    palette.soundProfile.id !== binding.soundProfile.id ||
    palette.soundProfile.sha256 !==
      soundProfileContentSha256(binding.soundProfile)
  )
    throw new Error(
      `SoundPalette ${palette.id} is not the exact palette embedded by binding ${binding.id}.`,
    );
  return collectProfileFullClosure(binding.soundProfile, provider);
}

export function resolveSoundpackClosure(
  profile: SoundProfile,
  provider: CandidateProvider,
): SoundpackManifest {
  return resolveSoundpackClosureFromManifest(profile, provider.registry());
}

export function resolveSoundpackClosureFromManifest(
  profile: SoundProfile,
  registry: SoundpackManifest,
): SoundpackManifest {
  const errors = validateSoundProfile(profile, registry);
  if (errors.length) throw new Error(errors.join("\n"));
  const candidateMap = new Map(
    registry.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const assetMap = new Map(registry.assets.map((asset) => [asset.id, asset]));
  const candidates = uniquePins(profile).map((pin) => {
    const candidate = candidateMap.get(pin.id);
    if (!candidate)
      throw new Error(`Sound candidate ${pin.id} is not installed.`);
    if (candidateContentSha256(candidate, registry) !== pin.sha256)
      throw new Error(
        `Sound candidate ${pin.id} does not match sha256:${pin.sha256}.`,
      );
    return candidate;
  });
  const assetIds = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.assetId) assetIds.add(candidate.assetId);
    if (candidate.mapping.type === "sample-map") {
      for (const region of candidate.mapping.regions)
        assetIds.add(region.assetId);
    }
  }
  const assets = [...assetIds].sort().map((assetId) => {
    const asset = assetMap.get(assetId);
    if (!asset)
      throw new Error(`Sound candidate closure is missing asset ${assetId}.`);
    return asset;
  });
  return manifestOf(`${profile.id}-candidate-closure`, candidates, assets);
}

export const SOUND_CATALOG = catalogJson as unknown as Readonly<SoundCatalog>;
export const CANDIDATE_SHARDS =
  candidateShardJson as unknown as readonly CandidateShard[];
export const SHARD_CANDIDATE_PROVIDER = new ShardCandidateProvider(
  SOUND_CATALOG,
  CANDIDATE_SHARDS,
);
