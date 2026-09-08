import { performance } from "node:perf_hooks";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stringifyAir } from "@refrain/air-schema";
import {
  ExecutionTransportController,
  createExecutionBundle,
  createPreparationPlan,
  type ExecutionAssetBundle,
  type ExecutionBundle,
} from "@refrain/audio-engine";
import { compileAir } from "@refrain/compiler";
import { hum } from "@refrain/mcp-server/hum";
import {
  artifactBytesOf,
  buildStructureDetailWindow,
  buildStructureViewModel,
  createInlinePresentationRef,
  createRefrainArtifact,
} from "@refrain/renderer";
import {
  COMPLETE_PIECE_PERFORMANCE_BINDING,
  COMPLETE_PIECE_VCSL_PERFORMANCE_BINDING,
  type PerformanceBinding,
} from "@refrain/soundpack";
import { streamExecutionWav } from "../apps/presentation/src/stream-wav.js";

const outputArgument = process.argv
  .find((argument) => argument.startsWith("--out="))
  ?.slice("--out=".length);
const outputPath = resolve(
  outputArgument ?? "tmp/tranche-d-evidence/report.json",
);
const renderReference = process.argv.includes("--render-reference");
const renderAll = process.argv.includes("--render-all");
const encoder = new TextEncoder();

function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

function measured<T>(operation: () => T): {
  value: T;
  elapsedMs: number;
  heapDeltaBytes: number;
  rssDeltaBytes: number;
} {
  const before = process.memoryUsage();
  const started = performance.now();
  const value = operation();
  const after = process.memoryUsage();
  return {
    value,
    elapsedMs: performance.now() - started,
    heapDeltaBytes: after.heapUsed - before.heapUsed,
    rssDeltaBytes: after.rss - before.rss,
  };
}

function transportEvidence(bundle: ExecutionBundle) {
  const controller = new ExecutionTransportController(bundle);
  const commands = [
    { type: "prepare" as const, targetFrame: bundle.index.sampleRate * 19 },
    { type: "play" as const },
    { type: "pause" as const },
    { type: "resume" as const },
    { type: "seek" as const, targetFrame: bundle.index.sampleRate * 97 },
    ...(bundle.index.sections[1]
      ? [
          {
            type: "jump" as const,
            sectionId: bundle.index.sections[1].id,
          },
        ]
      : []),
    { type: "restart" as const },
    { type: "stop" as const },
  ];
  return commands.map((command) => {
    const started = performance.now();
    const snapshot = controller.command(command);
    return {
      command: command.type,
      elapsedMs: performance.now() - started,
      status: snapshot.status,
      positionFrame: snapshot.positionFrame,
      activeVoiceCount: snapshot.activeVoices.length,
      generation: snapshot.generation,
      performancePlanSha256: snapshot.performancePlanSha256,
    };
  });
}

async function renderAssets(
  bundle: ExecutionBundle,
): Promise<ExecutionAssetBundle> {
  const paths = new Map(
    bundle.runtimeAssets.map((asset) => [asset.assetId, asset.localPath]),
  );
  const assets: {
    soundfont?: ArrayBuffer;
    samples: Record<string, ArrayBuffer>;
  } = { samples: {} };
  for (const requirement of bundle.plan.assetRequirements) {
    const localPath = paths.get(requirement.assetId);
    if (!localPath)
      throw new Error(`No runtime path exists for ${requirement.assetId}.`);
    const bytes = await readFile(resolve("apps/soundbench/public", localPath));
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    if (requirement.kind === "soundfont") assets.soundfont = buffer;
    else assets.samples[requirement.assetId] = buffer;
  }
  return assets;
}

