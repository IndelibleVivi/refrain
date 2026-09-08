import type { AirSource } from "@refrain/air-schema";
import { compileAir } from "@refrain/compiler";
import { DEFAULT_PERFORMANCE_BINDING } from "@refrain/soundpack";
import { describe, expect, it } from "vitest";
import {
  motifFigureAnchorIsInteractive,
  motifLandmarkAnchors,
  SELEN_V21_DENSE_MOTIF_THRESHOLD,
} from "./selen-v21-density.js";
import {
  boundSelenV21VisualEvents,
  buildSelenV21Piece,
  MAX_SELEN_V21_VISUAL_EVENTS_PER_LANE,
} from "./selen-v21-model.js";
import type { AirArtifact, AirReceipt } from "./types.js";
import { buildStructureViewModel } from "./view-model.js";

const source: AirSource = {
  format: "air@0-experimental",
  title: "Four visual lanes, five authored voices",
  tempo: 72,
  meter: "4/4",
  motifs: {
    thread: "[C4,E4,G4]/4 D4/4",
    answer: "r/4 A3/4 C4/2",
  },
  sections: [{ id: "seed_room", startBar: 1, bars: 2 }],
  voices: [
    {
      id: "cello",
      instrument: "solo_cello",
      role: "lead",
      realize: [
        {
          id: "cello-thread",
          kind: "motif",
          motif: "thread",
          repeat: 4,
          section: "seed_room",
        },
      ],
    },
    {
      id: "clarinet",
      instrument: "clarinet",
      role: "counter",
      realize: [
        {
          id: "clarinet-answer",
          kind: "motif",
          motif: "answer",
          repeat: 2,
          section: "seed_room",
        },
      ],
    },
    {
      id: "piano",
      instrument: "warm_piano",
      role: "harmony",
      part: "C4/1 | E4/1",
    },
    {
      id: "bass",
      instrument: "clean_bass",
      role: "bass",
      part: "C2/1 | G2/1",
    },
    {
      id: "brushes",
      instrument: "soft_percussion",
      role: "percussion",
      part: "C2/4 r/4 D2/4 r/4 | C2/4 r/4 D2/4 r/4",
    },
  ],
};

const receipt: AirReceipt = {
  format: "refrain-receipt@0-experimental",
  sourceRevision: `sha256:${"1".repeat(64)}`,
  airId: `sha256:${"2".repeat(64)}`,
  receiptId: `sha256:${"3".repeat(64)}`,
  sourceFormat: "air@0-experimental",
  verification: {
    contract: "musical-relation@0-experimental",
    status: "not_applicable",
    motifLinks: [],
  },
};

function visualPiece() {
  const result = compileAir(source);
  const compiled = result.compiled;
  if (!compiled)
    throw new Error(
      `test AIR did not compile: ${JSON.stringify(result.diagnostics)}`,
    );
  const artifact: AirArtifact = {
    source,
    compiled,
    diagnostics: [],
    receipt,
    performanceBinding: DEFAULT_PERFORMANCE_BINDING,
  };
  const structure = buildStructureViewModel(source, compiled, receipt);
  return { compiled, piece: buildSelenV21Piece(artifact, structure) };
}

