import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Diagnostic } from "@refrain/air-schema";
import { stringifyAnyAir, type AnyAirSource } from "@refrain/air-schema/any";
import {
  AUDITION_PEAK_MATCH_CONTRACT,
  createAssetClosure,
  createExecutionAssetClosure,
  createExecutionBundle,
  createExecutionRenderReceipt,
  createPerformancePlan,
  createRenderReceipt,
  encodeExecutionMidi,
  encodeMidi,
  encodePcmWav,
  renderPcm,
  type RenderAssetBundle,
  type RenderReceipt,
  type RenderReceiptV2,
  type RenderReceiptV3,
} from "@refrain/audio-engine";
import { compileAnyAir } from "@refrain/compiler/any";
import type { HumSuccess } from "@refrain/mcp-server/hum";
import { humAny } from "@refrain/mcp-server/hum-any";
import type { HumSuccessV1 } from "@refrain/mcp-server/hum-v1";
import {
  createRefrainArtifact,
  createRefrainArtifactV2,
  createRefrainArtifactV3,
  parseRefrainArtifact,
  sourceReceiptIntegrityErrors,
  stringifyRefrainArtifact,
  type AirReceipt,
  type ProjectionReference,
} from "@refrain/renderer";
import {
  sourceReceiptIntegrityErrorsV1,
  type AirReceiptV1,
} from "@refrain/renderer/v1";
import {
  BUILT_IN_PERFORMANCE_BINDINGS,
  COMPLETE_PIECE_PERFORMANCE_PLAN_FORMAT,
  DEFAULT_PERFORMANCE_BINDING,
  SOUND_REGISTRY,
  resolvePerformanceBindingAgainstRuntime,
  type PerformanceBinding,
} from "@refrain/soundpack";
import {
  resolvePerformanceBindingV1AgainstRuntime,
  type PerformanceBindingV1,
} from "@refrain/soundpack/vnext";
import { selectPerformanceBinding } from "./select-performance-binding.js";
import { streamExecutionWav } from "@refrain/audio-engine/node-wav";

const arguments_ = process.argv.slice(2);
const inputPath = arguments_.find((argument) => !argument.startsWith("--"));
const bindingArgument = arguments_
  .find((argument) => argument.startsWith("--binding="))
  ?.slice("--binding=".length);
const includeMatchedPreview = arguments_.includes("--matched-preview");
if (!inputPath) {
  throw new Error(
    "Usage: npm run export:air -- path/to/file.air.json|file.refrain.json [--binding=id] [--matched-preview] [--out=directory]",
  );
}
const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
const outputArgument = arguments_
  .find((argument) => argument.startsWith("--out="))
  ?.slice(6);
const inputName = basename(inputPath).replace(/\.air\.json$|\.json$/i, "");
const outputDirectory = resolve(
  invocationDirectory,
  outputArgument ?? `${inputName}-refrain-export`,
);
await mkdir(dirname(outputDirectory), { recursive: true });
await mkdir(outputDirectory);

const sourceText = await readFile(
  resolve(invocationDirectory, inputPath),
  "utf8",
);
let decodedInput: unknown;
try {
  decodedInput = JSON.parse(sourceText) as unknown;
} catch {
  decodedInput = undefined;
}

let source: AnyAirSource;
let receipt: AirReceipt | AirReceiptV1;
let caption: string | undefined;
let diagnostics: Diagnostic[];
let importedDefault: string | undefined;
type AnyBinding = PerformanceBinding | PerformanceBindingV1;

const runtimeStatus = (binding: AnyBinding) =>
  binding.format === "refrain-performance-binding@1-experimental"
    ? resolvePerformanceBindingV1AgainstRuntime(binding, SOUND_REGISTRY)
    : resolvePerformanceBindingAgainstRuntime(binding);

const isNextBinding = (binding: AnyBinding): binding is PerformanceBindingV1 =>
  binding.format === "refrain-performance-binding@1-experimental";

const performanceStatusForSource = (
  binding: AnyBinding,
  currentSource: AnyAirSource,
) => {
  const status = runtimeStatus(binding);
  if (status.status === "unavailable") return status;
  const missing = [
    ...new Set(currentSource.voices.map((voice) => voice.instrument)),
  ]
    .filter(
      (instrument) => binding.soundProfile.selections[instrument] === undefined,
    )
    .sort();
  return missing.length === 0
    ? status
    : {
        status: "unavailable" as const,
        reason: "instrument-vocabulary-not-installed" as const,
        message: `PerformanceBinding ${binding.id} does not embody: ${missing.join(", ")}.`,
        errors: missing.map(
          (instrument) => `No exact sound selection for ${instrument}.`,
        ),
      };
};