async function measureFixture(
  name: "relational-reference" | "upper-envelope",
  fixturePath: string,
  binding: PerformanceBinding,
  render: boolean,
) {
  const sourceText = await readFile(fixturePath, "utf8");
  const humResult = measured(() =>
    hum({ air: sourceText, performance: { bindingId: binding.id } }),
  );
  if (!humResult.value.ok)
    throw new Error(
      humResult.value.diagnostics
        .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
        .join("\n"),
    );
  const result = humResult.value;
  const compilation = measured(() => compileAir(result.source));
  if (!compilation.value.compiled)
    throw new Error(`${name} did not compile after canonicalization.`);
  const compiled = compilation.value.compiled;
  const execution = measured(() =>
    createExecutionBundle(compiled, {
      sourceRevision: result.receipt.sourceRevision,
      performanceBinding: binding,
    }),
  );
  const bundle = execution.value;
  const preparation = createPreparationPlan(bundle);
  const structure = measured(() =>
    buildStructureViewModel(result.source, compiled, result.receipt),
  );
  const detail = buildStructureDetailWindow(
    compiled,
    compiled.durationBeats / 2,
    Math.min(
      compiled.durationBeats,
      compiled.durationBeats / 2 + compiled.beatsPerBar * 4,
    ),
  );
  const artifact = createRefrainArtifact({
    source: result.source,
    receipt: result.receipt,
    performanceBinding: binding,
  });
  const artifactDelivery = artifactBytesOf(artifact);
  const inline = createInlinePresentationRef(artifact);
  const planText = JSON.stringify(bundle.plan);
  if (
    planText.includes('"compiled"') ||
    planText.includes('"events"') ||
    planText.includes('"localPath"')
  )
    throw new Error(`${name} @3 plan leaked a retired or runtime-only field.`);
  const densityDomNodes = result.source.voices.reduce(
    (total, voice) =>
      total +
      structure.value.visualFacts.densityBins.filter((bin) =>
        bin.voices.some((item) => item.voiceId === voice.id),
      ).length,
    0,
  );
  let offlineRender:
    | {
        elapsedMs: number;
        heapDeltaBytes: number;
        rssDeltaBytes: number;
        outputPath: string;
        outputBytes: number;
        outputSha256: string;
        sourcePeak: number;
        amplitudeScale: number;
        blockFrames: number;
        peakWorkingBytes: number;
      }
    | undefined;
  if (render) {
    const assets = await renderAssets(bundle);
    const wavPath = resolve(dirname(outputPath), `${name}.native.wav`);
    const before = process.memoryUsage();
    const started = performance.now();
    const stream = await streamExecutionWav(bundle, assets, wavPath);
    const after = process.memoryUsage();
    offlineRender = {
      elapsedMs: performance.now() - started,
      heapDeltaBytes: after.heapUsed - before.heapUsed,
      rssDeltaBytes: after.rss - before.rss,
      outputPath: wavPath,
      ...stream,
    };
  }
  return {
    name,
    fixturePath,
    bindingId: binding.id,
    source: {
      inputBytes: encoder.encode(sourceText).byteLength,
      canonicalBytes: encoder.encode(stringifyAir(result.source)).byteLength,
      voiceCount: result.source.voices.length,
      sectionCount: result.source.sections?.length ?? 0,
    },
    compiled: {
      format: compiled.format,
      jsonBytes: jsonBytes(compiled),
      eventCount: compiled.events.length,
      activeVoiceCount: new Set(compiled.events.map((event) => event.voiceId))
        .size,
      motifOccurrenceCount: compiled.motifOccurrences.length,
      durationBeats: compiled.durationBeats,
      durationSeconds: compiled.durationSeconds,
      compileMs: compilation.elapsedMs,
      heapDeltaBytes: compilation.heapDeltaBytes,
      rssDeltaBytes: compilation.rssDeltaBytes,
    },
    modelAndDelivery: {
      humMs: humResult.elapsedMs,
      humPayloadBytes: jsonBytes(result),
      expandedEventsModelVisible: false,
      legacyInlineUrlChars: result.presentation?.url.length,
      legacyInlineDiagnosticCodes: result.diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
      artifactBytes: artifactDelivery.bytes.byteLength,
      artifactSha256: artifactDelivery.artifactSha256,
      exactInlineDelivery: inline.ok
        ? {
            outcome: "inline" as const,
            fragmentChars: inline.ref.delivery.fragment.length,
          }
        : {
            outcome: inline.reason,
            fragmentChars: inline.fragmentChars,
            maximumFragmentChars: inline.maximumFragmentChars,
          },
      sessionFileAndMcpUseExactArtifactBytes: true,
    },
    execution: {
      bundleFormat: bundle.format,
      planFormat: bundle.plan.format,
      planSha256: bundle.planSha256,
      planJsonBytes: encoder.encode(planText).byteLength,
      planBuildMs: execution.elapsedMs,
      planHeapDeltaBytes: execution.heapDeltaBytes,
      planRssDeltaBytes: execution.rssDeltaBytes,
      indexBytes: bundle.index.byteLength,
      checkpointCount: bundle.index.checkpoints.length,
      assetCount: bundle.plan.assetRequirements.length,
      assetBytes: bundle.plan.assetRequirements.reduce(
        (total, asset) => total + asset.bytes,
        0,
      ),
      openingAssetCount: preparation.openingClosure.length,
      openingAssetBytes: bundle.plan.assetRequirements
        .filter((asset) => preparation.openingClosure.includes(asset.assetId))
        .reduce((total, asset) => total + asset.bytes, 0),
      deferredAssets: bundle.plan.assetRequirements
        .filter((asset) => !preparation.openingClosure.includes(asset.assetId))
        .map((asset) => ({
          assetId: asset.assetId,
          firstUseSeconds: asset.firstUseSeconds,
          deadlineSeconds:
            preparation.assets.find((item) => item.assetId === asset.assetId)
              ?.deadlineSeconds ?? 0,
        })),
      transport: transportEvidence(bundle),
    },
    view: {
      format: structure.value.format,
      buildMs: structure.elapsedMs,
      heapDeltaBytes: structure.heapDeltaBytes,
      rssDeltaBytes: structure.rssDeltaBytes,
      jsonBytes: jsonBytes(structure.value),
      wholeFormBins: structure.value.visualFacts.densityBins.length,
      densityDomNodes,
      renderedEventNodes: 0,
      detailEventCount: detail.events.length,
      detailTotalEventCount: detail.totalEventCount,
      detailTruncated: detail.truncated,
    },
    ...(offlineRender === undefined ? {} : { offlineRender }),
  };
}

