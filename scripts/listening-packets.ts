import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AirSource } from "@refrain/air-schema";
import {
  createAssetClosure,
  createPerformancePlan,
  createRenderReceipt,
  AUDITION_PEAK_MATCH_CONTRACT,
  encodePcmWav,
  renderPcm,
  type PerformancePlan,
  type RenderAssetBundle,
} from "@refrain/audio-engine";
import { compileAir } from "@refrain/compiler";
import { sourceRevisionOf } from "@refrain/mcp-server/hum";
import {
  DEFAULT_RENDER_SCENE,
  G3A_AUDITION_SOUND_PROFILE,
  LISTENING_DECISIONS,
  SOUND_REGISTRY,
  candidateById,
  createPerformanceBinding,
  soundAssetById,
  soundProfileWithCandidates,
  type SoundProfile,
} from "@refrain/soundpack";

const outputArgument = process.argv.find((item) => item.startsWith("--out="));
const outputRoot = resolve(
  outputArgument?.slice("--out=".length) ?? "tmp/g3b-listening-packets",
);
const publicRoot = resolve("apps/soundbench/public");

const fixtures: Array<{
  instrumentId:
    "warm_piano" | "harp" | "marimba" | "soft_percussion" | "chamber_strings";
  candidateId: string;
  sourcePath: string;
}> = [
  {
    instrumentId: "warm_piano",
    candidateId: "warm-piano-vcsl-kawai-c4",
    sourcePath: "fixtures/listening-candidates/warm-piano-reference.air.json",
  },
  {
    instrumentId: "harp",
    candidateId: "harp-vcsl-concert-a4",
    sourcePath: "fixtures/listening-candidates/harp-reference.air.json",
  },
  {
    instrumentId: "marimba",
    candidateId: "marimba-vcsl-c4",
    sourcePath: "fixtures/listening-candidates/marimba-reference.air.json",
  },
  {
    instrumentId: "soft_percussion",
    candidateId: "soft-percussion-vcsl-acoustic-kit",
    sourcePath:
      "fixtures/listening-candidates/soft-percussion-reference.air.json",
  },
  {
    instrumentId: "chamber_strings",
    candidateId: "chamber-strings-vsco-loop-probe",
    sourcePath:
      "fixtures/listening-candidates/chamber-strings-loop-reference.air.json",
  },
];