let importedBindings: AnyBinding[] = [];
const parsedArtifact = parseRefrainArtifact(decodedInput);
if (parsedArtifact.ok) {
  const imported = parsedArtifact.artifact;
  const compiledImport = compileAnyAir(imported.source);
  if (!compiledImport.source || !compiledImport.compiled) {
    throw new Error(
      compiledImport.diagnostics
        .map((item) => `${item.path}: ${item.message}`)
        .join("\n"),
    );
  }
  const receiptErrors =
    imported.format === "refrain-artifact@3-experimental"
      ? sourceReceiptIntegrityErrorsV1(imported.source, imported.receipt)
      : sourceReceiptIntegrityErrors(imported.source, imported.receipt);
  if (receiptErrors.length > 0) {
    throw new Error(
      "The imported Refrain artifact receipt does not match its canonical source.",
    );
  }
  source = imported.source;
  receipt = imported.receipt;
  caption = imported.caption;
  diagnostics = compiledImport.diagnostics;
  if (imported.format !== "refrain-artifact@0-experimental")
    importedBindings = imported.performanceBindings;
  importedDefault =
    imported.format === "refrain-artifact@0-experimental"
      ? undefined
      : imported.defaultBindingId;
} else {
  if (
    decodedInput &&
    typeof decodedInput === "object" &&
    !Array.isArray(decodedInput) &&
    typeof (decodedInput as { format?: unknown }).format === "string" &&
    String((decodedInput as { format: string }).format).startsWith(
      "refrain-artifact@",
    )
  ) {
    throw new Error(parsedArtifact.errors.join("\n"));
  }
  const result = humAny({ air: sourceText });
  if (!result.ok) {
    throw new Error(
      result.diagnostics
        .map((item) => `${item.path}: ${item.message}`)
        .join("\n"),
    );
  }
  if (result.source.format === "air@1-experimental") {
    const current = result as HumSuccessV1;
    source = current.source;
    receipt = current.receipt;
    caption = current.caption;
    diagnostics = current.diagnostics;
    importedBindings = current.performanceBinding
      ? [current.performanceBinding]
      : [];
    importedDefault = current.performanceBinding?.id;
  } else {
    const historical = result as HumSuccess;
    source = historical.source;
    receipt = historical.receipt;
    caption = historical.caption;
    diagnostics = historical.diagnostics;
    importedBindings = [historical.performanceBinding];
    importedDefault = historical.performanceBinding.id;
  }
}

if (
  source.format === "air@1-experimental" &&
  bindingArgument === undefined &&
  importedDefault === undefined
)
  throw new Error(
    "Canonical AIR@1 and receipt are valid, but export needs an explicitly selected exact performance binding. Pass --binding=<id> after installing an embodiment that covers this vocabulary.",
  );
const selected = selectPerformanceBinding({
  builtIns: BUILT_IN_PERFORMANCE_BINDINGS,
  imported: importedBindings,
  runtimeDefault: DEFAULT_PERFORMANCE_BINDING,
  ...(bindingArgument === undefined ? {} : { requestedId: bindingArgument }),
  ...(importedDefault === undefined
    ? {}
    : { importedDefaultId: importedDefault }),
});
const performanceBinding = selected.binding;
const performanceStatus = performanceStatusForSource(
  performanceBinding,
  source,
);
if (performanceStatus.status === "unavailable") {
  throw new Error(
    `Canonical AIR and receipt are valid, but exact performance export is unavailable: ${performanceStatus.message} Select an installed binding with --binding=<id> to create a new explicit projection.`,
  );
}

const compilation = compileAnyAir(source);
if (!compilation.compiled) {
  throw new Error("The verified AIR source could not be compiled for export.");
}
const compiled = compilation.compiled;
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const matchedAmplitude = {
  mode: "audition-peak-matched",
  targetPeak: 1,
  contract: AUDITION_PEAK_MATCH_CONTRACT,
} as const;
const digest = (bytes: ArrayBuffer | Uint8Array) =>
  `sha256:${createHash("sha256").update(new Uint8Array(bytes)).digest("hex")}`;
const stem =
  source.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "air";
