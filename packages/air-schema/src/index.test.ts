import { describe, expect, it } from "vitest";
import {
  AIR_FORMAT,
  canonicalAirJson,
  MAX_VOICES,
  parseAir,
  type AirSource,
} from "./index.js";

const valid: AirSource = {
  format: AIR_FORMAT,
  title: "A small return",
  tempo: 72,
  meter: "4/4",
  motifs: { return: "A4/8 B4/8 D5/4 r/2" },
  voices: [
    { id: "lead", role: "lead", instrument: "warm_piano", part: "@return" },
  ],
};

describe("parseAir", () => {
  it("accepts the experimental envelope", () => {
    expect(parseAir(valid)).toEqual({ source: valid, diagnostics: [] });
  });

  it("locates envelope failures", () => {
    const result = parseAir({ ...valid, tempo: 500, voices: [] });
    expect(result.source).toBeUndefined();
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["tempo_out_of_range", "$.tempo"],
      ["invalid_voices", "$.voices"],
    ]);
  });

  it("canonicalizes object keys without reordering musical arrays", () => {
    expect(canonicalAirJson(valid)).toContain('"format":"air@0-experimental"');
    const reordered: AirSource = {
      voices: valid.voices,
      motifs: valid.motifs,
      meter: valid.meter,
      tempo: valid.tempo,
      title: valid.title,
      format: valid.format,
    };
    expect(canonicalAirJson(valid)).toBe(canonicalAirJson(reordered));
  });

  it("rejects unknown envelope and nested fields", () => {
    const result = parseAir({
      ...valid,
      privateNote: "must not enter the canonical artifact",
      voices: [{ ...valid.voices[0], gainDB: -3 }],
    });
    expect(result.source).toBeUndefined();
    expect(result.diagnostics.map((item) => item.path)).toEqual([
      "$.privateNote",
      "$.voices[0].gainDB",
    ]);
  });

  it("rejects non-finite direct-call mix values", () => {
    const result = parseAir({
      ...valid,
      voices: [{ ...valid.voices[0], gainDb: Number.NaN, pan: Infinity }],
    });
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "invalid_gain",
      "invalid_pan",
    ]);
  });

  it("rejects oversized source before parsing or compilation", () => {
    const result = parseAir(
      JSON.stringify({ ...valid, padding: "x".repeat(70_000) }),
    );
    expect(result.diagnostics[0]?.code).toBe("source_too_large");
  });

  it("accepts the complete-piece voice envelope and rejects a thirteenth voice", () => {
    const voices = Array.from({ length: MAX_VOICES }, (_, index) => ({
      id: `voice_${index + 1}`,
      role: "texture" as const,
      instrument: "air_pad",
      part: "r/1",
    }));
    expect(parseAir({ ...valid, voices }).source?.voices).toHaveLength(12);
    expect(
      parseAir({
        ...valid,
        voices: [
          ...voices,
          {
            id: "voice_13",
            role: "texture",
            instrument: "air_pad",
            part: "r/1",
          },
        ],
      }).diagnostics,
    ).toContainEqual(expect.objectContaining({ code: "too_many_voices" }));
  });

  it("accepts strict harmony and every realization segment kind", () => {
    const result = parseAir({
      ...valid,
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
          id: "ensemble",
          role: "harmony",
          instrument: "warm_piano",
          realize: [
            { id: "literal", kind: "literal", part: "C4/1" },
            {
              id: "motif",
              kind: "motif",
              motif: "return",
              transform: {
                transpose: 2,
                stretch: 0.5,
                inversion: true,
                retrograde: true,
              },
              dynamicCurve: { from: "p", to: "mf" },
              articulation: "legato",
            },
            {
              id: "chords",
              kind: "chords",
              harmony: "verse",
              voicing: "close",
              register: { min: "C3", max: "C5" },
              rhythm: [1, 1, 2],
              voiceLeading: "nearest",
            },
            {
              id: "arp",
              kind: "arpeggio",
              harmony: "verse",
              degrees: [1, 3, 5, 7],
              stepBeats: 0.5,
              octaveSpan: 2,
              register: { min: "C3", max: "C6" },
            },
            {
              id: "bass",
              kind: "bass",
              harmony: "verse",
              degrees: [1, 5],
              stepBeats: 1,
              register: { min: "C2", max: "C4" },
              slashBass: "honor",
            },
            {
              id: "drums",
              kind: "drum_grid",
              resolution: 16,
              lanes: [
                { note: "C2", pattern: "x...x...x...x..." },
                { note: "D2", pattern: "....x.......x..." },
              ],
              dynamic: "mp",
            },
            { id: "rest", kind: "rest", beats: 4, repeat: 2, section: "B" },
          ],
        },
      ],
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.source?.voices[0]).toHaveProperty("realize");
    expect(result.source?.harmony?.[0]?.id).toBe("verse");
  });

  it("enforces the voice authoring xor and closed expression/segment objects", () => {
    const result = parseAir({
      ...valid,
      voices: [
        {
          ...valid.voices[0],
          realize: [
            {
              id: "bad",
              kind: "rest",
              beats: 4,
              dynamic: "fff",
              gate: 2,
              mood: "wistful",
            },
          ],
        },
      ],
    });
    expect(result.source).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "voice_authoring_mode" }),
        expect.objectContaining({
          code: "unknown_field",
          path: "$.voices[0].realize[0].mood",
        }),
        expect.objectContaining({ code: "invalid_dynamic" }),
        expect.objectContaining({ code: "invalid_gate" }),
      ]),
    );
  });

  it("accepts bounded multipoint dynamic curves and rejects malformed contours", () => {
    const withCurve = (dynamicCurve: unknown) =>
      parseAir({
        ...valid,
        voices: [
          {
            id: "lead",
            role: "lead",
            instrument: "flute",
            realize: [
              {
                id: "breath",
                kind: "motif",
                motif: "return",
                dynamicCurve,
              },
            ],
          },
        ],
      });

    expect(
      withCurve({
        from: "p",
        via: [
          { at: 0.35, level: "f" },
          { at: 0.7, level: "mp" },
        ],
        to: "mf",
      }).diagnostics,
    ).toEqual([]);

    for (const dynamicCurve of [
      { from: "p", via: [], to: "mf" },
      { from: "p", via: [{ at: 0, level: "f" }], to: "mf" },
      {
        from: "p",
        via: [
          { at: 0.7, level: "f" },
          { at: 0.7, level: "mp" },
        ],
        to: "mf",
      },
      { from: "p", via: [{ at: 0.5, level: "fff" }], to: "mf" },
      {
        from: "p",
        via: [{ at: 0.5, level: "f", curve: "bezier" }],
        to: "mf",
      },
    ]) {
      expect(withCurve(dynamicCurve).diagnostics.length).toBeGreaterThan(0);
    }
  });

  it("keeps the chord-degree vocabulary closed to 1, 3, 5, 7, and 9", () => {
    const result = parseAir({
      ...valid,
      harmony: [{ id: "one", chords: [{ symbol: "C", beats: 4 }] }],
      voices: [
        {
          id: "arp",
          role: "lead",
          instrument: "harp",
          realize: [
            {
              id: "unsupported",
              kind: "arpeggio",
              harmony: "one",
              degrees: [1, 2, 5],
              stepBeats: 1,
              octaveSpan: 1,
              register: { min: "C3", max: "C6" },
            },
          ],
        },
      ],
    });
    expect(result.source).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_pattern",
          path: "$.voices[0].realize[0].degrees",
        }),
      ]),
    );
  });
});
