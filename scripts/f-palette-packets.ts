import { performance } from "node:perf_hooks";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AirSource } from "@refrain/air-schema";
import {
  AUDITION_PEAK_MATCH_CONTRACT,
  createExecutionAssetClosure,
  createExecutionBundle,
  createExecutionRenderReceipt,
  createPreparationPlan,
  type ExecutionAssetBundle,
  type ExecutionBundle,
} from "@refrain/audio-engine";
import { compileAir, type CompiledAir } from "@refrain/compiler";
import { sourceRevisionOf } from "@refrain/mcp-server/hum";
import {
  F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING,
  F_LOFI_DEGRADED_PERFORMANCE_BINDING,
  F_LUMINOUS_HYBRID_PERFORMANCE_BINDING,
  F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
  INSTRUMENT_VOCABULARY,
  SOUND_REGISTRY,
  candidateById,
  type InstrumentCandidate,
  type PerformanceBinding,
} from "@refrain/soundpack";
import { streamExecutionWav } from "../apps/presentation/src/stream-wav.js";

const outputArgument = process.argv
  .find((argument) => argument.startsWith("--out="))
  ?.slice("--out=".length);
const outputRoot = resolve(outputArgument ?? "tmp/f-palette-packets");
const renderStress = process.argv.includes("--render-stress");
const publicRoot = resolve("apps/soundbench/public");
const encoder = new TextEncoder();

const palettes: Array<{
  slug: string;
  fixturePath: string;
  binding: PerformanceBinding;
  requiredPairs: Array<readonly [string, string]>;
}> = [
  {
    slug: "acoustic-chamber",
    fixturePath: "fixtures/f-palettes/acoustic-chamber-native.air.json",
    binding: F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING,
    requiredPairs: [
      ["solo_cello", "warm_piano"],
      ["solo_cello", "clarinet"],
      ["nylon_guitar", "clean_bass"],
      ["soft_percussion", "warm_piano"],
    ],
  },
  {
    slug: "luminous-hybrid",
    fixturePath: "fixtures/f-palettes/luminous-hybrid-native.air.json",
    binding: F_LUMINOUS_HYBRID_PERFORMANCE_BINDING,
    requiredPairs: [
      ["flute", "harp"],
      ["flute", "air_pad"],
      ["marimba", "lattice_pluck"],
      ["chamber_strings", "glass_bell"],
    ],
  },
  {
    slug: "lofi-degraded",
    fixturePath: "fixtures/f-palettes/lofi-degraded-native.air.json",
    binding: F_LOFI_DEGRADED_PERFORMANCE_BINDING,
    requiredPairs: [
      ["warm_piano", "dust_texture"],
      ["clarinet", "nylon_guitar"],
      ["rhythm_pulse", "warm_piano"],
    ],
  },
  {
    slug: "synthetic-beat",
    fixturePath: "fixtures/f-palettes/synthetic-beat-native.air.json",
    binding: F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
    requiredPairs: [
      ["prism_lead", "lattice_pluck"],
      ["sub_bass", "rhythm_pulse"],
      ["dust_texture", "glass_bell"],
    ],
  },
];

function compile(source: AirSource, name: string): CompiledAir {
  const result = compileAir(source);
  if (!result.compiled)
    throw new Error(
      `${name}: ${result.diagnostics
        .map((item) => `${item.path}: ${item.message}`)
        .join("\n")}`,
    );
  const warnings = result.diagnostics.filter(
    (item) => item.severity === "warning",
  );
  if (warnings.length)
    throw new Error(
      `${name} has unresolved listening warnings: ${warnings
        .map((item) => item.message)
        .join("; ")}`,
    );
  return result.compiled;
}

async function executionAssets(bundle: ExecutionBundle): Promise<{
  assets: ExecutionAssetBundle;
  loadMs: number;
}> {
  const runtimePaths = new Map(
    bundle.runtimeAssets.map((asset) => [asset.assetId, asset.localPath]),
  );
  const assets: {
    soundfont?: ArrayBuffer;
    samples: Record<string, ArrayBuffer>;
  } = { samples: {} };
  const started = performance.now();
  for (const requirement of bundle.plan.assetRequirements) {
    const localPath = runtimePaths.get(requirement.assetId);
    if (!localPath)
      throw new Error(`No runtime path exists for ${requirement.assetId}.`);
    const bytes = await readFile(resolve(publicRoot, localPath));
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    if (requirement.kind === "soundfont") assets.soundfont = buffer;
    else assets.samples[requirement.assetId] = buffer;
  }
  return { assets, loadMs: performance.now() - started };
}

