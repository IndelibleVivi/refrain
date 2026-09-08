import { describe, expect, it } from "vitest";
import type { SynthPatch } from "@refrain/soundpack";
import { envelopeLevel, heldEnvelopeLevel } from "./envelope.js";

const patch: SynthPatch = {
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
});
