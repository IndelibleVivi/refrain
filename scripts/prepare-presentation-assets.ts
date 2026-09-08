import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareLocalAssetProjection,
  prepareSpessaSynthWorklet,
} from "@refrain/audio-engine/local-asset-projection";
import { resolveSoundContentTarget } from "./sound-content-target.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targetName = process.argv[2];
const targetRoots: Record<string, string> = {
  soundbench: resolve(repoRoot, "apps/soundbench/public"),
  presentation: resolve(repoRoot, "apps/presentation/public"),
  "mcp-server": resolve(repoRoot, "packages/mcp-server/public"),
};
const targetRoot = targetRoots[targetName ?? ""];
if (!targetRoot)
  throw new Error("Choose soundbench, presentation, or mcp-server.");

const selectorArguments = process.argv.slice(3);
const selected = selectorArguments.length
  ? await resolveSoundContentTarget(selectorArguments)
  : undefined;
const sourceRoot = resolve(repoRoot, "apps/soundbench/public");

if (selected)
  await prepareLocalAssetProjection({
    assets: selected.assets.map((asset) => ({
      assetId: asset.id,
      bytes: asset.bytes,
      sha256: asset.sha256,
      localPath: asset.localPath,
    })),
    sourceRoot,
    targetRoot,
    missingAssetHint: `Run npm run soundpack:fetch -- ${selectorArguments.join(" ")}.`,
  });
await prepareSpessaSynthWorklet(repoRoot, targetRoot);
process.stdout.write(
  selected
    ? `Prepared ${selected.description} in ${targetRoot}: ${selected.assets.length} exact assets.\n`
    : `Prepared the renderer worklet in ${targetRoot}.\n`,
);