function candidateCoverage(
  candidate: InstrumentCandidate,
  instrumentId: string,
) {
  const vocabulary = INSTRUMENT_VOCABULARY.instruments.find(
    (item) => item.id === instrumentId,
  );
  if (!vocabulary)
    throw new Error(`Missing vocabulary identity ${instrumentId}.`);
  if (candidate.mapping.type !== "sample-map") {
    return {
      instrumentId,
      candidateId: candidate.id,
      engine: candidate.engine,
      vocabularyRange: [vocabulary.midiMin, vocabulary.midiMax],
      supportedNotes: vocabulary.supportedNotes ?? null,
      coverage: "closed-synth-or-program-contract",
    };
  }
  const notes =
    vocabulary.supportedNotes ??
    Array.from(
      { length: vocabulary.midiMax - vocabulary.midiMin + 1 },
      (_item, index) => vocabulary.midiMin + index,
    );
  const attackRegions = candidate.mapping.regions.filter(
    (region) => region.trigger === "attack" && region.articulation === "none",
  );
  const missing: Array<{ midi: number; velocity: number }> = [];
  for (const midi of notes) {
    for (let velocity = 1; velocity <= 127; velocity += 1) {
      if (
        !attackRegions.some(
          (region) =>
            midi >= region.pitch.minMidi &&
            midi <= region.pitch.maxMidi &&
            velocity >= region.velocity.min &&
            velocity <= region.velocity.max,
        )
      )
        missing.push({ midi, velocity });
    }
  }
  if (missing.length)
    throw new Error(
      `${candidate.id} has ${missing.length} pitch/velocity coverage gaps.`,
    );
  return {
    instrumentId,
    candidateId: candidate.id,
    engine: candidate.engine,
    vocabularyRange: [vocabulary.midiMin, vocabulary.midiMax],
    supportedNotes: vocabulary.supportedNotes ?? null,
    sampleMapRange: [
      candidate.mapping.playableMin,
      candidate.mapping.playableMax,
    ],
    regionCount: candidate.mapping.regions.length,
    articulationFallbacks: candidate.mapping.articulationFallbacks,
    exhaustivePitchVelocityPoints: notes.length * 127,
    coverage: "complete",
  };
}

function identityCoverage(binding: PerformanceBinding) {
  const active = INSTRUMENT_VOCABULARY.instruments
    .filter((item) => item.status === "active")
    .sort((left, right) => left.id.localeCompare(right.id));
  const selected = Object.keys(binding.soundProfile.selections).sort();
  if (selected.join("|") !== active.map((item) => item.id).join("|"))
    throw new Error(
      `${binding.id} does not cover the exact active vocabulary.`,
    );
  return active.map((instrument) => {
    const pin =
      binding.soundProfile.selections[instrument.id]?.candidateChain[0];
    const candidate = pin ? candidateById.get(pin.id) : undefined;
    if (
      !pin ||
      !candidate ||
      binding.candidateDigests[candidate.id] !== pin.sha256 ||
      candidate.instrumentId !== instrument.id
    )
      throw new Error(`${binding.id} has a false ${instrument.id} selection.`);
    return candidateCoverage(candidate, instrument.id);
  });
}

function pairingEvidence(
  source: AirSource,
  compiled: CompiledAir,
  requiredPairs: Array<readonly [string, string]>,
) {
  const instrumentByVoice = new Map(
    source.voices.map((voice) => [voice.id, voice.instrument]),
  );
  const eventsByInstrument = new Map<string, CompiledAir["events"]>();
  for (const event of compiled.events) {
    const instrument = instrumentByVoice.get(event.voiceId);
    if (!instrument) continue;
    const present = eventsByInstrument.get(instrument) ?? [];
    present.push(event);
    eventsByInstrument.set(instrument, present);
  }
  return requiredPairs.map(([left, right]) => {
    let overlapCount = 0;
    for (const leftEvent of eventsByInstrument.get(left) ?? []) {
      const leftEnd = leftEvent.startBeat + leftEvent.durationBeats;
      for (const rightEvent of eventsByInstrument.get(right) ?? []) {
        const rightEnd = rightEvent.startBeat + rightEvent.durationBeats;
        if (leftEvent.startBeat < rightEnd && rightEvent.startBeat < leftEnd)
          overlapCount += 1;
      }
    }
    if (overlapCount === 0)
      throw new Error(
        `${left} and ${right} never overlap in the native piece.`,
      );
    return { instruments: [left, right], overlappingEventPairs: overlapCount };
  });
}

