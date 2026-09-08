import { describe, expect, it } from "vitest";
import {
  AIR_V1_FORMAT,
  createAirVocabularyClosure,
  parseAirV1,
  type AirSourceV1,
} from "@refrain/air-schema/v1";
import { CORE_AUTHORING_VOCABULARY } from "@refrain/soundpack/vnext";
import { airObjectSchemaV1 } from "./contract-v1.js";

function validAir(): AirSourceV1 {
  return {
    format: AIR_V1_FORMAT,
    title: "Schema parity",
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
    motifs: { seed: "C4/4 D4/4 E4/4 G4/4" },
    voices: [
      {
        id: "lead",
        instrument: "warm_piano",
        role: "lead",
        realize: [{ id: "seed", kind: "motif", motif: "seed" }],
      },
    ],
    sections: [{ id: "whole", startBar: 1, bars: 1 }],
  };
}

function expectBothReject(value: unknown): void {
  expect(airObjectSchemaV1.safeParse(value).success).toBe(false);
  expect(parseAirV1(value).source).toBeUndefined();
}

describe("AIR@1 model-schema/parser parity", () => {
  it("accepts the same closed valid source", () => {
    const source = validAir();
    expect(airObjectSchemaV1.safeParse(source).success).toBe(true);
    expect(parseAirV1(source).source).toBeDefined();
  });

  it("rejects parser-invalid cross-field mutations at the model boundary", () => {
    const cases: unknown[] = [];

    const hugeMeter = structuredClone(validAir());
    hugeMeter.conductor.meters.push({ bar: 1_000_000_000_000, meter: "3/4" });
    cases.push(hugeMeter);

    const sectionOverflow = structuredClone(validAir());
    sectionOverflow.sections = [{ id: "late", startBar: 256, bars: 2 }];
    cases.push(sectionOverflow);

    const dynamicOrder = structuredClone(validAir());
    dynamicOrder.voices[0]!.realize![0]!.dynamicCurve = {
      from: "p",
      via: [
        { at: 0.8, level: "mf" },
        { at: 0.2, level: "f" },
      ],
      to: "ff",
    };
    cases.push(dynamicOrder);

    const unequalDrumLanes = structuredClone(validAir());
    unequalDrumLanes.voices[0]!.realize = [
      {
        id: "grid",
        kind: "drum_grid",
        resolution: 16,
        lanes: [
          { note: "C2", pattern: "x..." },
          { note: "D2", pattern: "x......." },
        ],
      },
    ];
    cases.push(unequalDrumLanes);

    const badThin = structuredClone(validAir());
    badThin.vocabulary = createAirVocabularyClosure({
      id: badThin.vocabulary.id,
      instruments: badThin.vocabulary.instruments,
      techniques: [
        {
          id: "bad_thin",
          label: "Bad thin",
          appliesTo: ["motif"],
          operations: [{ type: "thin", every: 2, offset: 2 }],
        },
      ],
    });
    cases.push(badThin);

    const badFactor = structuredClone(validAir());
    badFactor.vocabulary = createAirVocabularyClosure({
      id: badFactor.vocabulary.id,
      instruments: badFactor.vocabulary.instruments,
      techniques: [
        {
          id: "bad_scale",
          label: "Bad scale",
          appliesTo: ["motif"],
          operations: [
            {
              type: "time-scale",
              factor: { numerator: 5, denominator: 1 },
            },
          ],
        },
      ],
    });
    cases.push(badFactor);

    const duplicateNotes = structuredClone(validAir());
    duplicateNotes.vocabulary = createAirVocabularyClosure({
      id: duplicateNotes.vocabulary.id,
      instruments: duplicateNotes.vocabulary.instruments.map(
        (instrument, index) =>
          index === 0
            ? { ...instrument, supportedNotes: [60, 60] }
            : instrument,
      ),
      techniques: duplicateNotes.vocabulary.techniques,
    });
    cases.push(duplicateNotes);

    for (const value of cases) expectBothReject(value);
  });
});
