import { describe, expect, it } from "vitest";
import {
  AIR_V1_FORMAT,
  createAirVocabularyClosure,
  type AirSourceV1,
} from "@refrain/air-schema/v1";
import { compileAirV1 } from "@refrain/compiler/v1";
import { CORE_AUTHORING_VOCABULARY } from "@refrain/soundpack/vnext";
import { encodeMidi } from "./midi.js";

const source: AirSourceV1 = {
  format: AIR_V1_FORMAT,
  title: "Meter ink",
  conductor: {
    tempo: 90,
    meters: [
      { bar: 1, meter: "5/8" },
      { bar: 2, meter: "7/8" },
    ],
  },
  vocabulary: createAirVocabularyClosure({
    id: "midi-meter@0",
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
      realize: [
        {
          id: "five",
          kind: "rest",
          duration: { numerator: 5, denominator: 2 },
        },
        {
          id: "seven",
          kind: "rest",
          duration: { numerator: 7, denominator: 2 },
        },
      ],
    },
  ],
};

describe("AIR@1 MIDI conductor", () => {
  it("emits every ordered meter change rather than only the first signature", () => {
    const compiled = compileAirV1(source).compiled!;
    const bytes = Array.from(encodeMidi(compiled));
    const signatures: number[][] = [];
    for (let index = 0; index < bytes.length - 6; index += 1)
      if (bytes[index] === 0xff && bytes[index + 1] === 0x58)
        signatures.push(bytes.slice(index, index + 7));
    expect(signatures).toEqual([
      [0xff, 0x58, 0x04, 5, 3, 24, 8],
      [0xff, 0x58, 0x04, 7, 3, 24, 8],
    ]);
  });
});
