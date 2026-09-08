import { describe, expect, it } from "vitest";
import {
  AIR_V1_FORMAT,
  createAirVocabularyClosure,
  type AirSourceV1,
} from "@refrain/air-schema/v1";
import { CORE_AUTHORING_VOCABULARY } from "@refrain/soundpack/vnext";
import {
  COMPLETE_PIECE_PERFORMANCE_BINDING,
  F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
} from "@refrain/soundpack";
import { createRefrainArtifactV3 } from "@refrain/renderer/portable";
import { sourceReceiptIntegrityErrorsV1 } from "@refrain/renderer/v1";
import { receiptSchemaV1 } from "./contract-v1.js";
import { humV1 } from "./hum-v1.js";

function air(transpose = 0): AirSourceV1 {
  return {
    format: AIR_V1_FORMAT,
    title: transpose === 0 ? "Parent" : "Child",
    conductor: { tempo: 72, meters: [{ bar: 1, meter: "4/4" }] },
    vocabulary: createAirVocabularyClosure({
      id: CORE_AUTHORING_VOCABULARY.id,
      instruments: CORE_AUTHORING_VOCABULARY.instruments.map((instrument) => ({
        id: instrument.id,
        label: instrument.label,
        family: instrument.family,
        midiMin: instrument.midiMin,
        midiMax: instrument.midiMax,
        status: instrument.status,
        authoringMeaning: instrument.authoringMeaning,
        ...(instrument.supportedNotes === undefined
          ? {}
          : { supportedNotes: Array.from(instrument.supportedNotes) }),
      })),
      techniques: [],
    }),
    motifs: { hello: "C4/4 D4/4 E4/4 G4/4" },
    voices: [
      {
        id: "lead",
        instrument: "warm_piano",
        role: "lead",
        realize: [
          {
            id: "hello",
            kind: "motif",
            motif: "hello",
            ...(transpose === 0 ? {} : { transform: { transpose } }),
          },
        ],
      },
    ],
    sections: [{ id: "whole", startBar: 1, bars: 1 }],
  };
}

