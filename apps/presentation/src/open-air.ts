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
  type LocalProjectionAsset,
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
  type PerformanceBindingRuntimeStatus,
} from "@refrain/soundpack";
import { type PerformanceBindingV1 } from "@refrain/soundpack/vnext";
import { performanceStatusForSource } from "./select-performance-binding.js";
import {
  PresentationSessionStore,
  presentationSessionHandler,
} from "./presentation-session.js";
import {
  isPlayerPlaylistTheme,
  looksLikePlayerPlaylist,
  mergePlayerPlaylistAssets,
  parsePlayerPlaylist,
  PLAYER_PLAYLIST_FORMAT,
  PLAYER_PLAYLIST_THEME_IDS,
  playerPlaylistBytesFromText,
  stringifyPlayerPlaylist,
  type PlayerPlaylist,
  type PlayerPlaylistEntry,
} from "./player-playlist.js";

const USAGE =
  "Usage: refrain open <air-or-artifact> [more-air-or-artifact ...] [--binding <id>] [--theme <theme-id>] [--no-open] [--json]";

interface OpenArguments {
  inputPaths: string[];
  binding?: string;
  theme?: string;
}

/** File arguments; `--binding`/`--theme` accept both `--x=y` and `--x y`. */
function parseArguments(args: string[]): OpenArguments {
  const inputPaths: string[] = [];
  let binding: string | undefined;
  let theme: string | undefined;
  const assign = (name: string, value: string | undefined): void => {
    if (value === undefined || value.length === 0 || value.startsWith("--"))
      throw new Error(`${name} needs a value.`);
    if (name === "--binding") binding = value;
    else theme = value;
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === "--no-open" || token === "--json") continue;
    const separator = token.startsWith("--") ? token.indexOf("=") : -1;
    if (separator > 0) {
      const name = token.slice(0, separator);
      if (name !== "--binding" && name !== "--theme")
        throw new Error(`Unknown option ${name}.`);
      assign(name, token.slice(separator + 1));
      continue;
    }
    if (token === "--binding" || token === "--theme") {
      assign(token, args[index + 1]);
      index += 1;
      continue;
    }
    if (token.startsWith("--")) continue;
    inputPaths.push(token);
  }
  return {
    inputPaths,
    ...(binding === undefined ? {} : { binding }),
    ...(theme === undefined ? {} : { theme }),
  };
}

type AnyBinding = PerformanceBinding | PerformanceBindingV1;

interface LoadedWork {
  /** Input path or saved entry ID; diagnostics only. */
  label: string;
  artifact: RefrainArtifact;
  binding?: AnyBinding;
  status?: PerformanceBindingRuntimeStatus;
}

interface DecodedInput {
  path: string;
  text: string;
  value: unknown;
}

async function readInput(
  invocationDirectory: string,
  inputPath: string,
): Promise<DecodedInput> {
  const text = await readFile(resolve(invocationDirectory, inputPath), "utf8");
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    value = undefined;
  }
  return { path: inputPath, text, value };
}

/**
 * One canonical selection boundary for ordinary files and saved entries alike:
 * an explicit request is fatal when unavailable, a saved one only warns.
 */
function selectWork(
  artifact: RefrainArtifact,
  requestedBindingId: string | undefined,
  label: string,
  explicit: boolean,
): LoadedWork {
  if (
    artifact.format === "refrain-artifact@0-experimental" &&
    requestedBindingId === undefined
  )
    throw new Error(
      `The legacy artifact ${label} is continuity-valid but audibly unbound. Pass an explicit --binding=id to open playback without silently assigning one.`,
    );
  const presented = presentPortableArtifact(
    artifact,
    requestedBindingId,
    BUILT_IN_PERFORMANCE_BINDINGS,
  );
  if (!presented.ok) throw new Error(presented.message);
  const binding = presented.artifact.performanceBinding;
  const status = binding
    ? (presented.artifact.performanceStatus ??
      performanceStatusForSource(binding, artifact.source))
    : undefined;
  if (status?.status === "unavailable") {
    if (explicit)
      throw new Error(
        `Canonical AIR and receipt are valid, but requested PerformanceBinding ${binding!.id} is unavailable: ${status.message}`,
      );
    process.stderr.write(
      `Canonical AIR and receipt are valid. Opening ${label} with exact performance unavailable: ${status.message}\n`,
    );
  }
  return {
    label,
    artifact,
    ...(binding === undefined ? {} : { binding }),
    ...(status === undefined ? {} : { status }),
  };
}

