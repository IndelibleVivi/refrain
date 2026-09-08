import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAirV1 } from "@refrain/air-schema/v1";
import {
  validateAnyExtensionPack,
  validateExtensionPackAuthoringVocabulary,
  type ExtensionPackV1,
} from "@refrain/soundpack/vnext";
import { describe, expect, it } from "vitest";
import { compileAirV1 } from "./v1.js";

interface CorpusManifest {
  format: string;
  status: string;
  acceptanceBoundary: string;
  extensionPacks: Array<{
    filename: string;
    vocabularyId: string;
    vocabularySha256: string;
  }>;
  items: Array<{
    filename: string;
    perspective: string;
    density: "sparse" | "medium" | "dense";
    features: string[];
  }>;
}

describe("AIR@1 authored diversity corpus", () => {
  it("compiles every exact fixture without turning corpus breadth into a taste claim", () => {
    const root = resolve("fixtures/air-v1");
    const manifest = JSON.parse(
      readFileSync(resolve(root, "corpus.json"), "utf8"),
    ) as CorpusManifest;
    expect(manifest).toMatchObject({
      format: "refrain-air-v1-corpus@0-experimental",
      status: "schema-and-compiler-evidence",
    });
    expect(manifest.acceptanceBoundary).toMatch(
      /not multi-host\/model acceptance/i,
    );
    expect(new Set(manifest.items.map((item) => item.density))).toEqual(
      new Set(["sparse", "medium", "dense"]),
    );
    const pack = JSON.parse(
      readFileSync(resolve(root, manifest.extensionPacks[0]!.filename), "utf8"),
    ) as ExtensionPackV1;
    const packSource = parseAirV1(
      JSON.parse(
        readFileSync(resolve(root, "prismatic-pack-voice.air.json"), "utf8"),
      ),
    ).source!;
    expect(validateAnyExtensionPack(pack)).toEqual([]);
    expect(
      validateExtensionPackAuthoringVocabulary(pack, packSource.vocabulary),
    ).toEqual([]);
    expect(pack.modules).toContainEqual({
      kind: "authoring-vocabulary",
      id: manifest.extensionPacks[0]!.vocabularyId,
      sha256: manifest.extensionPacks[0]!.vocabularySha256,
    });

    const meters = new Set<string>();
    const eventCounts: number[] = [];
    let hasPickup = false;
    let hasGroove = false;
    let hasPhrase = false;
    let hasTechnique = false;
    let hasPackVoice = false;
    for (const item of manifest.items) {
      const input = JSON.parse(
        readFileSync(resolve(root, item.filename), "utf8"),
      ) as unknown;
      const parsed = parseAirV1(input);
      expect(parsed.diagnostics, item.filename).toEqual([]);
      const compiled = compileAirV1(input);
      expect(
        compiled.diagnostics.filter(
          (diagnostic) => diagnostic.severity === "error",
        ),
        item.filename,
      ).toEqual([]);
      expect(compiled.compiled?.format, item.filename).toBe(
        "compiled-air@1-experimental",
      );
      for (const meter of compiled.compiled?.meterChanges ?? [])
        meters.add(meter.meter);
      eventCounts.push(compiled.compiled?.events.length ?? 0);
      hasPickup ||= (compiled.compiled?.pickupBeats ?? 0) > 0;
      hasGroove ||= (compiled.compiled?.groovesUsed.length ?? 0) > 0;
      hasPhrase ||= (compiled.compiled?.phraseOccurrences.length ?? 0) > 0;
      hasTechnique ||= (compiled.compiled?.techniquesUsed.length ?? 0) > 0;
      hasPackVoice ||=
        compiled.compiled?.events.some(
          (event) => event.instrument === "prismatic_voice",
        ) ?? false;
    }
    expect(meters).toEqual(new Set(["3/4", "4/4", "5/8", "6/8", "7/8"]));
    expect({
      hasPickup,
      hasGroove,
      hasPhrase,
      hasTechnique,
      hasPackVoice,
    }).toEqual({
      hasPickup: true,
      hasGroove: true,
      hasPhrase: true,
      hasTechnique: true,
      hasPackVoice: true,
    });
    expect(Math.max(...eventCounts)).toBeGreaterThan(
      Math.min(...eventCounts) * 4,
    );
  });
});
