import { readFile, readdir, mkdir, cp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  FileContentAddressedStore,
  ensureAssetClosure,
} from "@refrain/audio-engine/content-addressed-store";
import { prepareLocalAssetProjection } from "@refrain/audio-engine/local-asset-projection";
import { parseRefrainArtifact } from "@refrain/renderer/portable";
import type { SoundAssetDefinition } from "@refrain/soundpack";
import { resolveAirSoundContentTarget } from "./sound-content-target.js";
import { resolveSoundContentStoreRoot } from "./sound-content-store-root.js";

const root = resolve(import.meta.dirname, "..");
const directory = resolve(root, "examples/demo");
const assets = new Map<string, SoundAssetDefinition>();
for (const name of (await readdir(directory)).filter((name) =>
  name.endsWith(".refrain.json"),
)) {
  const parsed = parseRefrainArtifact(
    JSON.parse(await readFile(resolve(directory, name), "utf8")),
  );
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  const artifact = parsed.artifact;
  const binding = artifact.performanceBindings.find(
    (b) => b.id === artifact.defaultBindingId,
  )!;
  for (const asset of resolveAirSoundContentTarget(artifact, binding).assets)
    assets.set(asset.id, asset);
}
const selected = [...assets.values()];
const store = new FileContentAddressedStore({
  root: resolveSoundContentStoreRoot(),
  allowedOrigins: [
    "https://raw.githubusercontent.com",
    "https://freepats.zenvoid.org",
  ],
  maxAssetBytes: 512 * 1024 * 1024,
});
const sourceRoot = resolve(root, "apps/soundbench/public");
await Promise.all(
  selected.map((asset) =>
    store.adopt(asset, resolve(sourceRoot, asset.localPath)),
  ),
);
const content = await ensureAssetClosure(selected, store, {
  maxAssets: 512,
  maxBytes: 2 * 1024 * 1024 * 1024,
  maxConcurrentFetches: 4,
  onProgress: ({ completedAssets, totalAssets }) =>
    process.stdout.write(`Demo sounds: ${completedAssets}/${totalAssets}\n`),
});
for (const [index, asset] of selected.entries())
  await store.project(content[index]!, resolve(sourceRoot, asset.localPath));
const targetRoot = resolve(root, "apps/presentation/.demo-assets");
await prepareLocalAssetProjection({
  assets: selected.map((asset) => ({
    assetId: asset.id,
    bytes: asset.bytes,
    sha256: asset.sha256,
    localPath: asset.localPath,
  })),
  sourceRoot,
  targetRoot,
  missingAssetHint: "Run npm run prepare:demo.",
});
await mkdir(resolve(targetRoot, "docs"), { recursive: true });
await cp(
  resolve(root, "docs/SOUND-SOURCES.md"),
  resolve(targetRoot, "docs/SOUND-SOURCES.md"),
);
await cp(resolve(root, "third_party"), resolve(targetRoot, "third_party"), {
  recursive: true,
});
await writeFile(
  resolve(targetRoot, "sound-provenance.json"),
  JSON.stringify({ assets: selected }, null, 2) + "\n",
);
process.stdout.write(
  `Prepared ${selected.length} exact demo assets, ${selected.reduce((n, a) => n + a.bytes, 0)} bytes.\n`,
);