const fixtures = [
  await measureFixture(
    "relational-reference",
    "fixtures/complete-piece/relational-complete.air.json",
    COMPLETE_PIECE_VCSL_PERFORMANCE_BINDING,
    renderReference || renderAll,
  ),
  await measureFixture(
    "upper-envelope",
    "fixtures/complete-piece/upper-envelope.air.json",
    COMPLETE_PIECE_PERFORMANCE_BINDING,
    renderAll,
  ),
];

const reference = fixtures[0]!;
const stress = fixtures[1]!;
if (
  reference.compiled.durationSeconds < 240 ||
  reference.compiled.durationSeconds > 300
)
  throw new Error("The relational reference must remain four to five minutes.");
if (
  stress.compiled.durationSeconds !== 480 ||
  stress.compiled.activeVoiceCount < 12 ||
  stress.compiled.eventCount < 20_000
)
  throw new Error("The upper-envelope fixture no longer proves 8m/12v/20k.");
if (stress.view.renderedEventNodes !== 0 || stress.view.wholeFormBins > 192)
  throw new Error(
    "The upper-envelope view regressed to event-shaped rendering.",
  );
if (reference.execution.deferredAssets.length === 0)
  throw new Error("The relational reference no longer proves deferred assets.");

const report = {
  format: "refrain-tranche-d-evidence@0-experimental",
  generatedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  fixtures,
  supportClaim: {
    durationSeconds: { min: 5, max: 480 },
    activeVoices: 12,
    compiledEvents: 20_000,
    status: "node-measured-browser-acceptance-separate",
  },
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${outputPath}\n`);