function executionMetrics(bundle: ExecutionBundle) {
  const preparation = createPreparationPlan(bundle);
  return {
    planFormat: bundle.plan.format,
    planSha256: bundle.planSha256,
    planJsonBytes: encoder.encode(JSON.stringify(bundle.plan)).byteLength,
    indexBytes: bundle.index.byteLength,
    checkpointCount: bundle.index.checkpoints.length,
    durationSeconds: bundle.plan.renderDurationSeconds,
    eventCount: bundle.plan.compiledIdentity.eventCount,
    voiceCount: bundle.plan.voices.length,
    assetCount: bundle.plan.assetRequirements.length,
    assetBytes: bundle.plan.assetRequirements.reduce(
      (total, asset) => total + asset.bytes,
      0,
    ),
    openingAssetCount: preparation.openingClosure.length,
    openingAssetBytes: bundle.plan.assetRequirements
      .filter((asset) => preparation.openingClosure.includes(asset.assetId))
      .reduce((total, asset) => total + asset.bytes, 0),
  };
}

async function renderBundle(
  bundle: ExecutionBundle,
  outputPath: string,
): Promise<{
  render: Awaited<ReturnType<typeof streamExecutionWav>>;
  assetLoadMs: number;
  renderMs: number;
}> {
  const loaded = await executionAssets(bundle);
  const started = performance.now();
  const render = await streamExecutionWav(bundle, loaded.assets, outputPath, {
    amplitude: { mode: "native-gain" },
  });
  return {
    render,
    assetLoadMs: loaded.loadMs,
    renderMs: performance.now() - started,
  };
}

await mkdir(outputRoot, { recursive: true });
const stressSource = JSON.parse(
  await readFile("fixtures/complete-piece/upper-envelope.air.json", "utf8"),
) as AirSource;
const stressCompiled = compile(stressSource, "upper-envelope");
const stressSourceRevision = sourceRevisionOf(stressSource);

