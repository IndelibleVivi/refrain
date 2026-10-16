import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileAirV1 } from "@refrain/compiler/v1";
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
import { F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING as binding } from "@refrain/soundpack";
import {
  resolveSoundpackClosure,
  SHARD_CANDIDATE_PROVIDER,
} from "@refrain/soundpack/factory";
import { createRootReceiptV1 } from "@refrain/renderer/v1";
import { resolveSoundContentStoreRoot } from "./sound-content-store-root.js";
import {
  createScore,
  stemSource,
  buildArtifact,
} from "../apps/nocturne-desk/src/score.js";
import {
  VOICE_IDS,
  type Manifest,
  type Preset,
} from "../apps/nocturne-desk/src/contracts.js";
import {
  applyArrangement,
  newSession,
  stemKey,
  validateManifest,
} from "../apps/nocturne-desk/src/model.js";
import {
  assemble,
  decodePhrase,
  encodeWav,
  type PhrasePcm,
} from "../apps/nocturne-desk/src/wav.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  out = resolve(root, "apps/nocturne-desk/.audio");
await mkdir(out, { recursive: true });
const score = createScore();
// Reuse verified stems; always rebuild derived mixes, native artifacts and notices.
let reused: Manifest | undefined;
const pcm = new Map<string, PhrasePcm>();
try {
  const previous = validateManifest(
    JSON.parse(await readFile(resolve(out, "manifest.json"), "utf8")),
  );
  for (const [id, a] of Object.entries(previous.audio)) {
    const bytes = new Uint8Array(await readFile(resolve(out, a.file)));
    await verifyAssetBytes(
      { assetId: id, bytes: a.bytes, sha256: a.sha256 },
      bytes.buffer,
    );
    pcm.set(id, decodePhrase(bytes.buffer, a.frames));
  }
  reused = previous;
  console.log("Reused 24 verified exact-work stems.");
} catch {
  pcm.clear();
}
const bundles = score.sections.flatMap((_, s) =>
  VOICE_IDS.map((v) => {
    const source = stemSource(s, v),
      c = compileAirV1(source);
    if (!c.compiled) throw new Error(JSON.stringify(c.diagnostics));
    return {
      key: stemKey(s, v),
      bundle: createExecutionBundle(c.compiled, {
        sourceRevision: createRootReceiptV1(source).sourceRevision,
        performanceBinding: binding,
      }),
    };
  }),
);
const registry = resolveSoundpackClosure(
    binding.soundProfile,
    SHARD_CANDIDATE_PROVIDER,
  ),
  needed = new Set(
    bundles.flatMap((b) =>
      b.bundle.plan.assetRequirements.map((a) => a.assetId),
    ),
  ),
  assets = registry.assets.filter((a) => needed.has(a.id));
