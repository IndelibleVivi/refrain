import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  rm,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileAirV1 } from "@refrain/compiler/v1";
import { parseRefrainArtifact } from "@refrain/renderer/portable";
import { createExecutionBundle } from "@refrain/audio-engine/execution";
import { renderExecutionBlocks } from "@refrain/audio-engine/block-renderer";
import { encodePcmWav } from "@refrain/audio-engine/pcm";
import {
  FileContentAddressedStore,
  ensureAssetClosure,
} from "@refrain/audio-engine/content-addressed-store";
import {
  sha256Bytes,
  verifyAssetBytes,
} from "../packages/audio-engine/src/digest.js";
import { F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING } from "@refrain/soundpack";
import {
  resolveSoundpackClosure,
  SHARD_CANDIDATE_PROVIDER,
} from "@refrain/soundpack/factory";
import { resolveSoundContentStoreRoot } from "./sound-content-store-root.js";
import { createScore } from "../apps/handoff-study/src/score.js";
import {
  newSession,
  choose,
  validateManifest,
} from "../apps/handoff-study/src/model.js";
import {
  assemble,
  decodePhrase,
  type PhrasePcm,
} from "../apps/handoff-study/src/wav.js";
import type {
  StudyManifest,
  RouteKey,
} from "../apps/handoff-study/src/contracts.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "apps/handoff-study/.audio");
await mkdir(out, { recursive: true });
const score = createScore();
const bundles = new Map(
  score.chunks.map((chunk) => {
    const parsed = parseRefrainArtifact(chunk.artifact);
    if (!parsed.ok || parsed.artifact.source.format !== "air@1-experimental")
      throw new Error(`Invalid phrase ${chunk.id}`);
    const artifact = parsed.artifact;
    const result = compileAirV1(artifact.source);
    if (!result.compiled) throw new Error(JSON.stringify(result.diagnostics));
    return [
      chunk.id,
      createExecutionBundle(result.compiled, {
        sourceRevision: artifact.receipt.sourceRevision,
        performanceBinding: F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING,
      }),
    ] as const;
  }),
);
const registry = resolveSoundpackClosure(
  F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING.soundProfile,
  SHARD_CANDIDATE_PROVIDER,
);
const needed = new Set(
  [...bundles.values()].flatMap((bundle) =>
    bundle.plan.assetRequirements.map((a) => a.assetId),
  ),
);
const assets = registry.assets.filter((a) => needed.has(a.id));
if (assets.length !== needed.size)
  throw new Error("Incomplete sampled asset closure.");
