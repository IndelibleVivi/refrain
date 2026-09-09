import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { parseAir } from "@refrain/air-schema";
import { compileAir } from "@refrain/compiler";
import { createExecutionBundle } from "@refrain/audio-engine/execution";
import { createPerformancePlan } from "@refrain/audio-engine/performance";
import {
  createExecutionRenderReceipt,
  createRenderReceipt,
} from "@refrain/audio-engine/receipt";
import {
  createRefrainArtifact,
  createRefrainArtifactV2,
  parseRefrainArtifact,
  receiptIdOf,
  sourceRevisionOf,
  type AirReceipt,
  type RefrainArtifact,
} from "@refrain/renderer";
import {
  F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
  SOUND_REGISTRY,
} from "@refrain/soundpack";
import {
  CORE_AUTHORING_VOCABULARY,
  createPerformanceBindingV1,
  createRenderSceneV1,
  createSoundProfileV2,
} from "@refrain/soundpack/vnext";
import { makeWorkDocument } from "../tests/lib/work-document.js";

const binary = resolve("bin/refrain.mjs");
interface Preview {
  child: ChildProcess;
  report: { url: string; delivery: string; binding: string | null };
}
async function open(cwd: string, args: string[] = []): Promise<Preview> {
  const child = spawn(
    process.execPath,
    [binary, "open", "work.json", ...args, "--no-open", "--json"],
    {
      cwd,
      env: { ...process.env, TMPDIR: cwd },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return new Promise((done, reject) => {
    let text = "",
      errors = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Preview startup timed out: ${errors}`));
    }, 20_000);
    child.stderr!.on("data", (chunk) => {
      errors += String(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Preview exited ${code}: ${errors}`));
    });
    child.stdout!.on("data", (chunk) => {
      text += String(chunk);
      if (text.includes("\n")) {
        clearTimeout(timer);
        try {
          expect(text.length).toBeLessThan(2048);
          done({ child, report: JSON.parse(text.trim()) });
        } catch (error) {
          child.kill("SIGTERM");
          reject(error);
        }
      }
    });
  });
}

async function deliveredArtifact(preview: Preview): Promise<RefrainArtifact> {
  const url = new URL(preview.report.url);
  const session = new URL(url.searchParams.get("sessionHref")!);
  const response = await fetch(session);
  expect(response.status).toBe(200);
  return (await response.json()) as RefrainArtifact;
}

function historicalReceipt(
  source: NonNullable<ReturnType<typeof parseAir>["source"]>,
) {
  const sourceRevision = sourceRevisionOf(source);
  const core = {
    format: "refrain-receipt@0-experimental" as const,
    sourceRevision,
    airId: sourceRevision,
    sourceFormat: source.format,
    verification: {
      contract: "musical-relation@0-experimental" as const,
      status: "not_applicable" as const,
      motifLinks: [],
    },
  };
  return { ...core, receiptId: receiptIdOf(core) } satisfies AirReceipt;
}

function historicalSource() {
  const source = parseAir({
    format: "air@0-experimental",
    title: "Imported custody proof",
    tempo: 120,
    meter: "4/4",
    motifs: {},
    voices: [
      {
        id: "pad",
        instrument: "air_pad",
        role: "harmony",
        part: "C4/1",
      },
    ],
  }).source;
  if (!source) throw new Error("Historical custody fixture is invalid.");
  return source;
}

function artifactV1() {
  const source = historicalSource();
  const receipt = historicalReceipt(source);
  const plan = createPerformancePlan(compileAir(source).compiled!, {
    performanceBinding: F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
  });
  const renderReceipt = createRenderReceipt(plan, {
    sourceRevision: receipt.sourceRevision,
    adapter: "midi",
    outputSha256: `sha256:${"1".repeat(64)}`,
  });
  return createRefrainArtifact({
    source,
    receipt,
    performanceBindings: [F_SYNTHETIC_BEAT_PERFORMANCE_BINDING],
    renderReceipts: [renderReceipt],
    projections: [
      {
        format: "refrain-projection-reference@0-experimental",
        kind: "midi",
        filename: "custody-v1.mid",
        renderReceiptId: renderReceipt.renderReceiptId,
      },
    ],
    caption: "Historical Artifact@1 custody",
  });
}

