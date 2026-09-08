import { describe, expect, it } from "vitest";
import { AIR_FORMAT, MAX_BARS, type AirSource } from "./index.js";
import {
  AIR_V1_FORMAT,
  canonicalAirV1Json,
  createAirVocabularyClosure,
  migrateAirV0ToV1,
  parseAirV1,
  type AirSourceV1,
  type AirVocabularyClosure,
} from "./v1.js";

export const TEST_VOCABULARY: AirVocabularyClosure = createAirVocabularyClosure(
  {
    id: "fixture-language@0",
    instruments: [
      {
        id: "warm_piano",
        label: "Warm piano",
        family: "pitched",
        midiMin: 21,
        midiMax: 108,
        status: "active",
        authoringMeaning: "A warm pitched keyboard voice.",
      },
    ],
    techniques: [
      {
        id: "ghost_return",
        label: "Ghost return",
        appliesTo: ["motif", "phrase"],
        operations: [
          {
            type: "velocity-scale",
            factor: { numerator: 2, denominator: 3 },
          },
          {
            type: "gate-scale",
            factor: { numerator: 3, denominator: 4 },
          },
        ],
      },
    ],
  },
);

export const VALID_AIR_V1: AirSourceV1 = {
  format: AIR_V1_FORMAT,
  title: "A crooked little return",
  conductor: {
    tempo: 96,
    pickup: { numerator: 1, denominator: 2 },
    meters: [
      { bar: 1, meter: "5/8" },
      { bar: 3, meter: "7/8" },
    ],
  },
  key: "D minor",
  vocabulary: TEST_VOCABULARY,
  motifs: {
    seed: "D4/8 F4/8 A4/8",
  },
  grooves: [
    {
      id: "held_second",
      cycle: { numerator: 1, denominator: 1 },
      steps: [
        {
          at: { numerator: 0, denominator: 1 },
          offset: { numerator: 0, denominator: 1 },
        },
        {
          at: { numerator: 1, denominator: 2 },
          offset: { numerator: 1, denominator: 12 },
          velocityScale: { numerator: 9, denominator: 10 },
        },
      ],
    },
  ],
  harmony: [
    {
      id: "room",
      chords: [
        {
          symbol: "Dm7",
          duration: { numerator: 5, denominator: 2 },
        },
      ],
    },
  ],
  phrases: [
    {
      id: "answer",
      segments: [
        {
          id: "seed_triplet",
          kind: "motif",
          motif: "seed",
          tuplet: { notes: 3, inTimeOf: 2 },
          techniques: ["ghost_return"],
          groove: "held_second",
        },
        {
          id: "breath",
          kind: "rest",
          duration: { numerator: 3, denominator: 2 },
        },
      ],
    },
  ],
  voices: [
    {
      id: "piano",
      instrument: "warm_piano",
      role: "lead",
      realize: [
        {
          id: "opening",
          kind: "phrase",
          phrase: "answer",
          techniques: ["ghost_return"],
          transform: {
            transpose: 2,
            timeScale: { numerator: 1, denominator: 2 },
          },
        },
      ],
    },
  ],
  sections: [{ id: "return", startBar: 1, bars: 2 }],
};

describe("air@1 source contract", () => {
  it("parses the complete conductor, rational, groove, phrase, and vocabulary shape", () => {
    expect(parseAirV1(VALID_AIR_V1)).toEqual({
      source: VALID_AIR_V1,
      diagnostics: [],
    });
    expect(canonicalAirV1Json(VALID_AIR_V1)).toContain(
      '"format":"air@1-experimental"',
    );
  });

  it("rejects non-canonical rationals and unresolved portable definitions", () => {
    const nonReduced = structuredClone(VALID_AIR_V1);
    nonReduced.conductor.pickup = { numerator: 2, denominator: 4 };
    expect(parseAirV1(nonReduced).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "non_canonical_rational" }),
      ]),
    );

    const unresolved = structuredClone(VALID_AIR_V1);
    const voice = unresolved.voices[0]!;
    if (voice.realize !== undefined)
      voice.realize[0]!.techniques = ["not_installed_by_magic"];
    expect(parseAirV1(unresolved).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unresolved_technique" }),
      ]),
    );
  });

  it("bounds every conductor and section bar before compiler scheduling", () => {
    const unsafeMeter = structuredClone(VALID_AIR_V1) as unknown as Record<
      string,
      unknown
    >;
    (
      unsafeMeter.conductor as { meters: Array<{ bar: number; meter: string }> }
    ).meters[1]!.bar = 1_000_000_000_000;
    expect(parseAirV1(unsafeMeter).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "invalid_meter_map",
        path: "$.conductor.meters[1].bar",
      }),
    );

    const unsafeSection = structuredClone(VALID_AIR_V1);
    unsafeSection.sections = [
      { id: "past_horizon", startBar: MAX_BARS, bars: 2 },
    ];
    expect(parseAirV1(unsafeSection).diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid_section_length" }),
    );
  });

  it("migrates air@0 explicitly without changing the legacy parser contract", () => {
    const legacy: AirSource = {
      format: AIR_FORMAT,
      title: "Legacy hello",
      tempo: 72,
      meter: "4/4",
      motifs: { hello: "C4/4 D4/4 E4/4 G4/4" },
      voices: [
        {
          id: "piano",
          instrument: "warm_piano",
          role: "lead",
          part: "@hello",
        },
      ],
    };
    const migrated = migrateAirV0ToV1(legacy, TEST_VOCABULARY);
    expect(migrated).toMatchObject({
      format: AIR_V1_FORMAT,
      conductor: { tempo: 72, meters: [{ bar: 1, meter: "4/4" }] },
      vocabulary: TEST_VOCABULARY,
    });
    expect(parseAirV1(migrated).source).toEqual(migrated);
    expect(legacy.format).toBe(AIR_FORMAT);
  });
});
