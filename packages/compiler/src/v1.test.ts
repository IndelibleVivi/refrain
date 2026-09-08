import { describe, expect, it } from "vitest";
import {
  AIR_V1_FORMAT,
  createAirVocabularyClosure,
  type AirSourceV1,
} from "@refrain/air-schema/v1";
import { MAX_SCORE_SECONDS } from "@refrain/air-schema";
import { TEST_VOCABULARY } from "../../air-schema/src/v1.test.js";
import { compileAirV1 } from "./v1.js";

function source(): AirSourceV1 {
  return {
    format: AIR_V1_FORMAT,
    title: "Five, five, seven",
    conductor: {
      tempo: 90,
      pickup: { numerator: 1, denominator: 2 },
      meters: [
        { bar: 1, meter: "5/8" },
        { bar: 3, meter: "7/8" },
      ],
    },
    key: "D minor",
    vocabulary: TEST_VOCABULARY,
    motifs: { seed: "D4/8 F4/8 A4/8" },
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
            at: { numerator: 1, denominator: 3 },
            offset: { numerator: 1, denominator: 12 },
            velocityScale: { numerator: 9, denominator: 10 },
          },
        ],
      },
    ],
    phrases: [
      {
        id: "answer",
        segments: [
          {
            id: "triplet",
            kind: "motif",
            motif: "seed",
            tuplet: { notes: 3, inTimeOf: 2 },
          },
          {
            id: "breath",
            kind: "rest",
            duration: { numerator: 1, denominator: 2 },
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
          { id: "pickup", kind: "literal", part: "D4/8" },
          {
            id: "answers",
            kind: "phrase",
            phrase: "answer",
            repeat: 4,
            techniques: ["ghost_return"],
            groove: "held_second",
            transform: { transpose: 2 },
          },
          {
            id: "tail",
            kind: "rest",
            duration: { numerator: 5, denominator: 2 },
          },
        ],
      },
    ],
    sections: [
      { id: "five", startBar: 1, bars: 2 },
      { id: "seven", startBar: 3, bars: 1 },
    ],
  };
}