function artifactV2() {
  const source = historicalSource();
  const receipt = historicalReceipt(source);
  const binding = createPerformanceBindingV1({
    id: "historical-preview-room@1",
    manifest: SOUND_REGISTRY,
    soundProfile: createSoundProfileV2({
      id: "historical-preview-profile@1",
      vocabulary: CORE_AUTHORING_VOCABULARY,
      selections: F_SYNTHETIC_BEAT_PERFORMANCE_BINDING.soundProfile.selections,
    }),
    renderScene: createRenderSceneV1({
      id: "historical-preview-scene@1",
      master: { gainDb: -14, peakCeiling: 0.72, velocityScale: 1 },
      buses: [{ id: "mix", output: "master", processors: [] }],
      routes: [{ id: "all", bus: "mix", match: {} }],
    }),
    requiredInstrumentIds: ["air_pad"],
  });
  const bundle = createExecutionBundle(compileAir(source).compiled!, {
    sourceRevision: receipt.sourceRevision,
    performanceBinding: binding,
  });
  const renderReceipt = createExecutionRenderReceipt(bundle, {
    sourceRevision: receipt.sourceRevision,
    adapter: "midi",
    outputSha256: `sha256:${"2".repeat(64)}`,
  });
  if (renderReceipt.format !== "refrain-render-receipt@3-experimental")
    throw new Error("Artifact@2 fixture needs RenderReceipt@3.");
  return createRefrainArtifactV2({
    source,
    receipt,
    performanceBinding: binding,
    renderReceipts: [renderReceipt],
    projections: [
      {
        format: "refrain-projection-reference@0-experimental",
        kind: "midi",
        filename: "custody-v2.mid",
        renderReceiptId: renderReceipt.renderReceiptId,
      },
    ],
    caption: "Historical Artifact@2 custody",
  });
}
async function close(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  child.kill(signal);
  await exited;
}

it.each(["SIGINT", "SIGTERM"] as const)(
  "keeps concurrent JSON previews isolated, same-origin, compact and individually disposable with %s",
  async (signal) => {
    const cwd = await mkdtemp(resolve(tmpdir(), "refrain-open-test-"));
    const previews: Preview[] = [];
    try {
      for (const args of [
        [
          "draft",
          "--out",
          "source.json",
          "--title",
          "Preview proof",
          "--instruments",
          "lattice_pluck",
          "--bars",
          "1",
        ],
        ["hum", "source.json", "--out", "work.json"],
      ]) {
        const result = spawnSync(process.execPath, [binary, ...args], {
          cwd,
          encoding: "utf8",
        });
        expect(result.status, result.stdout + result.stderr).toBe(0);
      }
      previews.push(await open(cwd));
      previews.push(await open(cwd));
      const urls = previews.map((p) => new URL(p.report.url));
      expect(urls[0]!.origin).not.toBe(urls[1]!.origin);
      const directories = () =>
        readdir(cwd).then((names) =>
          names.filter((n) => n.startsWith("refrain-preview-")),
        );
      expect(await directories()).toHaveLength(2);
      for (const [i, url] of urls.entries()) {
        expect(previews[i]!.report.delivery).toBe("session");
        const session = new URL(url.searchParams.get("sessionHref")!);
        expect(session.origin).toBe(url.origin);
        expect((await fetch(url)).status).toBe(200);
        const response = await fetch(session);
        expect(response.status).toBe(200);
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
        expect(parseRefrainArtifact(await response.json()).ok).toBe(true);
      }
      await close(previews[0]!.child, signal);
      expect(await directories()).toHaveLength(1);
      expect((await fetch(urls[1]!)).status).toBe(200);
      await close(previews[1]!.child, signal);
      expect(await directories()).toHaveLength(0);
    } finally {
      await Promise.all(previews.map((p) => close(p.child)));
      await rm(cwd, { recursive: true, force: true });
    }
  },
  40_000,
);

it("keeps imported Artifact@1/@2/@3 documents exact while --binding changes only the preview", async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), "refrain-open-custody-"));
  const previews: Preview[] = [];
  const current = await makeWorkDocument();
  try {
    const cases = [
      {
        document: artifactV1(),
        bindingId: F_SYNTHETIC_BEAT_PERFORMANCE_BINDING.id,
      },
      {
        document: artifactV2(),
        bindingId: F_SYNTHETIC_BEAT_PERFORMANCE_BINDING.id,
      },
      {
        document: current.document,
        bindingId: current.originalBindingId,
      },
    ];
    for (const { document, bindingId } of cases) {
      await writeFile(resolve(cwd, "work.json"), JSON.stringify(document));
      const preview = await open(cwd, ["--binding", bindingId]);
      previews.push(preview);
      expect(preview.report).toMatchObject({ binding: bindingId });
      expect(new URL(preview.report.url).searchParams.get("binding")).toBe(
        bindingId,
      );
      expect(await deliveredArtifact(preview)).toEqual(document);
      await close(preview.child);
    }
  } finally {
    await Promise.all(previews.map((preview) => close(preview.child)));
    await current.cleanup();
    await rm(cwd, { recursive: true, force: true });
  }
}, 60_000);