await writeFile(
  resolve(out, "required-assets.json"),
  JSON.stringify(assets, null, 2),
);
const publicRoot = resolve(root, "apps/soundbench/public");
const store = new FileContentAddressedStore({
  root: resolveSoundContentStoreRoot(),
  allowedOrigins: [
    "https://raw.githubusercontent.com",
    "https://freepats.zenvoid.org",
  ],
  maxAssetBytes: 512 * 1024 * 1024,
});
await Promise.all(
  assets.map((asset) =>
    store.adopt(asset, resolve(publicRoot, asset.localPath)),
  ),
);
console.log(
  `Preparing ${assets.length} exact assets for ${score.chunks.length} phrases.`,
);
const acquired = await ensureAssetClosure(assets, store, {
  maxAssets: 128,
  maxBytes: 512 * 1024 * 1024,
  maxConcurrentFetches: 4,
  onProgress: (p) =>
    console.log(
      `Verified ${p.completedAssets}/${p.totalAssets}: ${p.acquired.assetId} (${p.acquired.cache})`,
    ),
});
const samples: Record<string, ArrayBuffer> = {};
for (const [i, asset] of assets.entries()) {
  await store.project(acquired[i]!, resolve(publicRoot, asset.localPath));
  const bytes = new Uint8Array(await readFile(acquired[i]!.contentPath));
  await verifyAssetBytes(
    { assetId: asset.id, bytes: asset.bytes, sha256: asset.sha256 },
    bytes.buffer,
  );
  samples[asset.id] = bytes.buffer;
}
const manifest: StudyManifest = {
  format: "handoff-study-audio@0",
  score,
  audio: {},
  mixGain: 0.8,
};
const pcm = new Map<string, PhrasePcm>();
for (const [id, bundle] of bundles) {
  const frames = Math.ceil(bundle.plan.renderDurationSeconds * 44100);
  const left = new Float32Array(frames),
    right = new Float32Array(frames);
  for await (const block of renderExecutionBlocks(bundle, { samples }, 44100)) {
    left.set(block.left, block.frameOffset);
    right.set(block.right, block.frameOffset);
  }
  const peak = measure({ left, right });
  if (peak <= 0 || peak > 0.95)
    throw new Error(`Unsafe phrase peak ${id}: ${peak}`);
  const bytes = encodePcmWav({
    left,
    right,
    sampleRate: 44100,
    durationSeconds: frames / 44100,
  });
  const digest = await sha256Bytes(bytes);
  const file = `${id}-${digest.slice(0, 16)}.wav`;
  await writeFile(resolve(out, file), new Uint8Array(bytes));
  manifest.audio[id] = {
    file,
    bytes: bytes.byteLength,
    sha256: digest,
    sampleRate: 44100,
    frames,
  };
  pcm.set(id, decodePhrase(bytes, frames));
  console.log(`Rendered ${id}: ${frames} frames, peak ${peak.toFixed(4)}`);
}
validateManifest(manifest);
const evidence: Record<string, unknown> = {};
for (const route of ["pp", "pm", "mp", "mm"] as RouteKey[]) {
  let session = newSession(manifest);
  session = choose(session, 0, route[0] === "p" ? "piano" : "marimba", 0);
  session = choose(session, 1, route[1] === "p" ? "piano" : "marimba", 0);
  const audio = assemble(session, pcm);
  const peak = measure(audio);
  if (peak <= 0 || peak > 0.95)
    throw new Error(`Unsafe route ${route}: ${peak}`);
  evidence[route] = {
    frames: audio.left.length,
    durationSeconds: audio.left.length / 44100,
    peak,
  };
}
for (const path of new Set(assets.map((a) => a.license.path))) {
  const target = resolve(out, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, await readFile(resolve(root, path)));
}
await writeFile(
  resolve(out, "sound-notices.json"),
  JSON.stringify(
    {
      assets: assets.map((a) => ({
        id: a.id,
        sha256: a.sha256,
        source: a.source,
        license: a.license,
      })),
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  resolve(out, "render-evidence.json"),
  JSON.stringify(evidence, null, 2) + "\n",
);
// Publish the complete manifest last: failed preparation never announces partial audio.
await writeFile(
  resolve(out, "manifest.next.json"),
  JSON.stringify(manifest) + "\n",
);
await rename(resolve(out, "manifest.next.json"), resolve(out, "manifest.json"));
// Retire only this generator's obsolete phrase projections after publication.
const currentFiles = new Set(Object.values(manifest.audio).map((a) => a.file));
for (const file of await readdir(out)) {
  if (
    /^step[1-8]-(pp|pm|mp|mm)(-[a-f0-9]{16})?\.wav$/.test(file) &&
    !currentFiles.has(file)
  ) {
    await rm(resolve(out, file));
  }
}
console.log(JSON.stringify(evidence, null, 2));
function measure(p: PhrasePcm): number {
  let peak = 0;
  for (let i = 0; i < p.left.length; i++) {
    if (!Number.isFinite(p.left[i]) || !Number.isFinite(p.right[i]))
      throw new Error("Non-finite PCM.");
    peak = Math.max(peak, Math.abs(p.left[i]!), Math.abs(p.right[i]!));
  }
  return peak;
}