for (const palette of palettes) {
  const source = JSON.parse(
    await readFile(palette.fixturePath, "utf8"),
  ) as AirSource;
  const compiled = compile(source, palette.slug);
  const sourceRevision = sourceRevisionOf(source);
  const planStarted = performance.now();
  const nativeBundle = createExecutionBundle(compiled, {
    sourceRevision,
    performanceBinding: palette.binding,
  });
  const nativePlanMs = performance.now() - planStarted;
  const wavName = `${palette.slug}.native.wav`;
  const rendered = await renderBundle(
    nativeBundle,
    resolve(outputRoot, wavName),
  );
  const matchedWavName = `${palette.slug}.audition-matched.wav`;
  const matchedLoaded = await executionAssets(nativeBundle);
  const matchedStarted = performance.now();
  const matchedRender = await streamExecutionWav(
    nativeBundle,
    matchedLoaded.assets,
    resolve(outputRoot, matchedWavName),
    {
      amplitude: {
        mode: "audition-peak-matched",
        targetPeak: 0.82,
        contract: AUDITION_PEAK_MATCH_CONTRACT,
      },
    },
  );
  const matchedRenderMs = performance.now() - matchedStarted;
  const verifiedAssets = nativeBundle.plan.assetRequirements.map((asset) => ({
    assetId: asset.assetId,
    bytes: asset.bytes,
    sha256: asset.sha256,
  }));
  const renderReceipt = createExecutionRenderReceipt(nativeBundle, {
    sourceRevision,
    adapter: "wav",
    sampleRate: 44_100,
    outputSha256: rendered.render.outputSha256,
    verifiedAssets,
    outputAmplitude: { mode: "native-gain" },
  });
  const matchedRenderReceipt = createExecutionRenderReceipt(nativeBundle, {
    sourceRevision,
    adapter: "wav",
    sampleRate: 44_100,
    outputSha256: matchedRender.outputSha256,
    verifiedAssets,
    outputAmplitude: {
      mode: "audition-peak-matched",
      targetPeak: 0.82,
      contract: AUDITION_PEAK_MATCH_CONTRACT,
    },
  });
  const stressStarted = performance.now();
  const stressBundle = createExecutionBundle(stressCompiled, {
    sourceRevision: stressSourceRevision,
    performanceBinding: palette.binding,
  });
  const stressPlanMs = performance.now() - stressStarted;
  let stressRender:
    | {
        audio: string;
        metrics: Awaited<ReturnType<typeof renderBundle>>;
        receipt: ReturnType<typeof createExecutionRenderReceipt>;
      }
    | undefined;
  if (renderStress) {
    const audio = `${palette.slug}.stress.native.wav`;
    const metrics = await renderBundle(
      stressBundle,
      resolve(outputRoot, audio),
    );
    stressRender = {
      audio,
      metrics,
      receipt: createExecutionRenderReceipt(stressBundle, {
        sourceRevision: stressSourceRevision,
        adapter: "wav",
        sampleRate: 44_100,
        outputSha256: metrics.render.outputSha256,
        verifiedAssets: stressBundle.plan.assetRequirements.map((asset) => ({
          assetId: asset.assetId,
          bytes: asset.bytes,
          sha256: asset.sha256,
        })),
        outputAmplitude: { mode: "native-gain" },
      }),
    };
  }
  const packet = {
    format: "refrain-f-palette-packet@0-experimental",
    generatedAt: new Date().toISOString(),
    palette: palette.binding.soundPalette,
    performanceBinding: palette.binding,
    identityCoverage: identityCoverage(palette.binding),
    nativePiece: {
      source,
      sourceRevision,
      featuredIdentities: [
        ...new Set(source.voices.map((voice) => voice.instrument)),
      ],
      pairingEvidence: pairingEvidence(source, compiled, palette.requiredPairs),
      audio: wavName,
      audioSha256: rendered.render.outputSha256,
      execution: {
        ...executionMetrics(nativeBundle),
        planBuildMs: nativePlanMs,
        assetLoadMs: rendered.assetLoadMs,
        renderMs: rendered.renderMs,
        sourcePeak: rendered.render.sourcePeak,
        amplitudeScale: rendered.render.amplitudeScale,
        peakWorkingBytes: rendered.render.peakWorkingBytes,
      },
      assetClosure: createExecutionAssetClosure(nativeBundle),
      renderReceipt,
      auditionMatchedPreview: {
        audio: matchedWavName,
        audioSha256: matchedRender.outputSha256,
        assetLoadMs: matchedLoaded.loadMs,
        renderMs: matchedRenderMs,
        sourcePeak: matchedRender.sourcePeak,
        amplitudeScale: matchedRender.amplitudeScale,
        renderReceipt: matchedRenderReceipt,
      },
    },
    stressPiece: {
      sourcePath: "fixtures/complete-piece/upper-envelope.air.json",
      sourceRevision: stressSourceRevision,
      execution: {
        ...executionMetrics(stressBundle),
        planBuildMs: stressPlanMs,
      },
      status: stressRender ? "rendered-and-measured" : "exact-plan-verified",
      ...(stressRender ?? {}),
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      soundpack: {
        id: SOUND_REGISTRY.id,
        sha256: SOUND_REGISTRY.contentSha256,
      },
    },
    mechanicalAcceptance: stressRender
      ? "native-and-stress-rendered"
      : "native-rendered-stress-plan-verified",
    listeningAcceptance: "pending-faye",
    publicReleaseAcceptance: false,
  };
  await writeFile(
    resolve(outputRoot, `${palette.slug}.packet.json`),
    `${JSON.stringify(packet, null, 2)}\n`,
  );
  process.stdout.write(
    `${palette.slug}: ${rendered.render.outputSha256}, ${nativeBundle.plan.assetRequirements.length} native assets, ${stressBundle.plan.assetRequirements.length} stress assets, pending-faye\n`,
  );
}