describe("AIR@1 compiler", () => {
  it("compiles pickup, meter changes, tuplets, phrase reuse, techniques, and groove", () => {
    const result = compileAirV1(source());
    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(result.compiled).toMatchObject({
      format: "compiled-air@1-experimental",
      sourceFormat: AIR_V1_FORMAT,
      durationBeats: 9,
      durationSeconds: 6,
      pickupBeats: 0.5,
      meterChanges: [
        { bar: 1, meter: "5/8", startBeat: 0 },
        { bar: 3, meter: "7/8", startBeat: 5.5 },
      ],
      sections: [
        { id: "five", startBeat: 0.5, endBeat: 5.5 },
        { id: "seven", startBeat: 5.5, endBeat: 9 },
      ],
    });
    expect(result.compiled?.phraseOccurrences).toHaveLength(4);
    expect(result.compiled?.motifOccurrences).toHaveLength(4);
    expect(result.compiled?.motifOccurrences[0]).toMatchObject({
      motif: "seed",
      transpose: 2,
      stretch: 2 / 3,
    });
    expect(
      result.compiled?.events.find(
        (event) => Math.abs((event.timingOffsetBeats ?? 0) - 1 / 12) < 1e-9,
      ),
    ).toBeDefined();
    expect(result.compiled?.events[1]?.velocity).toBeLessThan(0.68);
  });

  it("rejects a structured voice that does not close over pickup plus whole mapped bars", () => {
    const invalid = source();
    const voice = invalid.voices[0]!;
    if (voice.realize) voice.realize.pop();
    expect(compileAirV1(invalid).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "voice_bar_alignment" }),
      ]),
    );
  });

  it("uses the carried vocabulary rather than a global instrument allowlist", () => {
    const packed = source();
    packed.vocabulary = createAirVocabularyClosure({
      id: packed.vocabulary.id,
      instruments: [
        {
          ...packed.vocabulary.instruments[0]!,
          id: "pack_voice",
          label: "Pack voice",
        },
      ],
      techniques: packed.vocabulary.techniques,
    });
    packed.voices[0]!.instrument = "pack_voice";
    expect(compileAirV1(packed).compiled?.events[0]?.instrument).toBe(
      "pack_voice",
    );
  });

  it("rejects a future meter entry without iterating through its bar number", () => {
    const invalid = source();
    invalid.conductor = {
      tempo: 90,
      meters: [
        { bar: 1, meter: "4/4" },
        { bar: 257, meter: "3/4" },
      ],
    };
    invalid.voices = [
      {
        id: "piano",
        instrument: "warm_piano",
        role: "lead",
        realize: [
          {
            id: "one_bar",
            kind: "rest",
            duration: { numerator: 4, denominator: 1 },
          },
        ],
      },
    ];
    invalid.sections = undefined;

    expect(compileAirV1(invalid).diagnostics).toContainEqual(
      expect.objectContaining({ code: "meter_change_out_of_range" }),
    );
  });

  it("enforces the shared 480-second guard at both sides of the boundary", () => {
    const durationSource = (durationSeconds: number): AirSourceV1 => ({
      format: AIR_V1_FORMAT,
      title: `Duration ${durationSeconds}`,
      conductor: {
        tempo: (480 * 60) / durationSeconds,
        meters: [{ bar: 1, meter: "4/4" }],
      },
      vocabulary: TEST_VOCABULARY,
      motifs: {},
      voices: [
        {
          id: "piano",
          instrument: "warm_piano",
          role: "lead",
          realize: [
            {
              id: "first_half",
              kind: "rest",
              duration: { numerator: 240, denominator: 1 },
            },
            {
              id: "second_half",
              kind: "rest",
              duration: { numerator: 240, denominator: 1 },
            },
          ],
        },
      ],
    });

    expect(
      compileAirV1(durationSource(479.999)).compiled?.durationSeconds,
    ).toBeCloseTo(479.999, 6);
    expect(
      compileAirV1(durationSource(MAX_SCORE_SECONDS)).compiled?.durationSeconds,
    ).toBe(MAX_SCORE_SECONDS);
    expect(
      compileAirV1(durationSource(MAX_SCORE_SECONDS + 0.001)).diagnostics,
    ).toContainEqual(expect.objectContaining({ code: "duration_limit" }));
  });

  it("rejects cross-phrase expansion before cloning the parent repeats", () => {
    const hostile: AirSourceV1 = {
      format: AIR_V1_FORMAT,
      title: "Bounded hostile phrase reuse",
      conductor: {
        tempo: 220,
        meters: [{ bar: 1, meter: "4/4" }],
      },
      vocabulary: TEST_VOCABULARY,
      motifs: {
        seed: Array.from({ length: 64 }, () => "C4/8").join(" "),
      },
      phrases: [
        {
          id: "wide",
          segments: Array.from({ length: 8 }, (_, index) => ({
            id: `return_${index + 1}`,
            kind: "motif" as const,
            motif: "seed",
            repeat: 16,
          })),
        },
      ],
      voices: [
        {
          id: "piano",
          instrument: "warm_piano",
          role: "lead",
          realize: [
            {
              id: "too_many_returns",
              kind: "phrase",
              phrase: "wide",
              repeat: 16,
            },
          ],
        },
      ],
    };

    const result = compileAirV1(hostile);
    expect(result.compiled).toBeUndefined();
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "expanded_atom_limit",
      ),
    ).toHaveLength(1);
  });

  it("resolves phrase-child repeats and carries distinct anchors through expansion", () => {
    const tied: AirSourceV1 = {
      format: AIR_V1_FORMAT,
      title: "Three held returns",
      conductor: { tempo: 60, meters: [{ bar: 1, meter: "4/4" }] },
      vocabulary: TEST_VOCABULARY,
      motifs: { seed: "C4/4" },
      phrases: [
        {
          id: "chain",
          segments: [
            {
              id: "held",
              kind: "motif",
              motif: "seed",
              repeat: 2,
              tieToNext: true,
            },
            { id: "arrival", kind: "motif", motif: "seed" },
          ],
        },
      ],
      voices: [
        {
          id: "piano",
          instrument: "warm_piano",
          role: "lead",
          realize: [
            { id: "chain_once", kind: "phrase", phrase: "chain" },
            {
              id: "close",
              kind: "rest",
              duration: { numerator: 1, denominator: 1 },
            },
          ],
        },
      ],
    };

    const result = compileAirV1(tied);
    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(result.compiled?.events).toHaveLength(1);
    expect(result.compiled?.events[0]).toMatchObject({
      midi: 60,
      durationBeats: 3,
      soundingDurationBeats: 3,
    });
    expect(
      new Set(result.compiled?.motifOccurrences.map(({ anchor }) => anchor)),
    ).toHaveProperty("size", 3);
    const heldAnchors = result.compiled?.segments
      .filter(({ sourceSegmentId }) => sourceSegmentId === "held")
      .map(({ anchor }) => anchor);
    expect(new Set(heldAnchors).size).toBe(2);
  });

  it("binds every phrase-repeated event to its exact motif occurrence", () => {
    const repeated: AirSourceV1 = {
      format: AIR_V1_FORMAT,
      title: "Three returns",
      conductor: { tempo: 60, meters: [{ bar: 1, meter: "4/4" }] },
      vocabulary: TEST_VOCABULARY,
      motifs: { seed: "C4/4" },
      phrases: [
        {
          id: "return",
          segments: [{ id: "seed", kind: "motif", motif: "seed", repeat: 3 }],
        },
      ],
      voices: [
        {
          id: "piano",
          instrument: "warm_piano",
          role: "lead",
          realize: [
            { id: "returns", kind: "phrase", phrase: "return" },
            {
              id: "close",
              kind: "rest",
              duration: { numerator: 1, denominator: 1 },
            },
          ],
        },
      ],
    };

    const result = compileAirV1(repeated);
    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(
      result.compiled?.motifOccurrences.map(({ occurrence }) => occurrence),
    ).toEqual([1, 2, 3]);
    expect(
      result.compiled?.events.map(({ motifOccurrence }) => motifOccurrence),
    ).toEqual([1, 2, 3]);
  });

  it("keeps a boundary tie aligned with the performed groove timeline", () => {
    const grooved: AirSourceV1 = {
      format: AIR_V1_FORMAT,
      title: "Late tied arrival",
      conductor: { tempo: 60, meters: [{ bar: 1, meter: "4/4" }] },
      vocabulary: TEST_VOCABULARY,
      motifs: {},
      grooves: [
        {
          id: "late",
          cycle: { numerator: 1, denominator: 1 },
          steps: [
            {
              at: { numerator: 0, denominator: 1 },
              offset: { numerator: 1, denominator: 8 },
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
            { id: "held", kind: "literal", part: "C4/4", tieToNext: true },
            { id: "arrival", kind: "literal", part: "C4/4", groove: "late" },
            {
              id: "close",
              kind: "rest",
              duration: { numerator: 2, denominator: 1 },
            },
          ],
        },
      ],
    };

    const result = compileAirV1(grooved);
    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(result.compiled?.events).toHaveLength(1);
    expect(result.compiled?.events[0]).toMatchObject({
      startBeat: 0,
      notatedStartBeat: 0,
      durationBeats: 2,
      soundingDurationBeats: 2.125,
    });
  });

  it("compiles the legal 256-bar tie-heavy event envelope within a bounded gate", () => {
    const notes = "C4/8 D4/8 E4/8 F4/8 G4/8 A4/8 B4/8 C4/8";
    const upperEnvelope: AirSourceV1 = {
      format: AIR_V1_FORMAT,
      title: "AIR@1 tie envelope",
      conductor: { tempo: 128, meters: [{ bar: 1, meter: "4/4" }] },
      vocabulary: TEST_VOCABULARY,
      motifs: {},
      phrases: [
        {
          id: "sixteen-bars",
          segments: [
            {
              id: "tied-bars",
              kind: "literal",
              part: notes,
              repeat: 15,
              tieToNext: true,
            },
            { id: "last-bar", kind: "literal", part: notes },
          ],
        },
      ],
      voices: Array.from({ length: 12 }, (_, index) => ({
        id: `voice-${index + 1}`,
        instrument: "warm_piano",
        role: index === 0 ? ("lead" as const) : ("texture" as const),
        realize: [
          {
            id: "whole-piece",
            kind: "phrase" as const,
            phrase: "sixteen-bars",
            repeat: 16,
          },
        ],
      })),
    };

    const started = performance.now();
    const result = compileAirV1(upperEnvelope);
    const elapsedMs = performance.now() - started;

    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(result.compiled).toMatchObject({ bars: 256, durationSeconds: 480 });
    expect(result.compiled?.events).toHaveLength(21_696);
    expect(elapsedMs).toBeLessThan(2_000);
  });

  it.each([
    {
      name: "phrase to segment",
      realize: [
        { id: "parent", kind: "phrase" as const, phrase: "outgoing" },
        { id: "arrival", kind: "motif" as const, motif: "seed" },
        {
          id: "rest",
          kind: "rest" as const,
          duration: { numerator: 2, denominator: 1 },
        },
      ],
    },
    {
      name: "segment to phrase",
      realize: [
        {
          id: "departure",
          kind: "motif" as const,
          motif: "seed",
          tieToNext: true,
        },
        { id: "parent", kind: "phrase" as const, phrase: "incoming" },
        {
          id: "rest",
          kind: "rest" as const,
          duration: { numerator: 2, denominator: 1 },
        },
      ],
    },
  ])(
    "resolves $name boundary ties on the global voice schedule",
    ({ realize }) => {
      const tied: AirSourceV1 = {
        format: AIR_V1_FORMAT,
        title: "Boundary handoff",
        conductor: { tempo: 60, meters: [{ bar: 1, meter: "4/4" }] },
        vocabulary: TEST_VOCABULARY,
        motifs: { seed: "C4/4" },
        phrases: [
          {
            id: "outgoing",
            segments: [
              {
                id: "held",
                kind: "motif",
                motif: "seed",
                tieToNext: true,
              },
            ],
          },
          {
            id: "incoming",
            segments: [{ id: "return", kind: "motif", motif: "seed" }],
          },
        ],
        voices: [
          {
            id: "piano",
            instrument: "warm_piano",
            role: "lead",
            realize,
          },
        ],
      };
      const result = compileAirV1(tied);
      expect(result.diagnostics).not.toContainEqual(
        expect.objectContaining({ code: "dangling_tie" }),
      );
      expect(result.compiled?.events[0]?.durationBeats).toBe(2);
    },
  );

  it("rejects pitch-mismatched and voice-ending boundary ties", () => {
    const mismatch = source();
    mismatch.conductor = { tempo: 60, meters: [{ bar: 1, meter: "4/4" }] };
    mismatch.motifs = { seed: "C4/4", other: "D4/4" };
    mismatch.phrases = undefined;
    mismatch.sections = undefined;
    mismatch.voices = [
      {
        id: "piano",
        instrument: "warm_piano",
        role: "lead",
        realize: [
          {
            id: "departure",
            kind: "motif",
            motif: "seed",
            tieToNext: true,
          },
          { id: "wrong_pitch", kind: "motif", motif: "other" },
          {
            id: "rest",
            kind: "rest",
            duration: { numerator: 2, denominator: 1 },
          },
        ],
      },
    ];
    expect(compileAirV1(mismatch).diagnostics).toContainEqual(
      expect.objectContaining({ code: "dangling_tie" }),
    );

    const ending = structuredClone(mismatch);
    ending.voices[0]!.realize = [
      {
        id: "held_to_end",
        kind: "literal",
        part: "C4/1",
        tieToNext: true,
      },
    ];
    expect(compileAirV1(ending).diagnostics).toContainEqual(
      expect.objectContaining({ code: "dangling_tie" }),
    );
  });
});