describe("hum AIR@1", () => {
  function expectReproducible(result: ReturnType<typeof humV1>): void {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      sourceReceiptIntegrityErrorsV1(result.source, result.receipt),
    ).toEqual([]);
    expect(receiptSchemaV1.safeParse(result.receipt).success).toBe(true);
  }

  it("returns one complete AIR@1 source, summary, root receipt, and exact sound status", () => {
    const result = humV1({ air: air() });
    expect(result).toMatchObject({
      ok: true,
      source: { format: AIR_V1_FORMAT },
      summary: {
        format: "compiled-air-summary@1-experimental",
        eventCount: 4,
        meters: [{ bar: 1, meter: "4/4", startBeat: 0 }],
      },
      receipt: {
        format: "refrain-receipt@1-experimental",
        verification: { status: "not_applicable" },
      },
      performanceStatus: { status: "available" },
    });
    expectReproducible(result);
  });

  it("uses a host default only when the caller omits an explicit exact binding", () => {
    const defaulted = humV1(
      { air: air() },
      {
        defaultPerformanceBindingId: F_SYNTHETIC_BEAT_PERFORMANCE_BINDING.id,
      },
    );
    expect(defaulted).toMatchObject({
      ok: true,
      performanceBinding: { id: "f-synthetic-beat@0" },
    });

    const explicit = humV1(
      {
        air: air(),
        performance: {
          bindingId: COMPLETE_PIECE_PERFORMANCE_BINDING.id,
        },
      },
      {
        defaultPerformanceBindingId: F_SYNTHETIC_BEAT_PERFORMANCE_BINDING.id,
      },
    );
    expect(explicit).toMatchObject({
      ok: true,
      performanceBinding: { id: "complete-piece-engineering@0" },
    });
  });

  it("verifies a transformed continuation instead of accepting a relation label", () => {
    const parent = humV1({ air: air() });
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    const parentArtifact = createRefrainArtifactV3({
      source: parent.source,
      receipt: parent.receipt,
      ...(parent.performanceBinding
        ? { performanceBinding: parent.performanceBinding }
        : {}),
    });
    const child = humV1({
      air: air(2),
      from: {
        parentArtifact,
        relation: "variation",
        evidence: {
          motifLinks: [
            {
              parent: "hello",
              child: "hello",
              parentAnchor: "lead:hello:1:hello",
              childAnchor: "lead:hello:1:hello",
              transform: {
                transpose: 2,
                stretch: 1,
                invert: false,
                retrograde: false,
              },
            },
          ],
        },
      },
    });
    expect(child).toMatchObject({
      ok: true,
      receipt: {
        verification: {
          contract: "musical-relation@1-experimental",
          status: "verified",
        },
      },
    });
    expectReproducible(child);
  });

  it("derives embodiment digests from two exact bindings and both source instrument sets", () => {
    const parent = humV1({ air: air() });
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    const parentArtifact = createRefrainArtifactV3({
      source: parent.source,
      receipt: parent.receipt,
      performanceBinding: COMPLETE_PIECE_PERFORMANCE_BINDING,
    });
    const child = humV1({
      air: air(2),
      from: {
        parentArtifact,
        relation: "variation",
        evidence: {
          motifLinks: [
            {
              parent: "hello",
              child: "hello",
              parentAnchor: "lead:hello:1:hello",
              childAnchor: "lead:hello:1:hello",
              transform: {
                transpose: 2,
                stretch: 1,
                invert: false,
                retrograde: false,
              },
            },
          ],
        },
        embodiment: {
          instrumentMap: [
            {
              parentInstrument: "warm_piano",
              childInstrument: "warm_piano",
            },
          ],
        },
      },
    });
    expect(child).toMatchObject({
      ok: true,
      receipt: {
        embodiment: {
          parentPerformanceBindingDigest: `sha256:${COMPLETE_PIECE_PERFORMANCE_BINDING.contentSha256}`,
          childPerformanceBindingDigest: `sha256:${COMPLETE_PIECE_PERFORMANCE_BINDING.contentSha256}`,
        },
      },
    });
    expectReproducible(child);

    const tampered = structuredClone(parentArtifact);
    const binding = tampered.performanceBindings[0];
    if (binding?.renderScene.format === "refrain-render-scene@0-experimental")
      binding.renderScene.masterGainDb -= 1;
    const rejected = humV1({
      air: air(2),
      from: {
        parentArtifact: tampered,
        relation: "variation",
        evidence: {
          motifLinks: [
            {
              parent: "hello",
              child: "hello",
              parentAnchor: "lead:hello:1:hello",
              childAnchor: "lead:hello:1:hello",
              transform: {
                transpose: 2,
                stretch: 1,
                invert: false,
                retrograde: false,
              },
            },
          ],
        },
        embodiment: {
          instrumentMap: [
            {
              parentInstrument: "warm_piano",
              childInstrument: "warm_piano",
            },
          ],
        },
      },
    });
    expect(rejected).toMatchObject({
      ok: false,
      diagnostics: [{ code: "invalid_parent_artifact" }],
    });
  });

  it("keeps canonical music valid when an extension instrument lacks exact runtime sound", () => {
    const packed = air();
    packed.vocabulary = createAirVocabularyClosure({
      id: packed.vocabulary.id,
      instruments: [
        ...packed.vocabulary.instruments,
        {
          id: "pack_voice",
          label: "Pack voice",
          family: "pitched",
          midiMin: 0,
          midiMax: 127,
          status: "active",
          authoringMeaning: "A carried extension voice.",
        },
      ],
      techniques: packed.vocabulary.techniques,
    });
    packed.voices[0]!.instrument = "pack_voice";
    const result = humV1({ air: packed });
    expect(result).toMatchObject({
      ok: true,
      performanceStatus: {
        status: "unavailable",
        reason: "instrument-vocabulary-not-installed",
      },
    });
    expectReproducible(result);
  });
});
