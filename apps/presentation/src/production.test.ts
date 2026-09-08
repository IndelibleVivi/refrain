import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
  SOUND_REGISTRY,
  createPerformanceBinding,
} from "@refrain/soundpack";
import { createPerformanceBindingV1 } from "@refrain/soundpack/vnext";
import {
  SYNTHETIC_SPICES_PROFILE,
  SYNTHETIC_SPICES_SCENE,
} from "@refrain/soundpack/proof-packs";
import {
  createRefrainArtifactV3,
  parseRefrainArtifact,
} from "@refrain/renderer/portable";
import { createRootReceiptV1 } from "@refrain/renderer/v1";
import { createExecutionBundle } from "@refrain/audio-engine/execution";
import { renderExecutionBlocks } from "@refrain/audio-engine/block-renderer";
import { draftAir } from "./authoring.js";
import { readMusic } from "./inspect-air.js";
import {
  initProduction,
  applyProduction,
  inspectProduction,
  runProductionCli,
} from "./production.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
function work(binding = F_SYNTHETIC_BEAT_PERFORMANCE_BINDING) {
  const source = draftAir({
    title: "Production proof",
    instruments: ["lattice_pluck", "sub_bass", "air_pad"],
    tempo: 120,
    meter: "4/4",
    bars: 1,
  });
  for (const [i, v] of source.voices.entries()) {
    v.role = i === 0 ? "lead" : i === 1 ? "bass" : "harmony";
    v.realize = [
      {
        id: "line",
        kind: "literal",
        part:
          i === 0
            ? "C5/4 r/2 r/4"
            : i === 1
              ? "C2/4 r/2 r/4"
              : "[C4,E4,G4]/4 r/2 r/4",
        dynamic: "p",
      },
    ];
  }
  return createRefrainArtifactV3({
    source,
    receipt: createRootReceiptV1(source),
    performanceBinding: binding,
    caption: "A production test.",
  });
}
async function samples(artifact: ReturnType<typeof work>) {
  const binding = artifact.performanceBindings.find(
    (b) => b.id === artifact.defaultBindingId,
  )!;
  const bundle = createExecutionBundle(readMusic(artifact).compiled, {
    performanceBinding: binding,
    sourceRevision: artifact.receipt.sourceRevision,
  });
  const result: number[] = [];
  for await (const block of renderExecutionBlocks(bundle, {}, 44_100, {
    blockFrames: 4096,
  }))
    result.push(...block.left, ...block.right);
  return result;
}

