import { describe, expect, it } from "vitest";
import { AIR_FORMAT, type AirSource } from "@refrain/air-schema";
import {
  compileAir,
  MAX_EVENTS,
  MAX_SCORE_SECONDS,
  noteNameToMidi,
} from "./index.js";

const returningAir: AirSource = {
  format: AIR_FORMAT,
  title: "A small return",
  tempo: 72,
  meter: "4/4",
  key: "D minor",
  motifs: {
    return: "A4/8 B4/8 D5/4 r/2",
  },
  voices: [
    {
      id: "lead",
      instrument: "warm_piano",
      role: "lead",
      part: "@return | r/1 | @return | @return(-3,1)",
    },
    {
      id: "bed",
      instrument: "air_pad",
      role: "harmony",
      part: "[D3,A3]/1 | [F3,C4]/1 | [G3,D4]/1 | [D3,A3]/1",
      gainDb: -3,
    },
  ],
};

describe("compileAir", () => {
  it("expands named motifs into a deterministic schedule", () => {
    const result = compileAir(returningAir);
    expect(result.compiled?.durationBeats).toBe(16);
    expect(result.compiled?.events[0]).toMatchObject({
      voiceId: "bed",
      startBeat: 0,
      midi: 50,
    });
    expect(result.compiled?.motifOccurrences).toHaveLength(3);
    expect(result.compiled?.motifFamilies).toEqual([
      {
        familyId: "return",
        durationBeats: 4,
        atoms: [
          { relativeStartBeat: 0, durationBeats: 0.5, pitchDeltas: [0] },
          { relativeStartBeat: 0.5, durationBeats: 0.5, pitchDeltas: [2] },
          { relativeStartBeat: 1, durationBeats: 1, pitchDeltas: [5] },
          { relativeStartBeat: 2, durationBeats: 2, pitchDeltas: [] },
        ],
      },
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "note", code: "motif_returns" }),
    );
  });

  it("reports precise measure and instrument failures", () => {
    const result = compileAir({
      ...returningAir,
      voices: [{ id: "bad", instrument: "flute", role: "lead", part: "C2/4" }],
    });
    expect(result.compiled).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "measure_underflow",
      "out_of_range",
    ]);
  });

  it("explains compact motif transforms as positional values", () => {
    const result = compileAir({
      ...returningAir,
      voices: [
        {
          id: "bad_transform",
          instrument: "warm_piano",
          role: "lead",
          part: "@return(transpose,1)",
        },
      ],
    });
    const diagnostic = result.diagnostics.find(
      (item) => item.code === "invalid_token",
    );
    expect(diagnostic?.hint).toContain("@motif(-3,0.5)");
    expect(diagnostic?.hint).toContain("Named text");
  });

  it("keeps note names on the MIDI convention", () => {
    expect(noteNameToMidi("C4")).toBe(60);
    expect(noteNameToMidi("Bb3")).toBe(58);
  });

  it("accepts only the declared soft percussion kit", () => {
    const supported = compileAir({
      ...returningAir,
      voices: [
        {
          id: "kit",
          instrument: "soft_percussion",
          role: "percussion",
          part: "C2/4 D2/4 F#2/4 D#3/4",
        },
      ],
    });
    expect(supported.compiled?.events.map((event) => event.midi)).toEqual([
      36, 38, 42, 51,
    ]);

    const unsupported = compileAir({
      ...returningAir,
      voices: [
        {
          id: "kit",
          instrument: "soft_percussion",
          role: "percussion",
          part: "C#2/1",
        },
      ],
    });
    expect(unsupported.compiled).toBeUndefined();
    expect(unsupported.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unsupported_pitch" }),
    );
  });

  it("enforces bar and duration budgets before render allocation", () => {
    const tooManyBars = compileAir({
      ...returningAir,
      voices: [
        {
          id: "rest",
          instrument: "warm_piano",
          role: "lead",
          part: Array.from({ length: 257 }, () => "r/1").join(" | "),
        },
      ],
    });
    expect(tooManyBars.diagnostics).toContainEqual(
      expect.objectContaining({ code: "bar_limit" }),
    );

    const longBar = Array.from({ length: 16 }, () => "r/1").join(" ");
    const tooLong = compileAir({
      ...returningAir,
      tempo: 30,
      meter: "16/1",
      voices: [
        {
          id: "rest",
          instrument: "warm_piano",
          role: "lead",
          part: Array.from({ length: 8 }, () => longBar).join(" | "),
        },
      ],
    });
    expect(tooLong.diagnostics).toContainEqual(
      expect.objectContaining({ code: "score_too_long" }),
    );
  });

  it("caps acyclic motif expansion", () => {
    const motifs: Record<string, string> = {
      a0: "C4/4 D4/4 E4/4 F4/4 G4/4",
    };
    for (let index = 1; index <= 14; index += 1) {
      motifs[`a${index}`] = `@a${index - 1} @a${index - 1}`;
    }
    const result = compileAir({
      ...returningAir,
      motifs,
      voices: [
        {
          id: "lead",
          instrument: "warm_piano",
          role: "lead",
          part: "@a14",
        },
      ],
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "expanded_atom_limit" }),
    );
  });

  it("compiles the adopted eight-minute, twelve-voice, twenty-thousand-event envelope", () => {
    const harmony = Array.from({ length: 15 }, (_, index) => ({
      symbol: ["Cm7", "Abmaj7", "Eb", "G7"][index % 4]!,
      beats: 64,
    }));
    const denseVoices = Array.from({ length: 6 }, (_, index) => ({
      id: `dense_${index + 1}`,
      instrument: [
        "warm_piano",
        "harp",
        "chamber_strings",
        "marimba",
        "air_pad",
        "glass_bell",
      ][index]!,
      role: index === 0 ? ("lead" as const) : ("texture" as const),
      realize: [
        {
          id: "whole_form",
          kind: "arpeggio" as const,
          harmony: "stress_changes",
          degrees: [1, 3, 5] as const,
          stepBeats: 0.25,
          octaveSpan: 2,
          register: { min: "C4", max: "C6" },
        },
      ],
    }));
    const restVoices = Array.from({ length: 6 }, (_, index) => ({
      id: `rest_${index + 1}`,
      instrument: "air_pad",
      role: "texture" as const,
      realize: [
        {
          id: "whole_form",
          kind: "rest" as const,
          beats: 64,
          repeat: 15,
        },
      ],
    }));
    const result = compileAir({
      format: AIR_FORMAT,
      title: "Upper envelope",
      tempo: 120,
      meter: "4/4",
      motifs: {},
      harmony: [{ id: "stress_changes", chords: harmony }],
      voices: [...denseVoices, ...restVoices],
    });
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      ),
    ).toEqual([]);
    expect(result.compiled).toMatchObject({
      durationSeconds: MAX_SCORE_SECONDS,
    });
    expect(result.compiled!.events.length).toBe(23_040);
    expect(result.compiled!.events.length).toBeGreaterThanOrEqual(20_000);
    expect(result.compiled!.events.length).toBeLessThanOrEqual(MAX_EVENTS);
    expect(
      new Set(result.compiled!.events.map((event) => event.voiceId)).size,
    ).toBe(6);
  });
});