const files = {
  artifact: `${stem}.refrain.json`,
  source: `${stem}.air.json`,
  midi: `${stem}.mid`,
  nativeAudio: `${stem}.native.wav`,
  ...(!includeMatchedPreview
    ? {}
    : { matchedAudio: `${stem}.audition-matched.wav` }),
  manifest: `${stem}.provenance.json`,
  soundProfile: `${stem}.sound-profile.json`,
  renderScene: `${stem}.render-scene.json`,
  ...(performanceBinding.soundPalette === undefined
    ? {}
    : { soundPalette: `${stem}.sound-palette.json` }),
  performanceBinding: `${stem}.performance-binding.json`,
  renderReceipts: `${stem}.render-receipts.json`,
  assetClosure: `${stem}.asset-closure.json`,
};

const completePiece =
  performanceBinding.format === "refrain-performance-binding@1-experimental" ||
  performanceBinding.renderer.performancePlanFormat ===
    COMPLETE_PIECE_PERFORMANCE_PLAN_FORMAT;
if (source.format === "air@1-experimental" && !completePiece)
  throw new Error(
    "AIR@1 export requires a complete-piece performance binding that can emit RenderReceipt@3.",
  );
const executionBundle = completePiece
  ? createExecutionBundle(compiled, {
      sourceRevision: receipt.sourceRevision,
      performanceBinding,
    })
  : undefined;
const legacyPlan = completePiece
  ? undefined
  : createPerformancePlan(compiled, {
      performanceBinding: performanceBinding as PerformanceBinding,
    });
const midi = executionBundle
  ? encodeExecutionMidi(executionBundle)
  : encodeMidi(compiled, legacyPlan);
const assetBytes = async (
  required: { assetId: string; kind: "wav" | "soundfont" },
  localPath: string,
) => {
  const bytes = await readFile(
    resolve(repoRoot, "apps/soundbench/public", localPath),
  );
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
};

let nativeWav: ArrayBuffer | undefined;
let matchedWav: ArrayBuffer | undefined;
let nativeOutputSha256: string;
let matchedOutputSha256: string | undefined;
let verifiedAssets: Array<{ assetId: string; bytes: number; sha256: string }>;
let streamEvidence:
  | {
      format: "refrain-stream-wav-evidence@0-experimental";
      outputBytes: number;
      outputSha256: string;
      sourcePeak: number;
      amplitudeScale: number;
      blockFrames: number;
      peakWorkingBytes: number;
    }
  | undefined;

if (executionBundle) {
  const locatorByAsset = new Map(
    executionBundle.runtimeAssets.map((asset) => [
      asset.assetId,
      asset.localPath,
    ]),
  );
  const executionAssets: {
    soundfont?: ArrayBuffer;
    samples: Record<string, ArrayBuffer>;
  } = { samples: {} };
  for (const required of executionBundle.plan.assetRequirements) {
    const localPath = locatorByAsset.get(required.assetId);
    if (!localPath)
      throw new Error(
        `Execution asset ${required.assetId} has no runtime locator.`,
      );
    const bytes = await assetBytes(required, localPath);
    if (required.kind === "soundfont") executionAssets.soundfont = bytes;
    else executionAssets.samples[required.assetId] = bytes;
  }
  streamEvidence = await streamExecutionWav(
    executionBundle,
    executionAssets,
    resolve(outputDirectory, files.nativeAudio),
    { amplitude: { mode: "native-gain" } },
  );
  nativeOutputSha256 = streamEvidence.outputSha256;
  if (includeMatchedPreview && files.matchedAudio) {
    matchedOutputSha256 = (
      await streamExecutionWav(
        executionBundle,
        executionAssets,
        resolve(outputDirectory, files.matchedAudio),
        { amplitude: matchedAmplitude },
      )
    ).outputSha256;
  }
  verifiedAssets = executionBundle.plan.assetRequirements.map(
    ({ assetId, bytes, sha256 }) => ({ assetId, bytes, sha256 }),
  );
} else {
  const plan = legacyPlan!;
  const renderAssets: RenderAssetBundle = { samples: {} };
  for (const required of plan.requiredAssets) {
    const bytes = await assetBytes(required, required.localPath);
    if (required.kind === "soundfont") renderAssets.soundfont = bytes;
    else
      (renderAssets.samples as Record<string, ArrayBuffer>)[required.assetId] =
        bytes;
  }
  const pcm = await renderPcm(compiled, renderAssets, 44_100, { plan });
  if (!pcm) throw new Error("The WAV export render was cancelled.");
  nativeWav = encodePcmWav(pcm);
  matchedWav = includeMatchedPreview
    ? encodePcmWav(pcm, { amplitude: matchedAmplitude })
    : undefined;
  nativeOutputSha256 = digest(nativeWav);
  matchedOutputSha256 = matchedWav ? digest(matchedWav) : undefined;
  verifiedAssets = pcm.verifiedAssets;
}