if (assets.length !== needed.size) throw new Error("Incomplete sound closure.");
const store = new FileContentAddressedStore({
  root: resolveSoundContentStoreRoot(),
  allowedOrigins: [
    "https://raw.githubusercontent.com",
    "https://freepats.zenvoid.org",
  ],
  maxAssetBytes: 512 * 1024 * 1024,
});
const samples: Record<string, ArrayBuffer> = {};
if (!reused) {
  const publicRoot = resolve(root, "apps/soundbench/public");
  for (const a of assets)
    await store.adopt(a, resolve(publicRoot, a.localPath));
  console.log(`Preparing ${assets.length} exact source assets for 24 stems.`);
  const acquired = await ensureAssetClosure(assets, store, {
    maxAssets: 128,
    maxBytes: 512 * 1024 * 1024,
    maxConcurrentFetches: 4,
    onProgress: (p) =>
      console.log(
        `Verified ${p.completedAssets}/${p.totalAssets}: ${p.acquired.assetId} (${p.acquired.cache})`,
      ),
  });
  for (const [i, a] of assets.entries()) {
    const bytes = new Uint8Array(await readFile(acquired[i]!.contentPath));
    await verifyAssetBytes(
      { assetId: a.id, bytes: a.bytes, sha256: a.sha256 },
      bytes.buffer,
    );
    samples[a.id] = bytes.buffer;
  }
}
const manifest: Manifest = reused ?? {
  format: "nocturne-desk-manifest@0",
  score,
  audio: {},
  mixGain: 0.85,
};
for (const { key, bundle } of reused ? [] : bundles) {
  const frames = Math.ceil(bundle.plan.renderDurationSeconds * 44100),
    left = new Float32Array(frames),
    right = new Float32Array(frames);
  for await (const block of renderExecutionBlocks(bundle, { samples }, 44100)) {
    left.set(block.left, block.frameOffset);
    right.set(block.right, block.frameOffset);
  }
  const peak = measure({ left, right });
  if (peak <= 0 || peak > 0.95)
    throw new Error(`Stem ${key} has invalid peak ${peak}`);
  const bytes = encodePcmWav(
      { left, right, sampleRate: 44100, durationSeconds: frames / 44100 },
      { amplitude: { mode: "native-gain" } },
    ),
    sha256 = await sha256Bytes(bytes),
    file = `${key.replace(":", "-")}-${sha256.slice(0, 16)}.wav`;
  await writeFile(resolve(out, file), new Uint8Array(bytes));
  manifest.audio[key] = { file, bytes: bytes.byteLength, sha256, frames };
  pcm.set(key, decodePhrase(bytes, frames));
  console.log(
    `Rendered ${key}: ${(frames / 44100).toFixed(3)}s peak ${peak.toFixed(4)}`,
  );
}
validateManifest(manifest);
const evidence: Record<string, unknown> = {};
for (const preset of ["manuscript", "solitude", "constellation"] as Preset[]) {
  const session = applyArrangement(newSession(), preset),
    audio = assemble(manifest, session, pcm),
    peak = measure(audio);
  if (peak > 0.95 || peak <= 0) throw new Error("Unsafe mix.");
  evidence[preset] = {
    frames: audio.left.length,
    durationSeconds: audio.left.length / 44100,
    peak,
  };
  await writeFile(
    resolve(out, `${preset}.refrain.json`),
    JSON.stringify(buildArtifact(session), null, 2) + "\n",
  );
  await writeFile(resolve(out, `${preset}.wav`), encodeWav(audio));
}
// Absolute per-frame sum bounds every possible subset, including overlaps across sections.
const all = {
  ...newSession(),
  arrangement: Array.from({ length: 6 }, () => [true, true, true, true]),
};
const boundFrames = assemble(manifest, all, pcm).left.length;
const bounds = [new Float32Array(boundFrames), new Float32Array(boundFrames)];
for (const [key, p] of pcm) {
  const start = Math.round(
    ((Number(key.split(":")[0]) * 16 * 60) / 88) * 44100,
  );
  [p.left, p.right].forEach((c, ch) => {
    for (let i = 0; i < c.length; i++)
      bounds[ch]![start + i] += Math.abs(c[i]!) * manifest.mixGain;
  });
}
const peakBound = Math.max(measure({ left: bounds[0]!, right: bounds[1]! }), 0);
if (peakBound > 0.95)
  throw new Error(`Possible subset exceeds safe bound: ${peakBound}`);
evidence.subsetPeakBound = peakBound;
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
await writeFile(
  resolve(out, "manifest.next.json"),
  JSON.stringify(manifest) + "\n",
);
await rename(resolve(out, "manifest.next.json"), resolve(out, "manifest.json"));
console.log(JSON.stringify(evidence, null, 2));
function measure(p: PhrasePcm) {
  let peak = 0;
  for (const c of [p.left, p.right])
    for (const x of c) {
      if (!Number.isFinite(x)) throw new Error("Non-finite PCM.");
      peak = Math.max(peak, Math.abs(x));
    }
  return peak;
}
