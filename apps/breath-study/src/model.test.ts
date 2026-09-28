import { describe, expect, it } from "vitest";
import type { Work } from "./contracts";
import { compileWork, parseWork, serializeWork } from "./model";

const raw = () => ({
  format: "breath-study-work@0",
  title: "Breath study",
  tempo: 72,
  lengthBeats: 16,
  notes: [
    {
      id: "n1",
      at: 0,
      beats: 1,
      midi: 60,
      velocity: 0.8,
      pan: 0,
      part: "melody",
    },
    {
      id: "n2",
      at: 1,
      beats: 0.5,
      midi: 64,
      velocity: 0.6,
      pan: -0.3,
      part: "harmony",
    },
    {
      id: "n3",
      at: 4,
      beats: 2,
      midi: 48,
      velocity: 0.9,
      pan: 0.2,
      part: "bass",
    },
  ],
  breaths: [2],
  settings: { breath: 0.5, color: 0.25, space: 0.4 },
});

const work = (overrides: Partial<Work> = {}): Work => ({
  ...parseWork(JSON.stringify(raw())),
  ...overrides,
});

describe("Breath study work model", () => {
  it("strictly rejects unknown fields, versions and shapes", () => {
    const cases: ((value: any) => void)[] = [
      (w) => (w.format = "refrain-artifact@3-experimental"),
      (w) => (w.extra = 1),
      (w) => delete w.title,
      (w) => (w.notes[0].extra = true),
      (w) => delete w.notes[0].part,
      (w) => (w.settings.extra = 0),
      (w) => (w.tempo = 200),
      (w) => (w.tempo = 10),
      (w) => (w.lengthBeats = 0),
      (w) => (w.lengthBeats = 200),
      (w) => (w.notes = []),
      (w) =>
        (w.notes = Array.from({ length: 257 }, (_, i) => ({
          ...w.notes[0],
          id: "n" + i,
        }))),
      (w) => (w.notes[0].midi = 20),
      (w) => (w.notes[0].midi = 100),
      (w) => (w.notes[0].midi = 60.5),
      (w) => (w.notes[0].velocity = 0),
      (w) => (w.notes[0].velocity = 1.5),
      (w) => (w.notes[0].pan = -2),
      (w) => (w.notes[0].pan = 2),
      (w) => (w.notes[0].part = "lead"),
      (w) => (w.notes[0].at = -1),
      (w) => (w.notes[0].at = 40),
      (w) => (w.notes[0].beats = 0),
      (w) => (w.notes[0].beats = -1),
      (w) => (w.notes[1].beats = 15.9),
      (w) => (w.notes[1].id = "n1"),
      (w) => (w.notes[0].velocity = Number.POSITIVE_INFINITY),
      (w) => (w.breaths = [3, 2]),
      (w) => (w.breaths = [2, 2]),
      (w) => (w.breaths = [40]),
      (w) => (w.breaths = [-1]),
      (w) => (w.breaths = Array.from({ length: 513 }, (_, i) => i % 16)),
      (w) => (w.settings.breath = 3),
      (w) => (w.settings.color = 1.5),
      (w) => (w.settings.space = -0.5),
    ];
    for (const mutate of cases) {
      const value = raw();
      mutate(value);
      expect(() => parseWork(JSON.stringify(value))).toThrow();
    }
    expect(() => parseWork("{not json")).toThrow();
  });

  it("bounds the rendered length at 150 seconds", () => {
    const long = raw();
    long.tempo = 40;
    long.lengthBeats = 96;
    long.breaths = Array.from({ length: 24 }, (_, i) => i * 4);
    long.notes = [
      {
        id: "n1",
        at: 0,
        beats: 1,
        midi: 60,
        velocity: 0.8,
        pan: 0,
        part: "melody",
      },
    ];
    expect(() => parseWork(JSON.stringify(long))).toThrow();
  });

  it("serializes and reopens exactly, preserving note order and ids", () => {
    const original = work();
    const reopened = parseWork(serializeWork(original));
    expect(reopened).toEqual(original);
    expect(reopened.notes.map((note) => note.id)).toEqual(["n1", "n2", "n3"]);
    expect(serializeWork(reopened)).toBe(serializeWork(original));
  });

  it("delays later onsets at a gap without changing tails", () => {
    const authored = work();
    const program = compileWork(authored);
    const secondsPerBeat = 60 / authored.tempo;
    const early = program.notes.find((note) => note.id === "n1")!;
    const late = program.notes.find((note) => note.id === "n3")!;
    expect(early.start).toBeCloseTo(0 * secondsPerBeat, 12);
    expect(late.start).toBeCloseTo(
      4 * secondsPerBeat + authored.settings.breath,
      12,
    );
    expect(late.duration).toBeCloseTo(2 * secondsPerBeat, 12);
  });

  it("delays a note that sits exactly on the gap beat", () => {
    const pinned = work({
      notes: [
        {
          id: "on",
          at: 2,
          beats: 1,
          midi: 60,
          velocity: 0.8,
          pan: 0,
          part: "melody",
        },
      ],
    });
    const program = compileWork(pinned);
    const secondsPerBeat = 60 / pinned.tempo;
    expect(program.notes[0].start).toBeCloseTo(
      2 * secondsPerBeat + pinned.settings.breath,
      12,
    );
  });

  it("reports music end, gaps in seconds and a finite tail", () => {
    const authored = work();
    const program = compileWork(authored);
    const secondsPerBeat = 60 / authored.tempo;
    expect(program.musicEnd).toBeCloseTo(
      authored.lengthBeats * secondsPerBeat +
        authored.breaths.length * authored.settings.breath,
      12,
    );
    expect(program.duration).toBeCloseTo(program.musicEnd + 5, 12);
    expect(program.duration).toBeLessThanOrEqual(150);
    expect(program.gaps).toHaveLength(1);
    expect(program.gaps[0].start).toBeCloseTo(2 * secondsPerBeat, 12);
    expect(program.gaps[0].end - program.gaps[0].start).toBeCloseTo(
      authored.settings.breath,
      12,
    );
  });

  it("keeps the score but resets instrument settings in reference mode", () => {
    const authored = work();
    const performed = compileWork(authored, false);
    const reference = compileWork(authored, true);
    expect(reference.settings).toEqual({ breath: 0, color: 0, space: 0.18 });
    expect(reference.gaps).toEqual([]);
    expect(reference.notes.map((note) => note.id)).toEqual(
      authored.notes.map((note) => note.id),
    );
    const musical = (notes: typeof performed.notes) =>
      notes.map((note) => ({
        id: note.id,
        at: note.at,
        beats: note.beats,
        midi: note.midi,
        velocity: note.velocity,
        pan: note.pan,
        part: note.part,
      }));
    expect(musical(reference.notes)).toEqual(musical(performed.notes));
    const louder = compileWork(
      work({ settings: { breath: 1.8, color: 1, space: 1 } }),
      true,
    );
    const quieter = compileWork(
      work({ settings: { breath: 0, color: 0, space: 0 } }),
      true,
    );
    expect(louder.notes).toEqual(quieter.notes);
    expect(louder.duration).toBe(quieter.duration);
  });

  it("never invents or drops notes", () => {
    const authored = work();
    expect(compileWork(authored).notes).toHaveLength(authored.notes.length);
    expect(compileWork(authored, true).notes).toHaveLength(
      authored.notes.length,
    );
  });
});