/** Exactly one ordinary input: an imported artifact or an authorable AIR source. */
async function loadWork(
  input: DecodedInput,
  requestedBindingId: string | undefined,
): Promise<LoadedWork> {
  if (looksLikePlayerPlaylist(input.value))
    throw new Error(
      `${input.path} is a Refrain playlist; open it on its own instead of mixing it with works.`,
    );
  const parsedArtifact = parseRefrainArtifact(input.value);
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
    return selectWork(
      imported,
      requestedBindingId,
      input.path,
      requestedBindingId !== undefined,
    );
  }
  if (
    input.value &&
    typeof input.value === "object" &&
    !Array.isArray(input.value) &&
    typeof (input.value as { format?: unknown }).format === "string" &&
    String((input.value as { format: string }).format).startsWith(
      "refrain-artifact@",
    )
  )
    throw new Error(parsedArtifact.errors.join("\n"));
  const result = humAny({
    air: input.text,
    ...(requestedBindingId === undefined
      ? {}
      : { performance: { bindingId: requestedBindingId } }),
  });
  if (!result.ok) {
    throw new Error(
      result.diagnostics
        .map((item) => `${item.path}: ${item.message}`)
        .join("\n"),
    );
  }
  let artifact: RefrainArtifact;
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
  const binding = result.performanceBinding;
  const status = binding
    ? performanceStatusForSource(binding, artifact.source)
    : undefined;
  if (status?.status === "unavailable") {
    if (requestedBindingId !== undefined)
      throw new Error(
        `Canonical AIR and receipt are valid, but requested PerformanceBinding ${binding!.id} is unavailable: ${status.message}`,
      );
    process.stderr.write(
      `Canonical AIR and receipt are valid. Opening ${input.path} with exact performance unavailable: ${status.message}\n`,
    );
  }
  return {
    label: input.path,
    artifact,
    ...(binding === undefined ? {} : { binding }),
    ...(status === undefined ? {} : { status }),
  };
}

/** The closure shape one resolved binding needs, in canonical plan order. */
function requiredAssetsFor(work: LoadedWork): LocalProjectionAsset[] {
  const binding = work.binding!;
  const compilation = compileAnyAir(work.artifact.source);
  if (!compilation.compiled)
    throw new Error(
      "The verified AIR source could not be compiled for playback.",
    );
  if (binding.format === "refrain-performance-binding@1-experimental") {
    const bundle = createExecutionBundle(compilation.compiled, {
      sourceRevision: work.artifact.receipt.sourceRevision,
      performanceBinding: binding,
    });
    const pathByAsset = new Map(
      bundle.runtimeAssets.map((asset) => [asset.assetId, asset.localPath]),
    );
    return bundle.plan.assetRequirements.map((asset) => {
      const localPath = pathByAsset.get(asset.assetId);
      if (!localPath)
        throw new Error(
          `Execution asset ${asset.assetId} has no runtime locator.`,
        );
      return { ...asset, localPath };
    });
  }
  return createPerformancePlan(compilation.compiled, {
    performanceBinding: binding,
  }).requiredAssets;
}

/** Only exactly available bindings contribute to the prepared union. */
function sounded(loaded: readonly LoadedWork[]): LoadedWork[] {
  return loaded.filter(
    (work) => work.binding && work.status?.status !== "unavailable",
  );
}

interface OpenReport {
  ok: true;
  url: string;
  delivery: "inline" | "session";
  expiresAt?: string;
  kind?: "playlist";
  title?: string;
  entryCount?: number;
  bindings?: string[];
  sourceRevision?: string;
  binding?: string | null;
  theme?: string;
}

