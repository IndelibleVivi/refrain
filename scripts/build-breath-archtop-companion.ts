import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { format as formatText } from "prettier";
import type { AirSourceV1 } from "../packages/air-schema/src/v1.js";
import { compileAirV1 } from "../packages/compiler/src/v1.js";
import { renderExecutionBlocks } from "../packages/audio-engine/src/block-renderer.js";
import { createExecutionBundle } from "../packages/audio-engine/src/execution.js";
import {
  AUDITION_PEAK_MATCH_CONTRACT,
  encodePcmWav,
  type PcmAudioData,
} from "../packages/audio-engine/src/pcm.js";
import { createExecutionRenderReceipt } from "../packages/audio-engine/src/receipt.js";
import { createRefrainArtifactV3 } from "../packages/renderer/src/portable.js";
import { createRootReceiptV1 } from "../packages/renderer/src/v1.js";
import {
  SHINYGUITAR_AIR_VOCABULARY,
  SHINYGUITAR_AUTHORING_VOCABULARY,
  shinyguitarAcousticManifest,
} from "../packages/soundpack/src/shinyguitar.js";
import {
  buildShinyguitarAcousticPack,
  loadShinyguitarExpectedAssets,
} from "./build-shinyguitar-candidate.js";
import { sha256 } from "./lib/sound-build.js";

const SOURCE_FIXTURE = "fixtures/air-v1/breath-study.air.json";
const ARCHTOP_FIXTURE = "fixtures/air-v1/breath-study-archtop.air.json";
const ARCHTOP_ARTIFACT =
  "examples/breath-study/a-little-room-between-archtop.refrain.json";
const SAMPLE_RATE = 44_100;

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? fallback : process.argv[index + 1];
  if (!value) throw new Error(`${name} is required.`);
  return resolve(value);
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    await formatText(JSON.stringify(value), { parser: "json" }),
    "utf8",
  );
}

function archtopSource(base: AirSourceV1): AirSourceV1 {
  return {
    ...structuredClone(base),
    title: "A little room between · Archtop",
    vocabulary: structuredClone(SHINYGUITAR_AIR_VOCABULARY),
    voices: base.voices.map((voice) => ({
      ...structuredClone(voice),
      instrument: "archtop_guitar",
    })),
  };
}

async function renderBlocks(
  bundle: ReturnType<typeof createExecutionBundle>,
  samples: Record<string, ArrayBuffer>,
): Promise<PcmAudioData> {
  const frameCount = Math.ceil(bundle.plan.renderDurationSeconds * SAMPLE_RATE);
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  for await (const block of renderExecutionBlocks(
    bundle,
    { samples },
    SAMPLE_RATE,
  )) {
    left.set(block.left, block.frameOffset);
    right.set(block.right, block.frameOffset);
  }
  return {
    left,
    right,
    sampleRate: SAMPLE_RATE,
    durationSeconds: bundle.plan.renderDurationSeconds,
  };
}

function measure(pcm: PcmAudioData): {
  peak: number;
  firstSoundSeconds: number | null;
} {
  let peak = 0;
  let firstSoundFrame: number | undefined;
  for (let index = 0; index < pcm.left.length; index += 1) {
    const level = Math.max(
      Math.abs(pcm.left[index] ?? 0),
      Math.abs(pcm.right[index] ?? 0),
    );
    peak = Math.max(peak, level);
    if (firstSoundFrame === undefined && level > 0.00001)
      firstSoundFrame = index;
  }
  return {
    peak,
    firstSoundSeconds:
      firstSoundFrame === undefined ? null : firstSoundFrame / pcm.sampleRate,
  };
}

