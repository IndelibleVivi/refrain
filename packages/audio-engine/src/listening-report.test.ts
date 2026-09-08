import { describe, expect, it } from "vitest";
import {
  AIR_V1_FORMAT,
  createAirVocabularyClosure,
  type AirSourceV1,
} from "@refrain/air-schema/v1";
import type { CompiledAir } from "@refrain/compiler";
import { compileAirV1 } from "@refrain/compiler/v1";
import { createListeningReport } from "./listening-report.js";

const compiled: CompiledAir = {
  format: "compiled-air@0-experimental",
  sourceFormat: "air@0-experimental",
  title: "Report proof",
  tempo: 120,
  meter: "4/4",
  beatsPerBar: 4,
  durationBeats: 8,
  durationSeconds: 4,
  events: [
    {
      id: "lead:1:1",
      voiceId: "lead",
      role: "lead",
      instrument: "warm_piano",
      midi: 60,
      note: "C4",
      startBeat: 0,
      durationBeats: 1,
      soundingDurationBeats: 1,
      velocity: 0.5,
      gainDb: 0,
      pan: 0,
      bar: 1,
      articulation: "none",
      gate: 1,
      source: { voiceId: "lead", authoring: "part" },
      motif: "thread",
      motifOccurrence: 1,
    },
    {
      id: "lead:2:2",
      voiceId: "lead",
      role: "lead",
      instrument: "warm_piano",
      midi: 72,
      note: "C5",
      startBeat: 4,
      durationBeats: 1,
      soundingDurationBeats: 1,
      velocity: 0.8,
      gainDb: 0,
      pan: 0,
      bar: 2,
      articulation: "accent",
      gate: 1,
      source: { voiceId: "lead", authoring: "part" },
      motif: "thread",
      motifOccurrence: 2,
    },
  ],
  motifFamilies: [],
  motifOccurrences: [],
  segments: [],
  sections: [
    { id: "open", startBeat: 0, endBeat: 4 },
    { id: "return", startBeat: 4, endBeat: 8 },
  ],
};

describe("ListeningReport@0", () => {
  it("separates deterministic structure from embodiment without taste scores or mutation", () => {
    const before = JSON.stringify(compiled);
    const embodiment = {
      sampleRate: 4,
      left: Float32Array.from([0, 0.25, -0.5, 1.1, 0, 0, 0, 0]),
      right: Float32Array.from([0, 0.25, -0.5, 1.1, 0, 0, 0, 0]),
      peakCeiling: 0.72,
      sceneTailSeconds: 1.25,
    };
    const report = createListeningReport(compiled, embodiment);
    expect(report.format).toBe("refrain-listening-report@0-experimental");
    expect(report.structural.motifRecurrences).toEqual([
      { motif: "thread", occurrences: 2 },
    ]);
    expect(report.embodiment?.clippedFrames).toBe(1);
    expect(report.embodiment?.sceneTailSeconds).toBe(1.25);
    expect(JSON.stringify(report)).not.toMatch(/pleasant|compatibility|score/i);
    expect(JSON.stringify(compiled)).toBe(before);
    expect(createListeningReport(compiled, embodiment).reportId).toBe(
      report.reportId,
    );
  });

  it("counts the exact event provenance of repeated AIR@1 motif occurrences", () => {
    const source: AirSourceV1 = {
      format: AIR_V1_FORMAT,
      title: "Three returns",
      conductor: { tempo: 60, meters: [{ bar: 1, meter: "4/4" }] },
      vocabulary: createAirVocabularyClosure({
        id: "listening-report-test@0",
        instruments: [
          {
            id: "warm_piano",
            label: "Warm piano",
            family: "pitched",
            midiMin: 21,
            midiMax: 108,
            status: "active",
            authoringMeaning: "A test piano.",
          },
        ],
        techniques: [],
      }),
      motifs: { thread: "C4/4" },
      phrases: [
        {
          id: "return",
          segments: [
            { id: "thread", kind: "motif", motif: "thread", repeat: 3 },
          ],
        },
      ],
      voices: [
        {
          id: "lead",
          role: "lead",
          instrument: "warm_piano",
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
    const result = compileAirV1(source);
    expect(result.compiled).toBeDefined();
    expect(
      createListeningReport(result.compiled!).structural.motifRecurrences,
    ).toEqual([{ motif: "thread", occurrences: 3 }]);
  });
});
