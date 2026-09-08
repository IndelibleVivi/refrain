import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const soundpackRoot = resolve(repoRoot, "packages/soundpack/src");
const shardRoot = resolve(soundpackRoot, "candidates/sha256");

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => key !== "contentSha256")
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

function assetIdsFor(candidate) {
  const ids = new Set();
  if (candidate.assetId) ids.add(candidate.assetId);
  if (candidate.mapping.type === "sample-map") {
    for (const region of candidate.mapping.regions) ids.add(region.assetId);
  }
  return ids;
}

function candidateDigest(candidate, assets) {
  return digest({
    candidate,
    assets: assets
      .map((asset) => ({
        id: asset.id,
        bytes: asset.bytes,
        sha256: asset.sha256,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

const priorCatalog = JSON.parse(
  await readFile(resolve(soundpackRoot, "sound-catalog.json"), "utf8"),
);
const profiles = JSON.parse(
  await readFile(resolve(soundpackRoot, "sound-profiles.json"), "utf8"),
);
const filenames = (await readdir(shardRoot))
  .filter((filename) => /^[0-9a-f]{64}\.json$/.test(filename))
  .sort();
const shards = await Promise.all(
  filenames.map(async (filename) => {
    const shard = JSON.parse(
      await readFile(resolve(shardRoot, filename), "utf8"),
    );
    const actualDigest = digest(shard);
    if (
      shard.format !== "refrain-candidate-shard@0-experimental" ||
      shard.contentSha256 !== actualDigest ||
      filename !== `${actualDigest}.json` ||
      shard.id !== shard.candidate?.id ||
      !Array.isArray(shard.assets)
    )
      throw new Error(`Invalid immutable candidate shard ${filename}.`);
    const requiredIds = assetIdsFor(shard.candidate);
    if (
      requiredIds.size !== shard.assets.length ||
      shard.assets.some((asset) => !requiredIds.has(asset.id)) ||
      shard.candidateContentSha256 !==
        candidateDigest(shard.candidate, shard.assets)
    )
      throw new Error(`Candidate shard ${filename} is not its exact closure.`);
    return { filename, shard };
  }),
);
const byId = new Map();
for (const item of shards) {
  if (byId.has(item.shard.id))
    throw new Error(`Duplicate candidate shard ${item.shard.id}.`);
  byId.set(item.shard.id, item);
}
const priorOrder = priorCatalog.candidates.map((entry) => entry.candidateId);
const orderedIds = [
  ...priorOrder.filter((id) => byId.has(id)),
  ...[...byId.keys()]
    .filter((id) => !priorOrder.includes(id))
    .sort((left, right) => left.localeCompare(right)),
];
const ordered = orderedIds.map((id) => byId.get(id));
const entries = ordered.map(({ filename, shard }) => ({
  candidateId: shard.id,
  instrumentId: shard.candidate.instrumentId,
  engine: shard.candidate.engine,
  releaseStatus: shard.candidate.releaseStatus,
  candidateContentSha256: shard.candidateContentSha256,
  shard: {
    path: `./candidates/sha256/${filename}`,
    sha256: shard.contentSha256,
  },
}));
const catalogCore = {
  format: "refrain-sound-catalog@0-experimental",
  id: priorCatalog.id,
  candidates: entries,
};
const catalog = { ...catalogCore, contentSha256: digest(catalogCore) };

const candidateDigests = new Map(
  entries.map((entry) => [entry.candidateId, entry.candidateContentSha256]),
);
if (profiles.format !== "refrain-sound-profile-set@1-experimental")
  throw new Error("Canonical profiles must use the direct-pin profile set.");
for (const profile of profiles.profiles) {
  if (
    profile.format !== "refrain-sound-profile@1-experimental" ||
    profile.contentSha256 !== digest(profile)
  )
    throw new Error(`Invalid canonical SoundProfile ${profile.id}.`);
  for (const selection of Object.values(profile.selections)) {
    for (const pin of selection.candidateChain) {
      if (candidateDigests.get(pin.id) !== pin.sha256)
        throw new Error(
          `SoundProfile ${profile.id} does not pin installed candidate ${pin.id}.`,
        );
    }
  }
}

await writeFile(
  resolve(soundpackRoot, "sound-catalog.json"),
  `${JSON.stringify(catalog, null, 2)}\n`,
  "utf8",
);
const staticImports = ordered.map(
  ({ filename }, index) =>
    `import shard${index} from "./candidates/sha256/${filename}" with { type: "json" };`,
);
const staticValues = ordered.map((_, index) => `  shard${index},`);
await writeFile(
  resolve(soundpackRoot, "candidate-shards.ts"),
  `${staticImports.join("\n")}\n\nexport const candidateShardJson = [\n${staticValues.join("\n")}\n] as const;\n`,
  "utf8",
);

process.stdout.write(
  `Validated ${entries.length} immutable candidate shards and rebuilt ${relative(repoRoot, resolve(soundpackRoot, "sound-catalog.json"))}.\n`,
);
