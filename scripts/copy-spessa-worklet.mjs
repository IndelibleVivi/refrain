import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(
  repoRoot,
  "node_modules/spessasynth_lib/dist/spessasynth_processor.min.js",
);
const target = resolve(
  repoRoot,
  "apps/soundbench/public/spessasynth_processor.min.js",
);

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
process.stdout.write(`Copied SpessaSynth worklet to ${target}\n`);
