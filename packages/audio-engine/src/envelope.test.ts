import { describe, expect, it } from "vitest";
import type { StaticSynthPatch } from "@refrain/soundpack";
import { envelopeLevel, heldEnvelopeLevel } from "./envelope.js";

const patch: StaticSynthPatch = {
  format: "refrain-synth-subtractive@0-experimental",
  oscillators: [{ type: "sine", ratio: 1, gain: 1 }],
  attack: 1,
  decay: 1,
  sustain: 0.5,
  release: 2,
  filterHz: 2000,
  filterQ: 0.7,
};

describe("synth envelope", () => {
  it("releases from the actual level when note-off occurs during attack", () => {
    expect(heldEnvelopeLevel(0.25, patch)).toBeCloseTo(0.25);
    expect(envelopeLevel(0.25, 0.25, patch)).toBeCloseTo(0.25);
    expect(envelopeLevel(1.25, 0.25, patch)).toBeCloseTo(0.0625);
  });

  it("releases from decay and sustain levels without a post-note peak", () => {
    expect(envelopeLevel(1.5, 1.5, patch)).toBeCloseTo(0.75);
    expect(envelopeLevel(2.5, 2.5, patch)).toBeCloseTo(0.5);
    expect(envelopeLevel(4.5, 2.5, patch)).toBe(0);
  });

  it("keeps held levels continuous at exact stage boundaries", () => {
    expect(heldEnvelopeLevel(0, patch)).toBe(0);
    expect(heldEnvelopeLevel(1, patch)).toBe(1);
    expect(heldEnvelopeLevel(1 - 1e-12, patch)).toBeCloseTo(1);
    expect(heldEnvelopeLevel(2, patch)).toBe(0.5);
  });

  it("handles zero and near-zero note durations without a held-stage jump", () => {
    expect(envelopeLevel(0, 0, patch)).toBe(0);
    expect(envelopeLevel(1e-6, 1e-6, patch)).toBeCloseTo(1e-6);
    expect(envelopeLevel(2e-6, 1e-6, patch)).toBeGreaterThan(0);
  });

  it("preserves an elapsed start inside the quadratic release", () => {
    expect(envelopeLevel(3, 2.5, patch)).toBeCloseTo(0.28125);
    expect(envelopeLevel(3.5, 2.5, patch)).toBeCloseTo(0.125);
  });
});
