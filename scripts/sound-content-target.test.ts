import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { BUILT_IN_PERFORMANCE_BINDINGS } from "@refrain/soundpack";
import { compileAirV1 } from "@refrain/compiler/v1";
import { createExecutionBundle } from "@refrain/audio-engine/execution";
import { humV1 } from "@refrain/mcp-server/hum-v1";
import { createRefrainArtifactV3 } from "@refrain/renderer/portable";
import {
  resolveAirSoundContentTarget,
  resolveSoundContentTarget,
} from "./sound-content-target.js";

describe("selective sound-content targets", () => {
  it("acquires current AIR@1 through the same exact execution closure as playback", async () => {
    const source = JSON.parse(
      await readFile("fixtures/air-v1/paper-waltz.air.json", "utf8"),
    );
    const binding = BUILT_IN_PERFORMANCE_BINDINGS.find(
      (candidate) => candidate.id === "f-luminous-hybrid@0",
    )!;
    const compiled = compileAirV1(source).compiled!;
    const bundle = createExecutionBundle(compiled, {
      performanceBinding: binding,
    });
    const target = await resolveSoundContentTarget([
      "--air",
      "fixtures/air-v1/paper-waltz.air.json",
      "--binding",
      binding.id,
    ]);
    expect(target.assets.map((asset) => asset.id).sort()).toEqual(
      bundle.plan.assetRequirements.map((asset) => asset.assetId).sort(),
    );
    expect(target.assets.length).toBeGreaterThan(0);
    const hum = humV1({ air: source });
    if (!hum.ok) throw new Error("Fixture must compile.");
    const artifact = createRefrainArtifactV3({
      source: hum.source,
      receipt: hum.receipt,
      performanceBinding: binding,
    });
    expect(resolveAirSoundContentTarget(artifact, binding).assets).toEqual(
      target.assets,
    );
    expect(() =>
      resolveAirSoundContentTarget(
        { ...artifact, source: { ...source, title: "tampered" } },
        binding,
      ),
    ).toThrow();
    const opening = resolveAirSoundContentTarget(source, binding, true);
    expect(opening.assets.length).toBeGreaterThan(0);
    expect(
      opening.assets.every((asset) =>
        target.assets.some((full) => full.id === asset.id),
      ),
    ).toBe(true);
    expect(() =>
      resolveAirSoundContentTarget({ ...source, format: "air@99" }, binding),
    ).toThrow(/Expected/);
  });

  it("resolves candidate-local closure without catalog-wide assets", async () => {
    await expect(
      resolveSoundContentTarget([
        "--candidate",
        "air-pad-subtractive-original",
      ]),
    ).resolves.toMatchObject({ assets: [] });
    const wind = await resolveSoundContentTarget([
      "--candidate",
      "flute-vsco-susnv-sfz-pilot",
    ]);
    expect(wind.assets).toHaveLength(19);
    expect(
      wind.assets.every((asset) =>
        asset.source.url.includes("6dd651d55dde97fd4028699be9d4481f26917891"),
      ),
    ).toBe(true);
  });

  it("derives full and opening AIR closures from one exact binding", async () => {
    const selector = [
      "--air",
      "fixtures/valid/e-wind-pilot.air.json",
      "--binding",
      "e-vsco-wind-pilots@0",
    ];
    const full = await resolveSoundContentTarget(selector);
    const opening = await resolveSoundContentTarget([...selector, "--opening"]);
    expect(full.assets.length).toBeGreaterThan(0);
    expect(full.assets.length).toBeLessThan(52);
    expect(opening.assets.length).toBeLessThanOrEqual(full.assets.length);
    expect(
      opening.assets.every((asset) =>
        full.assets.some((candidate) => candidate.sha256 === asset.sha256),
      ),
    ).toBe(true);
  });

  it("derives the same exact closure from in-memory AIR and binding authority", async () => {
    const source = JSON.parse(
      await readFile(
        "fixtures/f-palettes/luminous-hybrid-native.air.json",
        "utf8",
      ),
    );
    const binding = BUILT_IN_PERFORMANCE_BINDINGS.find(
      (candidate) => candidate.id === "f-luminous-hybrid@0",
    );
    expect(binding).toBeDefined();
    const direct = resolveAirSoundContentTarget(source, binding!);
    const cli = await resolveSoundContentTarget([
      "--air",
      "fixtures/f-palettes/luminous-hybrid-native.air.json",
      "--binding",
      "f-luminous-hybrid@0",
    ]);
    expect(direct.assets.map((asset) => asset.id)).toEqual(
      cli.assets.map((asset) => asset.id),
    );
  });

  it("requires one explicit target and rejects conflicting selectors", async () => {
    await expect(resolveSoundContentTarget([])).rejects.toThrow(
      /Choose an explicit/,
    );
    await expect(
      resolveSoundContentTarget([
        "--candidate",
        "air-pad-subtractive-original",
        "--profile",
        "g3a-audition@1",
      ]),
    ).rejects.toThrow(/Choose one target/);
  });
});
