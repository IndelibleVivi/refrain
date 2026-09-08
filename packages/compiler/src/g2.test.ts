import { describe, expect, it } from "vitest";
import { compileAir, parseChordSymbol } from "./index.js";

const structuredAir = {
  format: "air@0-experimental",
  title: "Harmony in motion",
  tempo: 84,
  meter: "4/4",
  motifs: { turn: "D4/4 E4/4 F4/4 G4/4" },
  harmony: [
    {
      id: "verse",
      chords: [
        { symbol: "Dm7", beats: 2 },
        { symbol: "G7/B", beats: 2, inversion: 1 },
      ],
    },
  ],
  voices: [
    {
      id: "keys",
      instrument: "warm_piano",
      role: "harmony",
      realize: [
        {
          id: "keys-a",
          kind: "chords",
          harmony: "verse",
          voicing: "close",
          register: { min: "C3", max: "C5" },
          rhythm: [1],
          voiceLeading: "nearest",
          dynamicCurve: { from: "p", to: "f" },
          articulation: "staccato",
          section: "A",
        },
      ],
    },
    {
      id: "arp",
      instrument: "harp",
      role: "counter",
      realize: [
        {
          id: "arp-a",
          kind: "arpeggio",
          harmony: "verse",
          degrees: [1, 3, 5, 7],
          stepBeats: 0.5,
          octaveSpan: 2,
          register: { min: "C3", max: "C6" },
        },
      ],
    },
    {
      id: "bass",
      instrument: "clean_bass",
      role: "bass",
      realize: [
        {
          id: "bass-a",
          kind: "bass",
          harmony: "verse",
          degrees: [1, 5],
          stepBeats: 1,
          register: { min: "C2", max: "C4" },
          slashBass: "honor",
        },
      ],
    },
  ],
} as const;