async function main(): Promise<void> {
  const sourceRoot = argument("--source-root");
  const outputRoot = argument("--out", "tmp/breath-shinyguitar");
  const base = JSON.parse(
    await readFile(resolve(SOURCE_FIXTURE), "utf8"),
  ) as AirSourceV1;
  const source = archtopSource(base);
  const compilation = compileAirV1(source);
  if (!compilation.compiled)
    throw new Error(
      `Archtop AIR did not compile: ${compilation.diagnostics
        .map((item) => item.message)
        .join("; ")}`,
    );

  const expectedAssets = await loadShinyguitarExpectedAssets(process.cwd());
  const built = await buildShinyguitarAcousticPack(sourceRoot, expectedAssets);
  const manifest = shinyguitarAcousticManifest(built.pack);
  const receipt = createRootReceiptV1(source);
  const bundle = createExecutionBundle(compilation.compiled, {
    sourceRevision: receipt.sourceRevision,
    performanceBinding: built.pack.binding,
    soundRegistry: manifest,
    instrumentVocabulary: SHINYGUITAR_AUTHORING_VOCABULARY,
  });
  const assetById = new Map(
    built.pack.candidateShard.assets.map((asset) => [asset.id, asset]),
  );
  const samples: Record<string, ArrayBuffer> = {};
  for (const required of bundle.plan.assetRequirements) {
    const asset = assetById.get(required.assetId);
    if (!asset || asset.kind !== "wav" || !asset.source.path)
      throw new Error(`Missing source path for ${required.assetId}.`);
    const bytes = await readFile(resolve(sourceRoot, asset.source.path));
    samples[required.assetId] = exactArrayBuffer(bytes);
  }

  const pcm = await renderBlocks(bundle, samples);
  const nativeAmplitude = { mode: "native-gain" as const };
  const matchedAmplitude = {
    mode: "audition-peak-matched" as const,
    targetPeak: 0.85,
    contract: AUDITION_PEAK_MATCH_CONTRACT,
  };
  const nativeWav = encodePcmWav(pcm, { amplitude: nativeAmplitude });
  const matchedWav = encodePcmWav(pcm, { amplitude: matchedAmplitude });
  const nativeSha256 = sha256(new Uint8Array(nativeWav));
  const matchedSha256 = sha256(new Uint8Array(matchedWav));
  const verifiedAssets = bundle.plan.assetRequirements.map((asset) => ({
    assetId: asset.assetId,
    bytes: asset.bytes,
    sha256: asset.sha256,
  }));
  const nativeReceipt = createExecutionRenderReceipt(bundle, {
    sourceRevision: receipt.sourceRevision,
    adapter: "wav",
    sampleRate: SAMPLE_RATE,
    outputSha256: `sha256:${nativeSha256}`,
    verifiedAssets,
    outputAmplitude: nativeAmplitude,
    adaptationNotes: [
      "Rendered by the bounded Node block kernel and encoded as stereo PCM16 WAV.",
    ],
  });
  const matchedReceipt = createExecutionRenderReceipt(bundle, {
    sourceRevision: receipt.sourceRevision,
    adapter: "wav",
    sampleRate: SAMPLE_RATE,
    outputSha256: `sha256:${matchedSha256}`,
    verifiedAssets,
    outputAmplitude: matchedAmplitude,
    adaptationNotes: [
      "Rendered by the bounded Node block kernel, peak-matched only for comparison, and encoded as stereo PCM16 WAV.",
    ],
  });
  const artifact = createRefrainArtifactV3({
    source,
    receipt,
    performanceBindings: [built.pack.binding],
    defaultBindingId: built.pack.binding.id,
    renderReceipts: [nativeReceipt, matchedReceipt],
    projections: [
      {
        format: "refrain-projection-reference@0-experimental",
        kind: "native-wav",
        filename: "a-little-room-between-archtop.native.wav",
        renderReceiptId: nativeReceipt.renderReceiptId,
      },
      {
        format: "refrain-projection-reference@0-experimental",
        kind: "audition-matched-wav",
        filename: "a-little-room-between-archtop.audition-matched.wav",
        renderReceiptId: matchedReceipt.renderReceiptId,
      },
    ],
    caption:
      "The same authored melody as the nylon companion, embodied by the pack-carried Shinyguitar archtop candidate. Listening acceptance remains pending.",
  });

  await mkdir(outputRoot, { recursive: true });
  await Promise.all([
    writeJson(resolve(ARCHTOP_FIXTURE), source),
    writeJson(resolve(ARCHTOP_ARTIFACT), artifact),
    writeFile(
      resolve(outputRoot, "a-little-room-between-archtop.native.wav"),
      new Uint8Array(nativeWav),
    ),
    writeFile(
      resolve(outputRoot, "a-little-room-between-archtop.audition-matched.wav"),
      new Uint8Array(matchedWav),
    ),
    writeJson(resolve(outputRoot, "archtop-listening.json"), {
      format: "refrain-shinyguitar-listening@0-experimental",
      artifact: ARCHTOP_ARTIFACT,
      candidate: built.pack.candidateShard.id,
      candidateSha256: built.pack.candidateShard.candidateContentSha256,
      shardSha256: built.pack.candidateShard.contentSha256,
      requiredAssetCount: bundle.plan.assetRequirements.length,
      requiredAssetBytes: bundle.plan.assetRequirements.reduce(
        (sum, asset) => sum + asset.bytes,
        0,
      ),
      render: {
        sampleRate: SAMPLE_RATE,
        durationSeconds: pcm.durationSeconds,
        ...measure(pcm),
        native: {
          filename: "a-little-room-between-archtop.native.wav",
          sha256: nativeSha256,
          receiptId: nativeReceipt.renderReceiptId,
        },
        auditionMatched: {
          filename: "a-little-room-between-archtop.audition-matched.wav",
          sha256: matchedSha256,
          receiptId: matchedReceipt.renderReceiptId,
        },
      },
      mechanicalAcceptance: "rendered-and-verified",
      listeningAcceptance: "pending-faye",
      publicReleaseAcceptance: false,
    }),
  ]);
  process.stdout.write(
    `Rendered archtop companion: ${bundle.plan.assetRequirements.length} exact assets, ${pcm.durationSeconds.toFixed(3)} seconds, native sha256:${nativeSha256}.\n`,
  );
}

await main();
