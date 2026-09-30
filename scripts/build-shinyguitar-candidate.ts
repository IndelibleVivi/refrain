import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { format as formatText } from "prettier";
import type { SoundAssetDefinition } from "../packages/soundpack/src/index.js";
import {
  SFZ_COMPILER_CONTRACT,
  collectSfzSamplePaths,
  compileSfzCandidate,
  type CompiledSfzCandidate,
} from "../packages/soundpack/src/sfz.js";
import {
  SHINYGUITAR_ACOUSTIC_CANDIDATE_ID,
  SHINYGUITAR_AIR_VOCABULARY,
  SHINYGUITAR_AUTHORING_VOCABULARY,
  SHINYGUITAR_INSTRUMENT_VOCABULARY,
  SHINYGUITAR_MODULE_FACTS,
  SHINYGUITAR_SOURCE,
  createShinyguitarAcousticPack,
  shinyguitarAcousticExtensionPack,
  type ShinyguitarAcousticPackMaterial,
} from "../packages/soundpack/src/shinyguitar.js";
import { sha256, wavMetadata } from "./lib/sound-build.js";

export const SHINYGUITAR_PACK_ROOT =
  "packages/soundpack/packs/shinyguitar-archtop";

/**
 * The pinned program declares `sample=acoustic\\<name>.wav` with no
 * `default_path`. The repository stores the WAVs under `Samples/acoustic/`,
 * next to `Programs/`. Normalize the Windows separator and explicitly rebase
 * the program-relative logical path into that exact source directory.
 */
export function shinyguitarDiskSamplePath(
  sourceRoot: string,
  declaredPath: string,
  sfzPath = SHINYGUITAR_SOURCE.sfzPath,
): string {
  // `collectSfzSamplePaths` resolves each declared sample against the SFZ
  // directory, yielding e.g. `Programs/acoustic/db2_vl1_rr1_1.wav`. The pinned
  // repository stores that member at `Samples/acoustic/db2_vl1_rr1_1.wav`.
  const sfzDir = sfzPath.includes("/")
    ? sfzPath.slice(0, sfzPath.lastIndexOf("/"))
    : "";
  const relative =
    sfzDir && declaredPath.startsWith(`${sfzDir}/`)
      ? declaredPath.slice(sfzDir.length + 1)
      : declaredPath;
  return resolve(sourceRoot, "Samples", relative);
}

export function shinyguitarSourceSamplePath(
  declaredPath: string,
  sfzPath = SHINYGUITAR_SOURCE.sfzPath,
): string {
  const sfzDir = sfzPath.includes("/")
    ? sfzPath.slice(0, sfzPath.lastIndexOf("/"))
    : "";
  const relative =
    sfzDir && declaredPath.startsWith(`${sfzDir}/`)
      ? declaredPath.slice(sfzDir.length + 1)
      : declaredPath;
  return `Samples/${relative}`;
}

function assetId(declaredPath: string, digest: string): string {
  const stem = declaredPath
    .split("/")
    .pop()!
    .replace(/\.[^.]+$/, "");
  const base = stem.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `${SHINYGUITAR_ACOUSTIC_CANDIDATE_ID}-${base}-${digest.slice(0, 12)}`;
}

export interface ShinyguitarBuildResult {
  compiled: CompiledSfzCandidate;
  pack: ShinyguitarAcousticPackMaterial;
  buildRecord: Record<string, unknown>;
  totalBytes: number;
}

export interface ShinyguitarExpectedAsset {
  path: string;
  bytes: number;
  sha256: string;
}

/**
 * Loads the checked-in immutable shard as the rebuild lock for every upstream
 * WAV. The SFZ and license have source constants; the shard supplies the same
 * independent byte/SHA boundary for all 272 sample objects. A rebuild therefore
 * cannot relabel locally modified audio as bytes from the pinned upstream ref.
 */
export async function loadShinyguitarExpectedAssets(
  repoRoot: string,
): Promise<Map<string, ShinyguitarExpectedAsset>> {
  const packRoot = resolve(repoRoot, SHINYGUITAR_PACK_ROOT);
  const record = JSON.parse(
    await readFile(resolve(packRoot, "build-record.json"), "utf8"),
  ) as { candidate?: { shardPath?: unknown } };
  const shardPath = record.candidate?.shardPath;
  if (
    typeof shardPath !== "string" ||
    !/^candidates\/sha256\/[0-9a-f]{64}\.json$/.test(shardPath)
  )
    throw new Error("Checked-in Shinyguitar build record has no exact shard.");
  const shard = JSON.parse(
    await readFile(resolve(packRoot, shardPath), "utf8"),
  ) as {
    assets?: Array<{
      bytes?: unknown;
      sha256?: unknown;
      source?: { path?: unknown; repository?: unknown; ref?: unknown };
    }>;
  };
  if (!Array.isArray(shard.assets))
    throw new Error("Checked-in Shinyguitar shard has no asset lock.");
  const expected = new Map<string, ShinyguitarExpectedAsset>();
  for (const asset of shard.assets) {
    if (
      asset.source?.repository !== SHINYGUITAR_SOURCE.repository ||
      asset.source.ref !== SHINYGUITAR_SOURCE.ref ||
      typeof asset.source.path !== "string" ||
      !Number.isInteger(asset.bytes) ||
      Number(asset.bytes) <= 0 ||
      typeof asset.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(asset.sha256)
    )
      throw new Error(
        "Checked-in Shinyguitar shard has an invalid asset lock.",
      );
    if (expected.has(asset.source.path))
      throw new Error(
        `Checked-in Shinyguitar shard repeats ${asset.source.path}.`,
      );
    expected.set(asset.source.path, {
      path: asset.source.path,
      bytes: Number(asset.bytes),
      sha256: asset.sha256,
    });
  }
  return expected;
}

