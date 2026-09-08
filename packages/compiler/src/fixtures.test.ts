import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compileAir } from "./index.js";

const fixtureRoot = new URL("../../../fixtures/", import.meta.url);

describe("repository fixtures", () => {
  it("compiles every valid listening fixture", async () => {
    const directory = new URL("valid/", fixtureRoot);
    const files = await readdir(directory);
    for (const file of files) {
      const source = await readFile(new URL(file, directory), "utf8");
      const result = compileAir(source);
      expect(
        result.compiled,
        `${file}: ${JSON.stringify(result.diagnostics)}`,
      ).toBeDefined();
    }
  });

  it("keeps the negative listening fixture playable but warned", async () => {
    const source = await readFile(
      new URL("negative-listening/harsh-synth-001.air.json", fixtureRoot),
      "utf8",
    );
    const result = compileAir(source);
    expect(result.compiled).toBeDefined();
    expect(result.diagnostics.some((item) => item.severity === "warning")).toBe(
      true,
    );
  });

  it("rejects every invalid fixture", async () => {
    const directory = new URL("invalid/", fixtureRoot);
    const files = await readdir(directory);
    for (const file of files) {
      const source = await readFile(new URL(file, directory), "utf8");
      expect(compileAir(source).compiled, file).toBeUndefined();
    }
  });

  it("keeps the G2 sectional fixture in the 45–75 second acceptance window", async () => {
    const source = await readFile(
      new URL("valid/sectional-return.air.json", fixtureRoot),
      "utf8",
    );
    const result = compileAir(source);
    expect(result.compiled?.durationSeconds).toBeGreaterThanOrEqual(45);
    expect(result.compiled?.durationSeconds).toBeLessThanOrEqual(75);
    const segmentAnchors = new Set(
      result.compiled?.events.map((event) => event.source.segmentId),
    );
    expect(segmentAnchors.size).toBeGreaterThan(3);
  });

  it("keeps every F native palette piece in the listening window and covers the active identity set", async () => {
    const directory = new URL("f-palettes/", fixtureRoot);
    const files = (await readdir(directory)).sort();
    expect(files).toHaveLength(4);
    const instruments = new Set<string>();
    for (const file of files) {
      const sourceText = await readFile(new URL(file, directory), "utf8");
      const source = JSON.parse(sourceText) as {
        voices: Array<{ instrument: string }>;
      };
      source.voices.forEach((voice) => instruments.add(voice.instrument));
      const result = compileAir(sourceText);
      expect(
        result.compiled,
        `${file}: ${JSON.stringify(result.diagnostics)}`,
      ).toBeDefined();
      expect(result.compiled!.durationSeconds).toBeGreaterThanOrEqual(45);
      expect(result.compiled!.durationSeconds).toBeLessThanOrEqual(75);
      expect(
        result.diagnostics.filter((item) => item.severity === "warning"),
      ).toEqual([]);
    }
    expect([...instruments].sort()).toEqual(
      [
        "air_pad",
        "chamber_strings",
        "clarinet",
        "clean_bass",
        "dust_texture",
        "flute",
        "glass_bell",
        "harp",
        "lattice_pluck",
        "marimba",
        "nylon_guitar",
        "prism_lead",
        "rhythm_pulse",
        "soft_percussion",
        "solo_cello",
        "sub_bass",
        "warm_piano",
      ].sort(),
    );
  });
});
