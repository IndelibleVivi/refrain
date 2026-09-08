import type { AirSource } from "@refrain/air-schema";
import { compileAir } from "@refrain/compiler";
import { DEFAULT_PERFORMANCE_BINDING } from "@refrain/soundpack";
import { describe, expect, it } from "vitest";
import {
  createRefrainSelectionHandoff,
  createRefrainSelection,
  selectionHandoffToAgentRequest,
  refrainSelectionIsValid,
  selectionToAgentRequest,
  stringifyRefrainSelection,
} from "./selection.js";
import { createRefrainArtifact } from "./portable.js";
import { receiptIdOf, sourceRevisionOf } from "./identity.js";
import type { AirReceipt } from "./types.js";
import {
  buildStructureDetailWindow,
  buildStructureViewModel,
  MAX_WHOLE_FORM_BINS,
} from "./view-model.js";

const source: AirSource = {
  format: "air@0-experimental",
  title: "Touchable structure",
  tempo: 72,
  meter: "4/4",
  motifs: { return: "[E4,C4,G4]/4 r/4 D4/2" },
  sections: [{ id: "A", startBar: 1, bars: 1 }],
  harmony: [
    {
      id: "home",
      chords: [
        { symbol: "Cmaj7", beats: 2 },
        { symbol: "Am7", beats: 2 },
      ],
    },
  ],
  voices: [
    {
      id: "lead",
      instrument: "warm_piano",
      role: "lead",
      realize: [
        {
          id: "return-a",
          kind: "motif",
          motif: "return",
          section: "A",
          dynamicCurve: { from: "p", to: "mf" },
        },
      ],
    },
    {
      id: "harmony",
      instrument: "harp",
      role: "harmony",
      realize: [
        {
          id: "home-a",
          kind: "chords",
          harmony: "home",
          voicing: "close",
          register: { min: "C3", max: "C5" },
          rhythm: [2],
          section: "A",
        },
      ],
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

describe("StructureViewModel and refrain selection", () => {
  it("projects one UI-agnostic structure from source plus compiler output", () => {
    const compiled = compileAir(source).compiled!;
    const model = buildStructureViewModel(source, compiled, receipt);
    expect(model).toMatchObject({
      format: "refrain-structure@1-experimental",
      sourceRevision: receipt.sourceRevision,
      receiptId: receipt.receiptId,
      sections: [
        {
          anchor: "section:A",
          authoredLabel: "A",
          boundaryAuthority: "authored",
          index: 1,
          startBeat: 0,
          endBeat: 4,
          segmentAnchors: ["lead:return-a:r1", "harmony:home-a:r1"],
        },
      ],
    });
    expect(model.harmonySpans).toEqual([
      expect.objectContaining({ symbol: "Cmaj7", startBeat: 0, endBeat: 2 }),
      expect.objectContaining({ symbol: "Am7", startBeat: 2, endBeat: 4 }),
    ]);
    expect(model.motifOccurrences[0]?.material[1]).toEqual({
      relativeStartBeat: 1,
      durationBeats: 1,
      notes: [],
    });
    expect(model.relationEvidence).toBe(receipt.verification);
    expect(model.playbackTimeline).toEqual({
      durationBeats: 4,
      durationSeconds: 3.3333333333333335,
      eventCount: 12,
    });
    expect(model.visualFacts.motifFamilies[0]).toMatchObject({
      familyId: "return",
    });
    expect(model.visualFacts.densityBins.length).toBeLessThanOrEqual(
      MAX_WHOLE_FORM_BINS,
    );
    expect(model.visualFacts.densityBins[0]).toMatchObject({
      activeCount: 12,
      onsetCount: 12,
      averageMidi: expect.any(Number),
    });
    expect(JSON.stringify(model.playbackTimeline)).not.toContain("eventId");
  });

  it("bounds exact current-detail events independently from whole-form facts", () => {
    const compiled = compileAir(source).compiled!;
    const detail = buildStructureDetailWindow(compiled, 0, 4, 2);
    expect(detail).toMatchObject({
      format: "refrain-structure-detail@0-experimental",
      totalEventCount: 12,
      truncated: true,
    });
    expect(detail.events).toHaveLength(2);
  });

  it("derives exact selections and an agent-readable full-source request", () => {
    const compiled = compileAir(source).compiled!;
    const model = buildStructureViewModel(source, compiled, receipt);
    const selection = createRefrainSelection(
      model,
      "motif",
      "lead:return-a:1:return",
    );
    expect(selection).toMatchObject({
      format: "refrain-selection@0-experimental",
      voiceId: "lead",
      timeRange: { startBeat: 0, endBeat: 4 },
    });
    expect(refrainSelectionIsValid(selection)).toBe(true);
    expect(
      refrainSelectionIsValid({ ...selection, receiptId: "current" }),
    ).toBe(false);
    expect(stringifyRefrainSelection(selection)).toContain('"kind": "motif"');
    const request = selectionToAgentRequest(selection);
    expect(request).toContain("not as an automatic request to call hum");
    expect(request).toContain(
      "For a new root, author current air@1-experimental",
    );
    expect(request).toContain("preserve the exact parent AIR generation");
    expect(request).not.toContain("one complete new air@0-experimental source");
    expect(request).toContain("lead:return-a:1:return");
    expect(request).toContain(receipt.receiptId);
  });

  it("binds a chat handoff to the exact parent artifact authority", () => {
    const compiled = compileAir(source).compiled!;
    const sourceRevision = sourceRevisionOf(source);
    const receiptCore: Omit<AirReceipt, "receiptId"> = {
      format: "refrain-receipt@0-experimental",
      sourceRevision,
      airId: sourceRevision,
      sourceFormat: "air@0-experimental",
      verification: {
        contract: "musical-relation@0-experimental",
        status: "not_applicable",
        motifLinks: [],
      },
    };
    const exactReceipt: AirReceipt = {
      ...receiptCore,
      receiptId: receiptIdOf(receiptCore),
    };
    const model = buildStructureViewModel(source, compiled, exactReceipt);
    const selection = createRefrainSelection(
      model,
      "motif",
      model.motifOccurrences[0]!.anchor,
    );
    const parentArtifact = createRefrainArtifact({
      source,
      receipt: exactReceipt,
      performanceBinding: DEFAULT_PERFORMANCE_BINDING,
    });
    const handoff = createRefrainSelectionHandoff(selection, parentArtifact);
    const request = selectionHandoffToAgentRequest(handoff);
    expect(request).toContain("refrain-selection-handoff@0-experimental");
    expect(request).toContain(JSON.stringify(source));
    expect(request).toContain(exactReceipt.receiptId);
    expect(() =>
      createRefrainSelectionHandoff(
        { ...selection, receiptId: `sha256:${"0".repeat(64)}` },
        parentArtifact,
      ),
    ).toThrow(/does not match/);
  });
});