/**
 * Compiles the pinned Shinyguitar acoustic program and assembles the exact
 * pack material. Pure with respect to the source root: callers decide where the
 * generated JSON is written.
 */
export async function buildShinyguitarAcousticPack(
  sourceRoot: string,
  expectedAssets?: ReadonlyMap<string, ShinyguitarExpectedAsset>,
): Promise<ShinyguitarBuildResult> {
  const sfzPath = SHINYGUITAR_SOURCE.sfzPath;
  const sfzText = await readFile(resolve(sourceRoot, sfzPath), "utf8");
  if (sha256(Buffer.from(sfzText, "utf8")) !== SHINYGUITAR_SOURCE.sfzSha256)
    throw new Error("Programs/acoustic.sfz does not match its exact pin.");
  const licenseBytes = await readFile(resolve(sourceRoot, "LICENSE"));
  if (sha256(licenseBytes) !== SHINYGUITAR_SOURCE.licenseSha256)
    throw new Error("LICENSE does not match its exact pin.");

  const declaredPaths = collectSfzSamplePaths(sfzText, sfzPath);
  const assetLocks = [];
  let totalBytes = 0;
  for (const declared of declaredPaths) {
    const bytes = await readFile(
      shinyguitarDiskSamplePath(sourceRoot, declared),
    );
    const digest = sha256(bytes);
    const sourcePath = shinyguitarSourceSamplePath(declared);
    const expected = expectedAssets?.get(sourcePath);
    if (
      expectedAssets &&
      (!expected ||
        expected.bytes !== bytes.length ||
        expected.sha256 !== digest)
    )
      throw new Error(
        `Pinned Shinyguitar asset ${sourcePath} does not match its checked-in byte/SHA lock.`,
      );
    totalBytes += bytes.length;
    const url = `${SHINYGUITAR_SOURCE.rawUrlRoot}/${sourcePath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const asset: SoundAssetDefinition = {
      id: assetId(declared, digest),
      kind: "wav",
      source: {
        repository: SHINYGUITAR_SOURCE.repository,
        ref: SHINYGUITAR_SOURCE.ref,
        path: sourcePath,
        url,
      },
      localPath: `soundpacks/shinyguitar-archtop/sha256/${digest}.wav`,
      bytes: bytes.length,
      sha256: digest,
      audio: wavMetadata(bytes, declared),
      license: {
        expression: SHINYGUITAR_SOURCE.licenseExpression,
        path: "third_party/Karoryfer-Shinyguitar/LICENSE.txt",
        assetScope:
          "Individual acoustic attack WAV in the pinned Shinyguitar repository.",
      },
      processingHistory: [
        {
          operation: "source-lock",
          tool: SFZ_COMPILER_CONTRACT,
          inputSha256: digest,
          outputSha256: digest,
          parameters: {
            sfzPath,
            declaredPath: declared,
            samplePath: sourcePath,
          },
        },
      ],
      releaseStatus: "listening-candidate",
      publicReleaseAccepted: false,
    };
    assetLocks.push({ path: declared, asset });
  }
  if (expectedAssets && expectedAssets.size !== assetLocks.length)
    throw new Error(
      "Pinned Shinyguitar asset lock does not match the SFZ sample closure.",
    );

  const compiled = compileSfzCandidate({
    sfzText,
    sfzPath,
    candidateId: SHINYGUITAR_ACOUSTIC_CANDIDATE_ID,
    instrumentId: "archtop_guitar",
    midiFallbackProgram: 25,
    calibrationGainDb: 0,
    releaseStatus: "listening-candidate",
    defaults: {
      ampegDynamic: 1,
      attackSeconds: 0.001,
      releaseSeconds: 0.25,
      minVelocity: 1,
      maxVelocity: 127,
    },
    vocabulary: SHINYGUITAR_INSTRUMENT_VOCABULARY,
    assetLocks,
  });

  const pack = createShinyguitarAcousticPack({
    candidate: compiled.candidate,
    assets: compiled.assets,
  });
  const extensionPack = shinyguitarAcousticExtensionPack(pack);
  const candidate = pack.candidateShard.candidate;
  const buildRecord = {
    format: "refrain-shinyguitar-build@1-experimental",
    source: SHINYGUITAR_SOURCE,
    airVocabulary: {
      id: SHINYGUITAR_AIR_VOCABULARY.id,
      contentSha256: SHINYGUITAR_AIR_VOCABULARY.contentSha256,
    },
    runtimeVocabulary: {
      id: SHINYGUITAR_AUTHORING_VOCABULARY.id,
      contentSha256: SHINYGUITAR_AUTHORING_VOCABULARY.contentSha256,
    },
    candidate: {
      id: pack.candidateShard.id,
      contentSha256: pack.candidateShard.candidateContentSha256,
      shardSha256: pack.candidateShard.contentSha256,
      shardPath: `candidates/sha256/${pack.candidateShard.contentSha256}.json`,
      instrumentId: candidate.instrumentId,
      playableMin:
        candidate.mapping.type === "sample-map"
          ? candidate.mapping.playableMin
          : undefined,
      playableMax:
        candidate.mapping.type === "sample-map"
          ? candidate.mapping.playableMax
          : undefined,
      regionCount:
        candidate.mapping.type === "sample-map"
          ? candidate.mapping.regions.length
          : 0,
      assetCount: pack.candidateShard.assets.length,
      bytes: pack.candidateShard.assets.reduce((sum, a) => sum + a.bytes, 0),
    },
    counts: {
      declaredSamples: declaredPaths.length,
      distinctSamples: new Set(declaredPaths).size,
      audioBytes: totalBytes,
      randomGroups: compiled.sourceMap.randomization.groups.length,
      velocityBreaks: compiled.coverage.velocityBreaks,
    },
    moduleRefs: extensionPack.modules,
    assets: extensionPack.assets,
    extensionPack: {
      id: extensionPack.id,
      contentSha256: extensionPack.contentSha256,
    },
  };
  return { compiled, pack, buildRecord, totalBytes };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    await formatText(JSON.stringify(value), { parser: "json" }),
    "utf8",
  );
}

/** Writes the pack projection, shard, catalog and build record into the repo. */
export async function writeShinyguitarAcousticPack(
  repoRoot: string,
  result: ShinyguitarBuildResult,
): Promise<void> {
  const packRoot = resolve(repoRoot, SHINYGUITAR_PACK_ROOT);
  const { pack, compiled, buildRecord } = result;
  const extensionPack = shinyguitarAcousticExtensionPack(pack);
  const shardRoot = resolve(packRoot, "candidates/sha256");
  const shardFilename = `${pack.candidateShard.contentSha256}.json`;
  await mkdir(shardRoot, { recursive: true });
  for (const filename of await readdir(shardRoot)) {
    if (filename.endsWith(".json") && filename !== shardFilename)
      await unlink(resolve(shardRoot, filename));
  }
  await writeJson(resolve(shardRoot, shardFilename), pack.candidateShard);
  await writeJson(resolve(packRoot, "catalog.json"), pack.catalog);
  await writeJson(resolve(packRoot, "pack.json"), extensionPack);
  await writeJson(
    resolve(packRoot, "authoring-vocabulary.json"),
    SHINYGUITAR_AIR_VOCABULARY,
  );
  await writeJson(
    resolve(packRoot, "runtime-vocabulary.json"),
    SHINYGUITAR_AUTHORING_VOCABULARY,
  );
  await writeJson(resolve(packRoot, "sound-profile.json"), pack.soundProfile);
  await writeJson(resolve(packRoot, "render-scene.json"), pack.renderScene);
  await writeJson(resolve(packRoot, "performance-binding.json"), pack.binding);
  await writeJson(resolve(packRoot, "source-map.json"), compiled.sourceMap);
  await writeJson(resolve(packRoot, "build-record.json"), buildRecord);
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value)
    throw new Error(
      `${name} is required: pass the pinned Shinyguitar working tree.`,
    );
  return resolve(value);
}

async function main(): Promise<void> {
  const sourceRoot = argument("--source-root");
  const expectedAssets = await loadShinyguitarExpectedAssets(process.cwd());
  const result = await buildShinyguitarAcousticPack(sourceRoot, expectedAssets);
  await writeShinyguitarAcousticPack(process.cwd(), result);
  const candidate = result.pack.candidateShard;
  process.stdout.write(
    `Built ${SHINYGUITAR_MODULE_FACTS.candidateId}: ${candidate.assets.length} assets, ${result.totalBytes} bytes, ${result.compiled.sourceMap.randomization.groups.length} RR groups, shard ${candidate.contentSha256}.\n`,
  );
}

if (process.argv[1]?.endsWith("build-shinyguitar-candidate.ts")) await main();