describe("explicit production workflow", () => {
  it("retains silent voices without inventing a resolved sound or failing inspection", () => {
    const source = draftAir({
      title: "Silent draft",
      instruments: ["lattice_pluck", "sub_bass"],
      tempo: 120,
      meter: "4/4",
      bars: 1,
    });
    const original = createRefrainArtifactV3({
      source,
      receipt: createRootReceiptV1(source),
      performanceBinding: F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
    });
    const report = inspectProduction(original);
    expect(report.voices).toHaveLength(2);
    expect(
      report.voices.every(
        (v) => v.execution === "silent" && v.resolvedSound === null,
      ),
    ).toBe(true);
    expect(() =>
      applyProduction(original, initProduction(original, "silent-mix@1")),
    ).toThrow(/at least one sounding note/);
    source.voices[0]!.realize = [
      { id: "first-note", kind: "literal", part: "C5/1" },
    ];
    const partial = createRefrainArtifactV3({
      source,
      receipt: createRootReceiptV1(source),
      performanceBinding: F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
    });
    const produced = applyProduction(
      partial,
      initProduction(partial, "partial-mix@1"),
    );
    expect(produced.source).toEqual(source);
    const after = inspectProduction(produced);
    expect(after.voices.find((v) => v.id === "sub_bass")).toMatchObject({
      execution: "silent",
      resolvedSound: null,
    });
    expect(after.voices.find((v) => v.id === "lattice_pluck")?.execution).toBe(
      "scheduled",
    );
  });

  it("preserves source, music receipt and candidate choices while producing repeatable changed audio", async () => {
    const original = work();
    const before = JSON.stringify(original);
    const settings = initProduction(original, "close-room@1");
    expect(settings.scene.buses.every((b) => b.processors.length === 0)).toBe(
      true,
    );
    settings.scene.buses.find((b) => b.id === "role-bass")!.output = "master";
    settings.scene.buses.find((b) => b.id === "role-harmony")!.processors = [
      { id: "tone", type: "lowpass", frequencyHz: 1800, q: 0.7 },
    ];
    settings.scene.buses.find((b) => b.id === "mix")!.processors = [
      { id: "space", type: "room", decaySeconds: 0.7, mix: 0.12 },
      { id: "echo", type: "delay", delayMs: 125, feedback: 0.2, mix: 0.08 },
    ];
    const produced = applyProduction(original, settings);
    expect(JSON.stringify(original)).toBe(before);
    expect(produced.source).toEqual(original.source);
    expect(produced.receipt).toEqual(original.receipt);
    expect(produced.caption).toBe(original.caption);
    expect(produced.performanceBindings).toContainEqual(
      original.performanceBindings[0],
    );
    const current = produced.performanceBindings.find(
      (b) => b.id === produced.defaultBindingId,
    )!;
    expect(current.soundProfile.selections).toEqual(
      original.performanceBindings[0]!.soundProfile.selections,
    );
    expect(current.soundPalette).toBeUndefined();
    const report = inspectProduction(produced);
    expect(
      report.voices.find((v) => v.role === "bass")!.chain.map((b) => b.bus),
    ).toEqual(["role-bass"]);
    expect(
      report.voices.find((v) => v.role === "harmony")!.chain.map((b) => b.bus),
    ).toEqual(["role-harmony", "mix"]);
    const a = await samples(produced);
    const b = await samples(produced);
    expect(a).toEqual(b);
    expect(a.some((s) => Math.abs(s) > 0.0001)).toBe(true);
    expect(a).not.toEqual(await samples(original));
    expect(parseRefrainArtifact(produced).ok).toBe(true);
  }, 20000);

  it("bakes effective master overrides once and retains an existing sparse profile and scene graph", () => {
    const legacy = createPerformanceBinding({
      ...F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
      id: "overridden@0",
      overrides: { masterGainDb: -18, peakCeiling: 0.5, velocityScale: 0.8 },
    });
    const settings = initProduction(work(legacy), "new-mix@1");
    expect(settings.scene.master).toEqual({
      gainDb: -18,
      peakCeiling: 0.5,
      velocityScale: 0.8,
    });
    const binding = createPerformanceBindingV1({
      id: "sparse@1",
      soundProfile: SYNTHETIC_SPICES_PROFILE,
      renderScene: SYNTHETIC_SPICES_SCENE,
      requiredInstrumentIds: ["air_pad", "lattice_pluck", "sub_bass"],
      manifest: SOUND_REGISTRY,
    });
    const original = work();
    const sparse = createRefrainArtifactV3({
      ...original,
      performanceBinding: binding,
      defaultBindingId: binding.id,
    });
    const fresh = initProduction(sparse, "sparse-next@1");
    expect(fresh.scene.buses).toEqual(binding.renderScene.buses);
    expect(fresh.scene.routes).toEqual(binding.renderScene.routes);
    const output = applyProduction(sparse, fresh);
    const next = output.performanceBindings.find(
      (b) => b.id === "sparse-next@1",
    )!;
    expect(next.soundProfile).toEqual(binding.soundProfile);
    expect(next.overrides).toEqual({});
    expect(initProduction(output, "sparse-third@1").scene).toEqual(fresh.scene);
  });

  it("rejects stale settings, conflicting identities, invalid graphs, unsupported processors and tampered music", () => {
    const original = work();
    const settings = initProduction(original, "mix@1");
    expect(() =>
      applyProduction(original, {
        ...settings,
        baseBinding: { ...settings.baseBinding, sha256: "0".repeat(64) },
      }),
    ).toThrow(/different exact binding/);
    const changed = applyProduction(original, settings);
    expect(() => applyProduction(changed, settings)).toThrow(
      /different exact binding/,
    );
    const conflict = structuredClone(settings);
    conflict.scene.master.gainDb -= 2;
    expect(() =>
      applyProduction(changed, conflict, original.defaultBindingId),
    ).toThrow(/Conflicting/);
    const cyclic = structuredClone(settings);
    cyclic.scene.buses[0]!.output = cyclic.scene.buses[0]!.id;
    expect(() => applyProduction(original, cyclic)).toThrow(/cycles/);
    const unsupported = structuredClone(settings) as unknown as {
      scene: { buses: Array<{ processors: unknown[] }> };
    };
    unsupported.scene.buses[0]!.processors = [
      { id: "eq", type: "highpass", frequencyHz: 80 },
    ];
    expect(() => applyProduction(original, unsupported)).toThrow(/Unsupported/);
    const tampered = structuredClone(original);
    tampered.source.title = "Changed without a receipt";
    expect(() => initProduction(tampered, "mix@1")).toThrow();
  });

  it("reports actual first-match routing and voices that instrument/role rules cannot separate", () => {
    const original = work();
    const source = structuredClone(original.source);
    source.voices.push({ ...source.voices[0]!, id: "second-lead" });
    const artifact = createRefrainArtifactV3({
      source,
      receipt: createRootReceiptV1(source),
      performanceBinding: original.performanceBindings[0],
    });
    const settings = initProduction(artifact, "route-proof@1");
    settings.scene.routes.unshift({ id: "catch-all", bus: "mix", match: {} });
    const report = inspectProduction(applyProduction(artifact, settings));
    expect(report.routes[0]!.matchedVoices).toHaveLength(4);
    expect(
      report.routes.slice(1).every((r) => r.matchedVoices.length === 0),
    ).toBe(true);
    expect(report.inseparableGroups).toEqual([
      {
        instrumentRole: "lattice_pluck/lead",
        voices: ["lattice_pluck", "second-lead"],
      },
    ]);
  });

  it("runs through the installed command shape in the caller directory and never overwrites files", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "refrain-production-test-"));
    roots.push(root);
    await writeFile(resolve(root, "work.json"), JSON.stringify(work()));
    const binary = resolve("bin/refrain.mjs");
    const cli = (...args: string[]) => {
      const r = spawnSync(
        process.execPath,
        [binary, "produce", ...args, "--json"],
        { cwd: root, encoding: "utf8" },
      );
      expect(r.status, r.stdout + r.stderr).toBe(0);
      return JSON.parse(r.stdout);
    };
    cli("init", "work.json", "--id", "saved-mix@1", "--out", "settings.json");
    const settings = JSON.parse(
      await readFile(resolve(root, "settings.json"), "utf8"),
    );
    settings.scene.master.gainDb -= 3;
    await writeFile(resolve(root, "settings.json"), JSON.stringify(settings));
    expect(
      cli("inspect", "work.json", "--settings", "settings.json").preview,
    ).toBe(true);
    const result = cli(
      "apply",
      "work.json",
      "--settings",
      "settings.json",
      "--out",
      "produced.json",
    );
    expect(await realpath(result.path)).toBe(
      await realpath(resolve(root, "produced.json")),
    );
    expect(result.sourceUnchanged).toBe(true);
    expect(cli("inspect", "produced.json").binding.id).toBe("saved-mix@1");
    await expect(
      runProductionCli(
        [
          "apply",
          "work.json",
          "--settings",
          "settings.json",
          "--out",
          "produced.json",
        ],
        root,
      ),
    ).rejects.toThrow(/EEXIST/);
  }, 15000);

  it("retains prior render evidence and exports a new exact native embodiment reproducibly", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "refrain-production-export-"));
    roots.push(root);
    const binary = resolve("bin/refrain.mjs");
    await writeFile(resolve(root, "work.json"), JSON.stringify(work()));
    const exportWork = async (input: string, directory: string) => {
      const result = spawnSync(
        process.execPath,
        [binary, "export", input, "--out", directory, "--json"],
        { cwd: root, encoding: "utf8" },
      );
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      return {
        files: {
          artifact: resolve(report.directory, report.files.artifact),
          wav: resolve(report.directory, report.files.nativeAudio),
        },
      };
    };
    const exported = await exportWork("work.json", "before");
    const original = JSON.parse(
      await readFile(exported.files.artifact, "utf8"),
    );
    const settings = initProduction(original, "retained-evidence@1");
    settings.scene.master.gainDb -= 6;
    const produced = applyProduction(original, settings);
    expect(produced.renderReceipts).toEqual(original.renderReceipts);
    expect(produced.projections).toEqual(original.projections);
    await writeFile(resolve(root, "produced.json"), JSON.stringify(produced));
    const a = await exportWork("produced.json", "after-a");
    const b = await exportWork("produced.json", "after-b");
    expect(await readFile(a.files.wav)).toEqual(await readFile(b.files.wav));
    expect(await readFile(a.files.wav)).not.toEqual(
      await readFile(exported.files.wav),
    );
    const final = JSON.parse(await readFile(a.files.artifact, "utf8"));
    expect(parseRefrainArtifact(final).ok).toBe(true);
    expect(final.receipt).toEqual(original.receipt);
    expect(final.defaultBindingId).toBe("retained-evidence@1");
  }, 20000);
});