const nativeReceipt = executionBundle
  ? createExecutionRenderReceipt(executionBundle, {
      sourceRevision: receipt.sourceRevision,
      adapter: "wav",
      sampleRate: 44_100,
      outputSha256: nativeOutputSha256,
      verifiedAssets,
      outputAmplitude: { mode: "native-gain" },
      adaptationNotes: [
        "The native WAV was rendered by the bounded Node block kernel and written with a two-pass peak ceiling.",
      ],
    })
  : createRenderReceipt(legacyPlan!, {
      sourceRevision: receipt.sourceRevision,
      adapter: "wav",
      sampleRate: 44_100,
      outputSha256: nativeOutputSha256,
      verifiedAssets,
      outputAmplitude: { mode: "native-gain" },
    });
const midiReceipt = executionBundle
  ? createExecutionRenderReceipt(executionBundle, {
      sourceRevision: receipt.sourceRevision,
      adapter: "midi",
      outputSha256: digest(midi),
    })
  : createRenderReceipt(legacyPlan!, {
      sourceRevision: receipt.sourceRevision,
      adapter: "midi",
      outputSha256: digest(midi),
    });
const matchedReceipt =
  matchedOutputSha256 === undefined
    ? undefined
    : executionBundle
      ? createExecutionRenderReceipt(executionBundle, {
          sourceRevision: receipt.sourceRevision,
          adapter: "wav",
          sampleRate: 44_100,
          outputSha256: matchedOutputSha256,
          verifiedAssets,
          outputAmplitude: matchedAmplitude,
          adaptationNotes: [
            "This optional listening preview applies explicit peak matching; the native-gain WAV remains the ordinary audible projection.",
          ],
        })
      : createRenderReceipt(legacyPlan!, {
          sourceRevision: receipt.sourceRevision,
          adapter: "wav",
          sampleRate: 44_100,
          outputSha256: matchedOutputSha256,
          verifiedAssets,
          outputAmplitude: matchedAmplitude,
          adaptationNotes: [
            "This optional listening preview applies explicit peak matching; the native-gain WAV remains the ordinary audible projection.",
          ],
        });
const renderReceiptList: RenderReceipt[] = [
  nativeReceipt,
  midiReceipt,
  ...(matchedReceipt === undefined ? [] : [matchedReceipt]),
];
const renderReceipts = {
  format:
    source.format === "air@1-experimental" || isNextBinding(performanceBinding)
      ? "refrain-render-receipts@2-experimental"
      : "refrain-render-receipts@1-experimental",
  nativeWav: nativeReceipt,
  midi: midiReceipt,
  ...(matchedReceipt === undefined
    ? {}
    : { auditionMatchedWav: matchedReceipt }),
};
const projections: ProjectionReference[] = [
  {
    format: "refrain-projection-reference@0-experimental",
    kind: "native-wav",
    filename: files.nativeAudio,
    renderReceiptId: nativeReceipt.renderReceiptId,
  },
  {
    format: "refrain-projection-reference@0-experimental",
    kind: "midi",
    filename: files.midi,
    renderReceiptId: midiReceipt.renderReceiptId,
  },
  ...(matchedReceipt === undefined || files.matchedAudio === undefined
    ? []
    : [
        {
          format: "refrain-projection-reference@0-experimental" as const,
          kind: "audition-matched-wav" as const,
          filename: files.matchedAudio,
          renderReceiptId: matchedReceipt.renderReceiptId,
        },
      ]),
];
let portableArtifact;
if (source.format === "air@1-experimental") {
  if (receipt.format !== "refrain-receipt@1-experimental")
    throw new Error("AIR@1 export requires its exact Receipt@1 authority.");
  portableArtifact = createRefrainArtifactV3({
    source,
    receipt,
    caption,
    performanceBindings: importedBindings,
    performanceBinding,
    defaultBindingId: performanceBinding.id,
    renderReceipts: renderReceiptList as RenderReceiptV3[],
    projections,
  });
} else {
  if (receipt.format !== "refrain-receipt@0-experimental")
    throw new Error(
      "Historical AIR export requires its exact Receipt@0 authority.",
    );
  portableArtifact = isNextBinding(performanceBinding)
    ? createRefrainArtifactV2({
        source,
        receipt,
        caption,
        performanceBindings: importedBindings.filter(isNextBinding),
        performanceBinding,
        defaultBindingId: performanceBinding.id,
        renderReceipts: renderReceiptList as RenderReceiptV3[],
        projections,
      })
    : createRefrainArtifact({
        source,
        receipt,
        caption,
        performanceBindings: importedBindings.filter(
          (binding): binding is PerformanceBinding => !isNextBinding(binding),
        ),
        performanceBinding,
        defaultBindingId: performanceBinding.id,
        renderReceipts: renderReceiptList as RenderReceiptV2[],
        projections,
      });
}
const assetClosure = executionBundle
  ? createExecutionAssetClosure(executionBundle)
  : createAssetClosure(legacyPlan!);