describe("Selen v21 visual model", () => {
  it("uses the execution duration when embodiment extends beyond authored music", () => {
    const { compiled, piece } = visualPiece();
    const result = compileAir(source);
    if (!result.compiled) throw new Error("test AIR did not compile");
    const artifact: AirArtifact = {
      source,
      compiled: result.compiled,
      diagnostics: [],
      receipt,
      performanceBinding: DEFAULT_PERFORMANCE_BINDING,
    };
    const structure = buildStructureViewModel(source, result.compiled, receipt);
    const embodied = buildSelenV21Piece(artifact, structure, {
      transportDurationSeconds: compiled.durationSeconds + 1.8,
    });

    expect(embodied.durationBeats).toBe(compiled.durationBeats);
    expect(embodied.durationSeconds).toBe(compiled.durationSeconds + 1.8);
    expect(piece.durationSeconds).toBe(compiled.durationSeconds);
  });

  it("preserves exact source facts while collapsing authored roles into visual lanes", () => {
    const { compiled, piece } = visualPiece();

    expect(piece.sourceVoiceCount).toBe(5);
    expect(piece.voices.map((voice) => voice.id)).toEqual([
      "lead",
      "echo",
      "bass",
      "pulse",
    ]);
    expect(piece.sections).toEqual([
      expect.objectContaining({ id: "seed_room", label: "seed_room" }),
    ]);
    expect(piece.motifOccurrences).toHaveLength(
      compiled.motifOccurrences.length,
    );
    expect(new Set(piece.motifOccurrences.map((item) => item.motif))).toEqual(
      new Set(["thread", "answer"]),
    );
    expect(
      piece.motifOccurrences.find((item) => item.sourceVoiceId === "clarinet"),
    ).toMatchObject({ voiceId: "echo", motif: "answer" });
    expect(
      piece.events.find((event) =>
        compiled.events.some(
          (compiledEvent) =>
            compiledEvent.id === event.id &&
            compiledEvent.voiceId === "brushes",
        ),
      ),
    ).toMatchObject({ voiceId: "pulse", sourceVoiceId: "brushes" });
    expect(piece.motifDefinitions.thread?.atoms[0]?.p).toBeCloseTo(11 / 3);
    expect(piece.exactEventCount).toBe(compiled.events.length);
    expect(piece.densityByCount["42"]).toHaveLength(42);
  });

  it("bounds visual moments per lane without changing the exact event count", () => {
    const { piece } = visualPiece();
    const template = piece.events[0]!;
    const exactEvents = Array.from({ length: 800 }, (_, index) => ({
      ...template,
      id: `event:${index}`,
      voiceId: "lead",
      sourceVoiceId: `voice:${index % 3}`,
      startBeat: index / 10,
    }));
    const bounded = boundSelenV21VisualEvents(exactEvents, 80);

    expect(bounded).toHaveLength(MAX_SELEN_V21_VISUAL_EVENTS_PER_LANE);
    expect(bounded.every((event) => event.voiceId === "lead")).toBe(true);
    expect(bounded[0]).toMatchObject({
      id: "visual:lead:0",
      sourceVoiceId: expect.stringContaining("voice:"),
    });
  });

  it("chooses one dense landmark per motif family and authored section", () => {
    const { piece } = visualPiece();
    const sections = ["seed", "open", "turn", "return"].map((id, index) => ({
      id,
      label: id,
      startBeat: index * 4,
      endBeat: (index + 1) * 4,
    }));
    const template = piece.motifOccurrences[0]!;
    const motifOccurrences = ["thread", "answer"].flatMap((motif) =>
      sections.flatMap((section) =>
        Array.from({ length: 3 }, (_, index) => ({
          ...template,
          anchor: `${motif}:${section.id}:${index}`,
          motif,
          occurrence: index + 1,
          startBeat: section.startBeat + index,
          section: section.id,
        })),
      ),
    );
    const densePiece = {
      ...piece,
      durationBeats: 16,
      sections,
      motifOccurrences,
    };

    expect(motifOccurrences.length).toBeGreaterThan(
      SELEN_V21_DENSE_MOTIF_THRESHOLD,
    );
    expect([...motifLandmarkAnchors(densePiece)]).toEqual(
      ["thread", "answer"].flatMap((motif) =>
        sections.map((section) => `${motif}:${section.id}:0`),
      ),
    );
  });

  it("uses four deterministic time windows when authored sections are absent", () => {
    const { piece } = visualPiece();
    const template = piece.motifOccurrences[0]!;
    const unsectioned = {
      ...piece,
      durationBeats: 16,
      sections: [],
      motifOccurrences: Array.from({ length: 16 }, (_, index) => ({
        ...template,
        anchor: `thread:${index}`,
        occurrence: index + 1,
        startBeat: index,
        section: undefined,
      })),
    };

    expect([...motifLandmarkAnchors(unsectioned)]).toEqual([
      "thread:0",
      "thread:4",
      "thread:8",
      "thread:12",
    ]);
  });

  it("keeps hidden dense anchors out of the figure focus order", () => {
    expect(
      motifFigureAnchorIsInteractive({
        dense: true,
        landmark: false,
        current: false,
        selected: false,
      }),
    ).toBe(false);
    expect(
      motifFigureAnchorIsInteractive({
        dense: true,
        landmark: true,
        current: false,
        selected: false,
      }),
    ).toBe(true);
    expect(
      motifFigureAnchorIsInteractive({
        dense: true,
        landmark: false,
        current: true,
        selected: false,
      }),
    ).toBe(true);
    expect(
      motifFigureAnchorIsInteractive({
        dense: true,
        landmark: false,
        current: false,
        selected: true,
      }),
    ).toBe(true);
    expect(
      motifFigureAnchorIsInteractive({
        dense: false,
        landmark: false,
        current: false,
        selected: false,
      }),
    ).toBe(true);
  });
});