async function main(): Promise<void> {
  const {
    inputPaths,
    binding: bindingArgument,
    theme: themeArgument,
  } = parseArguments(process.argv.slice(2));
  if (inputPaths.length === 0) throw new Error(USAGE);
  if (themeArgument !== undefined && !isPlayerPlaylistTheme(themeArgument))
    throw new Error(
      `Unknown --theme ${themeArgument}; expected one of ${PLAYER_PLAYLIST_THEME_IDS.join(", ")}.`,
    );
  const noOpen = process.argv.includes("--no-open");
  const jsonOutput = process.argv.includes("--json");
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

  const multiInput = inputPaths.length > 1;
  const singleInput = multiInput
    ? undefined
    : await readInput(invocationDirectory, inputPaths[0]!);
  const playlistMode =
    multiInput ||
    (singleInput !== undefined && looksLikePlayerPlaylist(singleInput.value));

  let playlist: PlayerPlaylist | undefined;
  let deliveredPlaylistText: string | undefined;
  let works: LoadedWork[];
  if (playlistMode) {
    if (singleInput === undefined) {
      const loaded: LoadedWork[] = [];
      for (const inputPath of inputPaths)
        loaded.push(
          await loadWork(
            await readInput(invocationDirectory, inputPath),
            bindingArgument,
          ),
        );
      works = loaded;
      playlist = {
        format: PLAYER_PLAYLIST_FORMAT,
        title: "",
        entries: loaded.map((work, index) => ({
          id: `entry-${index + 1}`,
          artifact: work.artifact,
          ...(work.binding === undefined ? {} : { bindingId: work.binding.id }),
          ...(themeArgument === undefined
            ? {}
            : { presentation: { theme: themeArgument } }),
        })),
      };
      deliveredPlaylistText = stringifyPlayerPlaylist(playlist);
    } else {
      const parsed = parsePlayerPlaylist(singleInput.value);
      if (!parsed.ok) throw new Error(parsed.message);
      const entries: PlayerPlaylistEntry[] = parsed.playlist.entries.map(
        (entry) => ({ ...entry }),
      );
      // An explicit flag deliberately overrides every saved entry choice.
      for (const entry of entries) {
        if (bindingArgument !== undefined) entry.bindingId = bindingArgument;
        if (themeArgument !== undefined)
          entry.presentation = {
            ...(entry.presentation ?? {}),
            theme: themeArgument,
          };
      }
      playlist = {
        format: PLAYER_PLAYLIST_FORMAT,
        title: parsed.playlist.title,
        entries,
        ...(parsed.playlist.currentEntryId === undefined
          ? {}
          : { currentEntryId: parsed.playlist.currentEntryId }),
      };
      works = playlist.entries.map((entry) =>
        selectWork(
          entry.artifact,
          entry.bindingId,
          entry.id,
          bindingArgument !== undefined,
        ),
      );
      // Without an override the saved playlist stays byte-exact.
      deliveredPlaylistText =
        bindingArgument === undefined && themeArgument === undefined
          ? singleInput.text
          : stringifyPlayerPlaylist(playlist);
    }
  } else {
    works = [await loadWork(singleInput!, bindingArgument)];
  }
  if (playlist) {
    const checked = parsePlayerPlaylist(playlist);
    if (!checked.ok) throw new Error(checked.message);
  }

  const previewRoot = await mkdtemp(resolve(tmpdir(), "refrain-preview-"));
  let previewServer: Awaited<ReturnType<typeof createViteServer>> | undefined;
  async function closePreview() {
    if (previewServer) await previewServer.close();
    else await rm(previewRoot, { recursive: true, force: true });
  }
  try {
    const soundedWorks = sounded(works);
    const union = mergePlayerPlaylistAssets(
      soundedWorks.map((work) => ({
        label: work.label,
        assets: requiredAssetsFor(work),
      })),
    );
    if (union.length > 0) {
      await prepareLocalAssetProjection({
        assets: union,
        sourceRoot: resolve(repoRoot, "apps/soundbench/public"),
        targetRoot: previewRoot,
        missingAssetHint: playlistMode
          ? "Acquire each work's exact closure with refrain fetch --air <file> --binding <id>."
          : `Run refrain fetch --air ${inputPaths[0]!} --binding ${soundedWorks[0]!.binding!.id}.`,
      });
      process.stderr.write(
        playlistMode
          ? `Prepared ${union.length} exact assets for ${soundedWorks.length} of ${works.length} works.\n`
          : `Prepared ${union.length} exact assets for ${soundedWorks[0]!.binding!.id}.\n`,
      );
    }
    await prepareSpessaSynthWorklet(repoRoot, previewRoot);

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
    let report: OpenReport;
    if (playlistMode) {
      const { bytes, sha256 } = playerPlaylistBytesFromText(
        deliveredPlaylistText!,
      );
      const created = store.createPlaylist(
        bytes,
        sha256,
        `${url.origin}/session`,
      );
      expiresAt = created.delivery.expiresAt;
      url.searchParams.set("playlistHref", created.delivery.href);
      url.hash = new URLSearchParams({ playlist: sha256 }).toString();
      report = {
        ok: true,
        kind: "playlist",
        url: url.toString(),
        title: playlist!.title,
        entryCount: playlist!.entries.length,
        bindings: [
          ...new Set(
            works.flatMap((work) =>
              work.binding === undefined ? [] : [work.binding.id],
            ),
          ),
        ],
        delivery: "session",
        expiresAt,
      };
    } else {
      const work = works[0]!;
      const delivery = createInlinePresentationRef(work.artifact);
      // Machine results carry a short locator, never an entire score in a URL.
      const inline = delivery.ok && !jsonOutput;
      const artifactSha256 = delivery.ok
        ? delivery.ref.artifactSha256
        : delivery.artifactSha256;
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
      if (work.binding) url.searchParams.set("binding", work.binding.id);
      if (themeArgument !== undefined)
        url.searchParams.set("theme", themeArgument);
      report = {
        ok: true,
        url: url.toString(),
        sourceRevision: work.artifact.receipt.sourceRevision,
        binding: work.binding?.id ?? null,
        ...(themeArgument === undefined ? {} : { theme: themeArgument }),
        delivery: inline ? "inline" : "session",
        expiresAt,
      };
    }
    process.stdout.write(
      jsonOutput
        ? `${JSON.stringify(report)}\n`
        : report.kind === "playlist"
          ? `Local playlist ready (${report.delivery}, ${report.entryCount} works).\n${report.url}\nKeep this process running; playback starts from the Play button.\n`
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
}

try {
  await main();
} catch (cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (process.argv.includes("--json"))
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: { message } })}\n`,
    );
  else process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
