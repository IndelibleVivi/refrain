import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FileContentAddressedStore,
  ensureAssetClosure,
} from "@refrain/audio-engine/content-addressed-store";
import { resolveSoundContentTarget } from "./sound-content-target.js";
import { resolveSoundContentStoreRoot } from "./sound-content-store-root.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(repoRoot, "apps/soundbench/public");
const storeRoot = resolveSoundContentStoreRoot();
const target = await resolveSoundContentTarget(process.argv.slice(2));
const totalBytes = target.assets.reduce((sum, asset) => sum + asset.bytes, 0);

process.stdout.write(
  `Acquiring ${target.description}: ${target.assets.length} assets, ${totalBytes} bytes.\nContent store: ${storeRoot}\n`,
);

const store = new FileContentAddressedStore({
  root: storeRoot,
  allowedOrigins: [
    "https://raw.githubusercontent.com",
    "https://freepats.zenvoid.org",
  ],
  maxAssetBytes: 512 * 1024 * 1024,
});
await Promise.all(
  target.assets.map((asset) =>
    store.adopt(asset, resolve(publicRoot, asset.localPath)),
  ),
);
const acquired = await ensureAssetClosure(target.assets, store, {
  maxAssets: 512,
  maxBytes: 2 * 1024 * 1024 * 1024,
  maxConcurrentFetches: 4,
  onProgress: ({
    acquired: content,
    completedAssets,
    completedBytes,
    totalAssets,
    totalBytes,
  }) => {
    process.stdout.write(
      `Verified ${completedAssets}/${totalAssets} assets, ${completedBytes}/${totalBytes} bytes (${content.cache}): ${content.assetId}\n`,
    );
  },
});

for (const [index, asset] of target.assets.entries()) {
  const content = acquired[index]!;
  await store.project(content, resolve(publicRoot, asset.localPath));
}
process.stdout.write(
  `Projected ${target.assets.length} verified assets into ${publicRoot}.\n`,
);
