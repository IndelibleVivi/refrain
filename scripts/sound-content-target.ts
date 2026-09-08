import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileAnyAir } from "@refrain/compiler/any";
import { parseRefrainArtifact } from "@refrain/renderer/portable";
import {
  createExecutionBundle,
  createPreparationPlan,
} from "@refrain/audio-engine/execution";
import { createPerformancePlan } from "@refrain/audio-engine/performance";
import {
  BUILT_IN_PERFORMANCE_BINDINGS,
  BUILT_IN_SOUND_PROFILES,
  validateHistoricalPerformanceBinding,
  validatePerformanceBinding,
  type PerformanceBinding,
  type SoundAssetDefinition,
  type SoundpackManifest,
} from "@refrain/soundpack";
import {
  SHARD_CANDIDATE_PROVIDER,
  SOUND_CATALOG,
  collectCandidateFullClosure,
  collectPaletteFullClosure,
  collectProfileFullClosure,
  resolveSoundpackClosure,
} from "@refrain/soundpack/factory";

export interface SoundContentTarget {
  description: string;
  assets: SoundAssetDefinition[];
}

interface TargetOptions {
  candidate?: string;
  profile?: string;
  palette?: string;
  air?: string;
  binding?: string;
  opening: boolean;
}

function parseOptions(args: readonly string[]): TargetOptions {
  const options: TargetOptions = { opening: false };
  const valued = new Set([
    "--candidate",
    "--profile",
    "--palette",
    "--air",
    "--binding",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--opening") {
      options.opening = true;
      continue;
    }
    if (!valued.has(argument)) throw new Error(`Unknown selector ${argument}.`);
    const value = args[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`${argument} needs a value.`);
    index += 1;
    if (argument === "--candidate") options.candidate = value;
    if (argument === "--profile") options.profile = value;
    if (argument === "--palette") options.palette = value;
    if (argument === "--air") options.air = value;
    if (argument === "--binding") options.binding = value;
  }
  const simpleSelectors = [
    options.candidate,
    options.profile,
    options.palette,
  ].filter(Boolean).length;
  const airSelector =
    options.air !== undefined || options.binding !== undefined;
  if (simpleSelectors + Number(airSelector) > 1)
    throw new Error(
      "Choose one target: candidate, profile, palette, or AIR plus exact binding.",
    );
  if ((options.air === undefined) !== (options.binding === undefined))
    throw new Error("AIR acquisition requires both --air and --binding.");
  if (options.opening && options.air === undefined)
    throw new Error("--opening is valid only with AIR plus exact binding.");
  return options;
}

async function bindingFrom(
  locator: string,
  invocationDirectory: string,
): Promise<PerformanceBinding> {
  const builtIn = BUILT_IN_PERFORMANCE_BINDINGS.find(
    (binding) => binding.id === locator,
  );
  if (builtIn) return builtIn;
  let value: unknown;
  try {
    value = JSON.parse(
      await readFile(resolve(invocationDirectory, locator), "utf8"),
    );
  } catch (cause) {
    throw new Error(
      `Binding ${locator} is neither a built-in ID nor a readable JSON file.`,
      { cause },
    );
  }
  const errors = validateHistoricalPerformanceBinding(value);
  if (errors.length) throw new Error(errors.join("\n"));
  return value as PerformanceBinding;
}

function manifestFor(binding: PerformanceBinding): SoundpackManifest {
  return resolveSoundpackClosure(
    binding.soundProfile,
    SHARD_CANDIDATE_PROVIDER,
  );
}

function exactAssets(
  assetIds: readonly string[],
  manifest: SoundpackManifest,
): SoundAssetDefinition[] {
  const assets = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  return assetIds.map((assetId) => {
    const asset = assets.get(assetId);
    if (!asset)
      throw new Error(`Resolved asset ${assetId} is absent from its manifest.`);
    return asset;
  });
}

