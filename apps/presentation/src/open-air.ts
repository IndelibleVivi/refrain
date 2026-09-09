import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer as createViteServer } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileAnyAir } from "@refrain/compiler/any";
import { createExecutionBundle } from "@refrain/audio-engine/execution";
import { createPerformancePlan } from "@refrain/audio-engine/performance";
import {
  prepareLocalAssetProjection,
  prepareSpessaSynthWorklet,
} from "@refrain/audio-engine/local-asset-projection";
import { humAny } from "@refrain/mcp-server/hum-any";
import type { HumSuccess } from "@refrain/mcp-server/hum";
import type { HumSuccessV1 } from "@refrain/mcp-server/hum-v1";
import {
  createInlinePresentationRef,
  createRefrainArtifact,
  createRefrainArtifactV3,
  parseRefrainArtifact,
  sourceReceiptIntegrityErrors,
  type RefrainArtifact,
} from "@refrain/renderer";
import { presentPortableArtifact } from "@refrain/renderer/artifact-document";
import { sourceReceiptIntegrityErrorsV1 } from "@refrain/renderer/v1";
import {
  BUILT_IN_PERFORMANCE_BINDINGS,
  type PerformanceBinding,
} from "@refrain/soundpack";
import { type PerformanceBindingV1 } from "@refrain/soundpack/vnext";
import { performanceStatusForSource } from "./select-performance-binding.js";
import {
  PresentationSessionStore,
  presentationSessionHandler,
} from "./presentation-session.js";

const arguments_ = process.argv.slice(2);
const inputPath = arguments_.find((argument) => !argument.startsWith("--"));
const bindingArgument = arguments_
  .find((argument) => argument.startsWith("--binding="))
  ?.slice("--binding=".length);
if (!inputPath)
  throw new Error(
    "Usage: npm run open:air -- path/to/file.air.json|file.refrain.json [--binding=id] [--no-open]",
  );
const noOpen = arguments_.includes("--no-open");
const jsonOutput = arguments_.includes("--json");

const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const inputText = await readFile(
  resolve(invocationDirectory, inputPath),
  "utf8",
);
let decoded: unknown;
try {
  decoded = JSON.parse(inputText) as unknown;
} catch {
  decoded = undefined;
}

type AnyBinding = PerformanceBinding | PerformanceBindingV1;

let artifact: RefrainArtifact;
let selectedBinding: AnyBinding | undefined;
const parsedArtifact = parseRefrainArtifact(decoded);
if (parsedArtifact.ok) {
  const imported = parsedArtifact.artifact;
  const compiled = compileAnyAir(imported.source);
  if (!compiled.source || !compiled.compiled)
    throw new Error("The Refrain artifact contains an invalid AIR.");
  const receiptErrors =
    imported.format === "refrain-artifact@3-experimental"
      ? sourceReceiptIntegrityErrorsV1(imported.source, imported.receipt)
      : sourceReceiptIntegrityErrors(imported.source, imported.receipt);
  if (receiptErrors.length > 0)
    throw new Error(
      "The Refrain artifact receipt does not match its canonical source.",
    );
  if (
    imported.format === "refrain-artifact@0-experimental" &&
    bindingArgument === undefined
  )
    throw new Error(
      "The legacy artifact is continuity-valid but audibly unbound. Pass an explicit --binding=id to open playback without silently assigning one.",
    );
  const presented = presentPortableArtifact(
    imported,
    bindingArgument,
    BUILT_IN_PERFORMANCE_BINDINGS,
  );
  if (!presented.ok) throw new Error(presented.message);
  selectedBinding = presented.artifact.performanceBinding;
  const performanceStatus = selectedBinding
    ? (presented.artifact.performanceStatus ??
      performanceStatusForSource(selectedBinding, imported.source))
    : {
        status: "unavailable" as const,
        reason: "instrument-vocabulary-not-installed" as const,
        message:
          "This AIR@1 artifact has no explicitly selected exact performance binding.",
        errors: ["No exact performance binding is selected."],
      };
  if (
    performanceStatus.status === "unavailable" &&
    bindingArgument !== undefined
  ) {
    throw new Error(
      `Canonical AIR and receipt are valid, but requested PerformanceBinding ${selectedBinding!.id} is unavailable: ${performanceStatus.message}`,
    );
  }
  if (performanceStatus.status === "unavailable") {
    process.stderr.write(
      `Canonical AIR and receipt are valid. Opening structure with exact performance unavailable: ${performanceStatus.message}\n`,
    );
  }
  artifact = imported;
} else {
  if (
    decoded &&
    typeof decoded === "object" &&
    !Array.isArray(decoded) &&
    typeof (decoded as { format?: unknown }).format === "string" &&
    String((decoded as { format: string }).format).startsWith(
      "refrain-artifact@",
    )
  ) {
    throw new Error(parsedArtifact.errors.join("\n"));
  }
  const result = humAny({
    air: inputText,
    ...(bindingArgument === undefined
      ? {}
      : { performance: { bindingId: bindingArgument } }),
  });
  if (!result.ok) {
    throw new Error(
      result.diagnostics
        .map((item) => `${item.path}: ${item.message}`)
        .join("\n"),
    );
  }
  selectedBinding = result.performanceBinding;
  if (result.source.format === "air@1-experimental") {
    const current = result as HumSuccessV1;
    artifact = createRefrainArtifactV3({
      source: current.source,
      receipt: current.receipt,
      ...(current.performanceBinding === undefined
        ? {}
        : { performanceBinding: current.performanceBinding }),
      ...(current.caption === undefined ? {} : { caption: current.caption }),
    });
  } else {
    const historical = result as HumSuccess;
    artifact = createRefrainArtifact({
      source: historical.source,
      receipt: historical.receipt,
      performanceBinding: historical.performanceBinding,
      ...(historical.caption === undefined
        ? {}
        : { caption: historical.caption }),
    });
  }
}