const manifest = {
  format:
    source.format === "air@1-experimental"
      ? "refrain-export-manifest@4-experimental"
      : isNextBinding(performanceBinding)
        ? "refrain-export-manifest@3-experimental"
        : "refrain-export-manifest@2-experimental",
  receipt,
  sourceFormat: source.format,
  compilerFormat: compiled.format,
  performanceBinding: {
    id: performanceBinding.id,
    sha256: performanceBinding.contentSha256,
    profileId: performanceBinding.soundProfile.id,
    profileSha256: performanceBinding.soundProfileSha256,
    sceneId: performanceBinding.renderScene.id,
    sceneSha256: performanceBinding.renderScene.contentSha256,
    ...(performanceBinding.soundPalette === undefined
      ? {}
      : {
          paletteId: performanceBinding.soundPalette.id,
          paletteSha256: performanceBinding.soundPalette.contentSha256,
        }),
    rendererContract: performanceBinding.renderer.contract,
  },
  renderer: {
    engine: executionBundle
      ? "Refrain bounded block kernel + spessasynth_core@4.3.20"
      : "spessasynth_core@4.3.20 + Refrain declarative synth patches",
    sampleRate: 44_100,
    ...(streamEvidence === undefined ? {} : { streamEvidence }),
    soundpack: {
      id: SOUND_REGISTRY.id,
      sha256: SOUND_REGISTRY.contentSha256,
      selectedCandidates: nativeReceipt.selectedCandidates,
      publicReleaseAccepted: false,
    },
  },
  projections: files,
  diagnostics,
};

const writes: Array<Promise<void>> = [
  writeFile(
    resolve(outputDirectory, files.artifact),
    stringifyRefrainArtifact(portableArtifact),
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, files.source),
    stringifyAnyAir(source),
    "utf8",
  ),
  writeFile(resolve(outputDirectory, files.midi), midi),
  writeFile(
    resolve(outputDirectory, files.soundProfile),
    `${JSON.stringify(performanceBinding.soundProfile, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, files.renderScene),
    `${JSON.stringify(performanceBinding.renderScene, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, files.performanceBinding),
    `${JSON.stringify(performanceBinding, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, files.renderReceipts),
    `${JSON.stringify(renderReceipts, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, files.assetClosure),
    `${JSON.stringify(assetClosure, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, files.manifest),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  ),
];
if (nativeWav !== undefined) {
  writes.push(
    writeFile(
      resolve(outputDirectory, files.nativeAudio),
      new Uint8Array(nativeWav),
    ),
  );
}
if (matchedWav !== undefined && files.matchedAudio !== undefined) {
  writes.push(
    writeFile(
      resolve(outputDirectory, files.matchedAudio),
      new Uint8Array(matchedWav),
    ),
  );
}
if (performanceBinding.soundPalette && files.soundPalette) {
  writes.push(
    writeFile(
      resolve(outputDirectory, files.soundPalette),
      `${JSON.stringify(performanceBinding.soundPalette, null, 2)}\n`,
      "utf8",
    ),
  );
}
await Promise.all(writes);
process.stdout.write(
  arguments_.includes("--json")
    ? `${JSON.stringify({ ok: true, directory: outputDirectory, files })}\n`
    : `${outputDirectory}\n`,
);