describe("G2 compiler", () => {
  it("parses the closed chord vocabulary with inversion and slash bass", () => {
    expect(parseChordSymbol("C")).toMatchObject({ intervals: [0, 4, 7] });
    expect(parseChordSymbol("F#m7b5")).toMatchObject({
      intervals: [0, 3, 6, 10],
    });
    expect(parseChordSymbol("G7/B", 1)).toMatchObject({
      rootPitchClass: 7,
      inversion: 1,
      slashBassPitchClass: 11,
    });
    expect(parseChordSymbol("G13")).toBeUndefined();
    expect(parseChordSymbol("G7/C")).toBeUndefined();
  });

  it("realizes harmony deterministically with anchors, curves, and shared gates", () => {
    const first = compileAir(structuredAir);
    const second = compileAir(structuredAir);
    expect(
      first.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(first.compiled).toEqual(second.compiled);
    expect(first.compiled?.durationBeats).toBe(4);
    const keys = first.compiled!.events.filter(
      (event) => event.voiceId === "keys",
    );
    expect(keys[0]).toMatchObject({
      articulation: "staccato",
      gate: 0.5,
      durationBeats: 1,
      soundingDurationBeats: 0.5,
      source: {
        authoring: "realize",
        segmentId: "keys-a",
        segmentIndex: 0,
        repeatIndex: 0,
        section: "A",
      },
    });
    expect(keys[0]!.velocity).toBeCloseTo(0.4);
    expect(keys.at(-1)!.velocity).toBeCloseTo(0.82);
    expect(keys.every((event) => event.midi >= 48 && event.midi <= 72)).toBe(
      true,
    );
    expect(
      first.compiled!.events.filter((event) => event.voiceId === "arp"),
    ).toHaveLength(8);
    expect(
      first.compiled!.events.filter((event) => event.voiceId === "bass"),
    ).toHaveLength(4);
    expect(first.compiled!.segments[0]).toMatchObject({
      anchor: "keys:keys-a:r1",
      startBeat: 0,
      endBeat: 4,
      expression: { articulation: "staccato", gate: 0.5 },
    });
  });

  it("applies explicit inversion/retrograde and merges a valid segment tie", () => {
    const transformed = compileAir({
      ...structuredAir,
      voices: [
        {
          id: "lead",
          instrument: "warm_piano",
          role: "lead",
          realize: [
            {
              id: "turn-back",
              kind: "motif",
              motif: "turn",
              transform: { inversion: true, retrograde: true },
            },
          ],
        },
      ],
    });
    expect(transformed.compiled?.events.map((event) => event.midi)).toEqual([
      57, 59, 60, 62,
    ]);
    expect(transformed.compiled?.motifOccurrences[0]).toMatchObject({
      motif: "turn",
      inversion: true,
      retrograde: true,
      segmentId: "turn-back",
    });

    const tied = compileAir({
      ...structuredAir,
      voices: [
        {
          id: "lead",
          instrument: "warm_piano",
          role: "lead",
          realize: [
            { id: "held-a", kind: "literal", part: "C4/2", tieToNext: true },
            {
              id: "held-b",
              kind: "literal",
              part: "C4/2",
              articulation: "tenuto",
            },
          ],
        },
      ],
    });
    expect(tied.compiled?.events).toHaveLength(1);
    expect(tied.compiled?.events[0]).toMatchObject({
      durationBeats: 4,
      soundingDurationBeats: 3.9,
    });
  });

  it("fails invalid harmony, rhythm fill, and dangling ties without rewriting", () => {
    const invalid = compileAir({
      ...structuredAir,
      harmony: [{ id: "bad", chords: [{ symbol: "G13", beats: 4 }] }],
      voices: [
        {
          id: "keys",
          instrument: "warm_piano",
          role: "harmony",
          realize: [
            {
              id: "bad-chords",
              kind: "chords",
              harmony: "bad",
              voicing: "close",
              register: { min: "C3", max: "C5" },
              rhythm: [3],
              tieToNext: true,
            },
          ],
        },
      ],
    });
    expect(invalid.compiled).toBeUndefined();
    expect(invalid.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_chord_symbol" }),
        expect.objectContaining({ code: "invalid_rhythm_fill" }),
        expect.objectContaining({ code: "dangling_tie" }),
      ]),
    );
  });

  it("validates every bar inside a structured literal independently", () => {
    const valid = compileAir({
      ...structuredAir,
      voices: [
        {
          id: "lead",
          instrument: "warm_piano",
          role: "lead",
          realize: [
            {
              id: "two-bars",
              kind: "literal",
              part: "C4/1 | D4/1",
            },
          ],
        },
      ],
    });
    expect(valid.compiled?.durationBeats).toBe(8);

    const invalid = compileAir({
      ...structuredAir,
      voices: [
        {
          id: "lead",
          instrument: "warm_piano",
          role: "lead",
          realize: [
            {
              id: "bad-bars",
              kind: "literal",
              part: "C4/2 | D4/2 E4/2 F4/2",
            },
          ],
        },
      ],
    });
    expect(invalid.compiled).toBeUndefined();
    expect(invalid.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "measure_underflow",
          path: "$.voices[0].realize[0].part#bar1",
        }),
        expect.objectContaining({
          code: "measure_overflow",
          path: "$.voices[0].realize[0].part#bar2",
        }),
      ]),
    );
  });

  it("interpolates dynamic curves by musical onset and publishes normalized motif material", () => {
    const result = compileAir({
      ...structuredAir,
      motifs: { uneven: "[E4,C4,G4]/2 r/8 D4/8 E4/4" },
      voices: [
        {
          id: "lead",
          instrument: "warm_piano",
          role: "lead",
          realize: [
            {
              id: "uneven-curve",
              kind: "motif",
              motif: "uneven",
              dynamicCurve: { from: "p", to: "f" },
            },
          ],
        },
      ],
    });
    expect(result.compiled).toBeDefined();
    const attacks = result.compiled!.events.filter(
      (event) => event.voiceId === "lead",
    );
    expect(attacks[0]?.velocity).toBeCloseTo(0.4);
    expect(attacks[3]?.velocity).toBeCloseTo(0.4 + (0.82 - 0.4) * (2.5 / 3));
    expect(attacks.at(-1)?.velocity).toBeCloseTo(0.82);
    expect(result.compiled!.motifOccurrences[0]?.material).toEqual([
      { relativeStartBeat: 0, durationBeats: 2, notes: [64, 60, 67] },
      { relativeStartBeat: 2, durationBeats: 0.5, notes: [] },
      { relativeStartBeat: 2.5, durationBeats: 0.5, notes: [62] },
      { relativeStartBeat: 3, durationBeats: 1, notes: [64] },
    ]);
  });

  it("lowers a multipoint phrase contour without fragmenting its motif occurrence", () => {
    const result = compileAir({
      ...structuredAir,
      motifs: { breath: "C5/4 D5/4 E5/4 F5/4" },
      voices: [
        {
          id: "flute",
          instrument: "flute",
          role: "lead",
          realize: [
            {
              id: "breath-curve",
              kind: "motif",
              motif: "breath",
              repeat: 2,
              dynamicCurve: {
                from: "p",
                via: [
                  { at: 1 / 3, level: "f" },
                  { at: 2 / 3, level: "pp" },
                ],
                to: "mf",
              },
            },
          ],
        },
      ],
    });
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      ),
    ).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "motif_returns", severity: "note" }),
    );
    const velocities = result.compiled!.events.map((event) => event.velocity);
    expect(velocities).toEqual([0.4, 0.82, 0.28, 0.68, 0.4, 0.82, 0.28, 0.68]);
    expect(result.compiled!.motifOccurrences).toHaveLength(2);
    expect(result.compiled!.segments[0]?.expression.dynamicCurve).toEqual({
      from: "p",
      via: [
        { at: 1 / 3, level: "f" },
        { at: 2 / 3, level: "pp" },
      ],
      to: "mf",
    });
  });
});