function sha256(bytes: ArrayBuffer | Uint8Array): string {
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

function measure(pcm: NonNullable<Awaited<ReturnType<typeof renderPcm>>>) {
  let peak = 0;
  let firstSample: number | undefined;
  for (let index = 0; index < pcm.left.length; index += 1) {
    const level = Math.max(
      Math.abs(pcm.left[index] ?? 0),
      Math.abs(pcm.right[index] ?? 0),
    );
    peak = Math.max(peak, level);
    if (firstSample === undefined && level > 0.00001) firstSample = index;
  }
  return {
    peak,
    firstSoundSeconds:
      firstSample === undefined ? null : firstSample / pcm.sampleRate,
  };
}

async function timedRead(path: string) {
  const started = performance.now();
  const bytes = await readFile(path);
  return {
    bytes: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
    loadMs: performance.now() - started,
  };
}

async function loadPlanAssets(plan: PerformancePlan) {
  const bundle: RenderAssetBundle = {
    samples: {},
  };
  let loadMs = 0;
  let bytesLoaded = 0;
  for (const required of plan.requiredAssets) {
    const loaded = await timedRead(resolve(publicRoot, required.localPath));
    loadMs += loaded.loadMs;
    bytesLoaded += loaded.bytes.byteLength;
    if (required.kind === "soundfont") bundle.soundfont = loaded.bytes;
    else
      (bundle.samples as Record<string, ArrayBuffer>)[required.assetId] =
        loaded.bytes;
  }
  return { bundle, loadMs, bytesLoaded };
}

async function renderTwice(source: AirSource, soundProfile: SoundProfile) {
  const compiled = compileAir(source).compiled;
  if (!compiled) throw new Error(`${source.title} did not compile.`);
  const performanceBinding = createPerformanceBinding({
    id: `listening-${soundProfile.id}`,
    soundProfile,
    renderScene: DEFAULT_RENDER_SCENE,
  });
  const plan = createPerformancePlan(compiled, { performanceBinding });
  const loaded = await loadPlanAssets(plan);
  const coldStart = performance.now();
  const cold = await renderPcm(compiled, loaded.bundle, 44_100, { plan });
  const coldRenderMs = performance.now() - coldStart;
  const warmStart = performance.now();
  const warm = await renderPcm(compiled, loaded.bundle, 44_100, { plan });
  const warmRenderMs = performance.now() - warmStart;
  if (!cold || !warm) throw new Error(`${source.title} render was cancelled.`);
  const audio = measure(cold);
  const outputAmplitude = {
    mode: "audition-peak-matched",
    targetPeak: 1,
    contract: AUDITION_PEAK_MATCH_CONTRACT,
  } as const;
  const wav = encodePcmWav(cold, { amplitude: outputAmplitude });
  return {
    compiled,
    plan,
    pcm: cold,
    wav,
    outputAmplitude,
    wavSha256: sha256(wav),
    metrics: {
      assetLoadMs: loaded.loadMs,
      coldRenderMs,
      warmRenderMs,
      coldFirstSoundMs:
        loaded.loadMs + coldRenderMs + (audio.firstSoundSeconds ?? 0) * 1000,
      warmFirstSoundMs: warmRenderMs + (audio.firstSoundSeconds ?? 0) * 1000,
      assetBytesLoaded: loaded.bytesLoaded,
      ...audio,
    },
  };
}

await mkdir(outputRoot, { recursive: true });

for (const fixture of fixtures) {
  const source = JSON.parse(
    await readFile(resolve(fixture.sourcePath), "utf8"),
  ) as AirSource;
  const candidate = candidateById.get(fixture.candidateId);
  if (!candidate || candidate.instrumentId !== fixture.instrumentId)
    throw new Error(`Unknown candidate ${fixture.candidateId}.`);
  const candidateProfile = soundProfileWithCandidates(
    G3A_AUDITION_SOUND_PROFILE,
    { [fixture.instrumentId]: fixture.candidateId },
    `g3b-listening-${fixture.instrumentId}@0`,
  );
  const fallbackRender = await renderTwice(source, G3A_AUDITION_SOUND_PROFILE);
  const candidateRender = await renderTwice(source, candidateProfile);
  const stem = fixture.instrumentId.replaceAll("_", "-");
  await Promise.all([
    writeFile(
      resolve(outputRoot, `${stem}-fallback.wav`),
      new Uint8Array(fallbackRender.wav),
    ),
    writeFile(
      resolve(outputRoot, `${stem}-candidate.wav`),
      new Uint8Array(candidateRender.wav),
    ),
  ]);
  const decision = LISTENING_DECISIONS.find(
    (item) => item.candidateId === fixture.candidateId,
  );
  const exactAcceptedAudio = Boolean(
    decision &&
    decision.decision === "accepted" &&
    decision.candidateAudioSha256 === candidateRender.wavSha256 &&
    decision.fallbackAudioSha256 === fallbackRender.wavSha256,
  );
  const fallbackCandidateId = fallbackRender.plan.voices.find(
    (voice) => voice.instrument === fixture.instrumentId,
  )?.candidateId;
  const fallbackCandidate = fallbackCandidateId
    ? candidateById.get(fallbackCandidateId)
    : undefined;
  const sourceRevision = sourceRevisionOf(source);
  const packet = {
    format: "refrain-listening-packet@2-experimental",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      measurement:
        "local filesystem plus offline 44.1 kHz render; not a network promise",
    },
    source,
    sourceRevision,
    comparison: {
      fallback: {
        performanceBinding: fallbackRender.plan.performanceBinding,
        soundProfile: fallbackRender.plan.soundProfile,
        renderScene: fallbackRender.plan.renderScene,
        candidates: fallbackRender.plan.voices.map((voice) => ({
          instrumentId: voice.instrument,
          candidateId: voice.candidateId,
          fallbackUsed: voice.fallbackUsed,
        })),
        assetClosure: createAssetClosure(fallbackRender.plan),
        metrics: fallbackRender.metrics,
        audio: `${stem}-fallback.wav`,
        audioSha256: fallbackRender.wavSha256,
        renderReceipt: createRenderReceipt(fallbackRender.plan, {
          sourceRevision,
          adapter: "wav",
          sampleRate: 44_100,
          outputSha256: `sha256:${fallbackRender.wavSha256}`,
          verifiedAssets: fallbackRender.pcm.verifiedAssets,
          outputAmplitude: fallbackRender.outputAmplitude,
        }),
      },
      candidate: {
        performanceBinding: candidateRender.plan.performanceBinding,
        soundProfile: candidateRender.plan.soundProfile,
        renderScene: candidateRender.plan.renderScene,
        candidates: candidateRender.plan.voices.map((voice) => ({
          instrumentId: voice.instrument,
          candidateId: voice.candidateId,
          fallbackUsed: voice.fallbackUsed,
        })),
        assetClosure: createAssetClosure(candidateRender.plan),
        metrics: candidateRender.metrics,
        audio: `${stem}-candidate.wav`,
        audioSha256: candidateRender.wavSha256,
        renderReceipt: createRenderReceipt(candidateRender.plan, {
          sourceRevision,
          adapter: "wav",
          sampleRate: 44_100,
          outputSha256: `sha256:${candidateRender.wavSha256}`,
          verifiedAssets: candidateRender.pcm.verifiedAssets,
          outputAmplitude: candidateRender.outputAmplitude,
        }),
      },
    },
    lazyLoadEvidence: {
      candidateSoundfontBytesLoaded: candidateRender.plan.requiredAssets
        .filter((asset) => asset.kind === "soundfont")
        .reduce((total, asset) => total + asset.bytes, 0),
      candidateRequiredAssets: candidateRender.plan.requiredAssets.map(
        (asset) => asset.assetId,
      ),
    },
    soundpack: {
      id: SOUND_REGISTRY.id,
      sha256: SOUND_REGISTRY.contentSha256,
      status: SOUND_REGISTRY.status,
    },
    mechanicalAcceptance: "rendered-and-measured",
    listeningAcceptance: exactAcceptedAudio
      ? "accepted-for-exact-audio-digests"
      : "pending-faye",
    ...(decision === undefined
      ? {}
      : {
          priorListeningDecision: {
            ...decision,
            exactAudioDigestsReproduced: exactAcceptedAudio,
          },
        }),
    reference: {
      fallbackCandidate: fallbackCandidate?.id,
      candidate: candidate.id,
    },
  };
  await writeFile(
    resolve(outputRoot, `${stem}.listening.json`),
    `${JSON.stringify(packet, null, 2)}\n`,
  );
  process.stdout.write(
    `${fixture.instrumentId}: fallback ${fallbackRender.metrics.assetBytesLoaded} B, candidate ${candidateRender.metrics.assetBytesLoaded} B, listening ${packet.listeningAcceptance}\n`,
  );
}