const previewRoot = await mkdtemp(resolve(tmpdir(), "refrain-preview-"));
let previewServer: Awaited<ReturnType<typeof createViteServer>> | undefined;
async function closePreview() {
  if (previewServer) await previewServer.close();
  else await rm(previewRoot, { recursive: true, force: true });
}
try {
  if (
    selectedBinding &&
    performanceStatusForSource(selectedBinding, artifact.source).status ===
      "available"
  ) {
    const compilation = compileAnyAir(artifact.source);
    if (!compilation.compiled)
      throw new Error(
        "The verified AIR source could not be compiled for playback.",
      );
    const selectedAssets =
      selectedBinding.format === "refrain-performance-binding@1-experimental"
        ? (() => {
            const bundle = createExecutionBundle(compilation.compiled, {
              sourceRevision: artifact.receipt.sourceRevision,
              performanceBinding: selectedBinding,
            });
            const pathByAsset = new Map(
              bundle.runtimeAssets.map((asset) => [
                asset.assetId,
                asset.localPath,
              ]),
            );
            return bundle.plan.assetRequirements.map((asset) => {
              const localPath = pathByAsset.get(asset.assetId);
              if (!localPath)
                throw new Error(
                  `Execution asset ${asset.assetId} has no runtime locator.`,
                );
              return { ...asset, localPath };
            });
          })()
        : createPerformancePlan(compilation.compiled, {
            performanceBinding: selectedBinding,
          }).requiredAssets;
    await prepareLocalAssetProjection({
      assets: selectedAssets,
      sourceRoot: resolve(repoRoot, "apps/soundbench/public"),
      targetRoot: previewRoot,
      missingAssetHint: `Run refrain fetch --air ${inputPath} --binding ${selectedBinding.id}.`,
    });
    process.stderr.write(
      `Prepared ${selectedAssets.length} exact assets for ${selectedBinding.id}.\n`,
    );
  }
  await prepareSpessaSynthWorklet(repoRoot, previewRoot);

  const delivery = createInlinePresentationRef(artifact);
  // Machine results carry a short locator, never an entire score in a URL.
  const inline = delivery.ok && !jsonOutput;
  const artifactSha256 = delivery.ok
    ? delivery.ref.artifactSha256
    : delivery.artifactSha256;
  const store = new PresentationSessionStore("open-air-cli");
  const sessionHandler = presentationSessionHandler(store);
  previewServer = await createViteServer({
    root: resolve(repoRoot, "apps/presentation"),
    configFile: resolve(repoRoot, "apps/presentation/vite.config.ts"),
    publicDir: previewRoot,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 4318, strictPort: false, open: false },
    plugins: [
      {
        name: "refrain-local-session",
        // Vite also owns a SIGTERM handler. Its close must await our cleanup
        // before it exits, rather than racing a separate signal callback.
        async closeBundle() {
          await rm(previewRoot, { recursive: true, force: true });
        },
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (request.url?.startsWith("/session/"))
              sessionHandler(request, response);
            else next();
          });
        },
      },
    ],
  });
  await previewServer.listen();
  const address = previewServer.httpServer!.address();
  if (!address || typeof address === "string")
    throw new Error("No loopback preview address.");
  const url = new URL(`http://127.0.0.1:${address.port}`);
  let expiresAt: string | undefined;
  if (inline && delivery.ok) {
    url.hash = new URLSearchParams({
      artifact: delivery.ref.artifactSha256,
      bytes: delivery.ref.delivery.fragment,
    }).toString();
  } else {
    const created = store.create(
      delivery.artifactBytes,
      artifactSha256,
      `${url.origin}/session`,
    );
    expiresAt = created.ref.delivery.expiresAt;
    url.searchParams.set("sessionHref", created.ref.delivery.href);
    url.hash = new URLSearchParams({
      artifact: artifactSha256,
    }).toString();
  }
  if (selectedBinding) url.searchParams.set("binding", selectedBinding.id);
  const report = {
    ok: true,
    url: url.toString(),
    sourceRevision: artifact.receipt.sourceRevision,
    binding: selectedBinding?.id ?? null,
    delivery: inline ? "inline" : "session",
    expiresAt,
  };
  process.stdout.write(
    jsonOutput
      ? `${JSON.stringify(report)}\n`
      : `Local presentation ready (${report.delivery}, binding ${report.binding ?? "unbound"}).\n${report.url}\nKeep this process running; playback starts from the Play button.\n`,
  );
  if (!noOpen) {
    previewServer.config.server.open = `${url.pathname}${url.search}${url.hash}`;
    previewServer.openBrowser();
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void closePreview().then(() => process.exit(0));
    });
  }
} catch (cause) {
  await closePreview();
  throw cause;
}
