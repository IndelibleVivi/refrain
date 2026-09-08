import { describe, expect, it } from "vitest";
import {
  AIR_V1_FORMAT,
  createAirVocabularyClosure,
  type AirSourceV1,
} from "@refrain/air-schema/v1";
import { CORE_AUTHORING_VOCABULARY } from "@refrain/soundpack/vnext";
import { createRootReceiptV1 } from "./v1.js";
import { createRefrainArtifactV3, parseRefrainArtifact } from "./portable.js";

function source(): AirSourceV1 {
  return {
    format: AIR_V1_FORMAT,
    title: "Portable one",
    conductor: { tempo: 72, meters: [{ bar: 1, meter: "4/4" }] },
    vocabulary: createAirVocabularyClosure({
      id: "portable@0",
      instruments: CORE_AUTHORING_VOCABULARY.instruments.map((instrument) => ({
        id: instrument.id,
        label: instrument.label,
        family: instrument.family,
        midiMin: instrument.midiMin,
        midiMax: instrument.midiMax,
        status: instrument.status,
        authoringMeaning: instrument.authoringMeaning,
        ...(instrument.supportedNotes
          ? { supportedNotes: Array.from(instrument.supportedNotes) }
          : {}),
      })),
      techniques: [],
    }),
    motifs: {},
    voices: [
      {
        id: "lead",
        instrument: "warm_piano",
        role: "lead",
        part: "C4/1",
      },
    ],
  };
}

describe("RefrainArtifact@3", () => {
  it("round-trips AIR@1 without weakening the historical readers", () => {
    const air = source();
    const artifact = createRefrainArtifactV3({
      source: air,
      receipt: createRootReceiptV1(air),
      performanceBindings: [],
    });
    expect(parseRefrainArtifact(artifact)).toMatchObject({
      ok: true,
      artifact: { format: "refrain-artifact@3-experimental" },
      continuity: "valid",
    });
    expect(
      parseRefrainArtifact({
        ...artifact,
        source: { ...air, title: "tampered" },
      }),
    ).toMatchObject({ ok: false });
  });
});