export function resolveAirSoundContentTarget(
  source: unknown,
  binding: PerformanceBinding,
  opening = false,
): SoundContentTarget {
  const parsed = parseRefrainArtifact(source);
  if (
    !parsed.ok &&
    typeof source === "object" &&
    source !== null &&
    String((source as { format?: unknown }).format).startsWith(
      "refrain-artifact@",
    )
  )
    throw new Error(parsed.errors.join("\n"));
  const compilation = compileAnyAir(
    parsed.ok ? parsed.artifact.source : source,
  );
  const errors = compilation.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (!compilation.compiled || errors.length)
    throw new Error(
      errors
        .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
        .join("\n"),
    );
  const manifest = manifestFor(binding);
  const bindingErrors = validatePerformanceBinding(binding, manifest);
  if (bindingErrors.length) throw new Error(bindingErrors.join("\n"));
  if (
    binding.renderer.performancePlanFormat === "performance-plan@3-experimental"
  ) {
    const bundle = createExecutionBundle(compilation.compiled, {
      performanceBinding: binding,
      soundRegistry: manifest,
    });
    const assetIds = opening
      ? createPreparationPlan(bundle).openingClosure
      : bundle.plan.assetRequirements.map((asset) => asset.assetId);
    return {
      description: `${opening ? "opening" : "full"} AIR closure with binding ${binding.id} sha256:${binding.contentSha256}`,
      assets: exactAssets(assetIds, manifest),
    };
  }
  if (opening)
    throw new Error("Opening closure requires a performance-plan@3 binding.");
  const plan = createPerformancePlan(compilation.compiled, {
    performanceBinding: binding,
    soundRegistry: manifest,
  });
  return {
    description: `full AIR closure with binding ${binding.id} sha256:${binding.contentSha256}`,
    assets: exactAssets(
      plan.requiredAssets.map((asset) => asset.assetId),
      manifest,
    ),
  };
}

export async function resolveSoundContentTarget(
  args: readonly string[],
): Promise<SoundContentTarget> {
  const options = parseOptions(args);
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  if (options.candidate) {
    const entry = SOUND_CATALOG.candidates.find(
      (candidate) => candidate.candidateId === options.candidate,
    );
    if (!entry)
      throw new Error(`Unknown catalog candidate ${options.candidate}.`);
    const closure = collectCandidateFullClosure(
      { id: entry.candidateId, sha256: entry.candidateContentSha256 },
      SHARD_CANDIDATE_PROVIDER,
    );
    return {
      description: `candidate ${entry.candidateId} sha256:${entry.candidateContentSha256}`,
      assets: closure.assets,
    };
  }
  if (options.profile) {
    const profile = BUILT_IN_SOUND_PROFILES.find(
      (candidate) => candidate.id === options.profile,
    );
    if (!profile) throw new Error(`Unknown exact profile ${options.profile}.`);
    return {
      description: `profile ${profile.id} sha256:${profile.contentSha256}`,
      assets: collectProfileFullClosure(profile, SHARD_CANDIDATE_PROVIDER)
        .assets,
    };
  }
  if (options.palette) {
    const binding = BUILT_IN_PERFORMANCE_BINDINGS.find(
      (candidate) => candidate.soundPalette?.id === options.palette,
    );
    if (!binding?.soundPalette)
      throw new Error(`Unknown exact palette ${options.palette}.`);
    return {
      description: `palette ${binding.soundPalette.id} sha256:${binding.soundPalette.contentSha256}`,
      assets: collectPaletteFullClosure(
        binding.soundPalette,
        binding,
        SHARD_CANDIDATE_PROVIDER,
      ).assets,
    };
  }
  if (options.air && options.binding) {
    const source = JSON.parse(
      await readFile(resolve(invocationDirectory, options.air), "utf8"),
    );
    const binding = await bindingFrom(options.binding, invocationDirectory);
    const target = resolveAirSoundContentTarget(
      source,
      binding,
      options.opening,
    );
    return {
      ...target,
      description: `${target.description} for ${options.air}`,
    };
  }
  throw new Error(
    "Choose an explicit --candidate, --profile, --palette, or --air plus --binding target.",
  );
}
