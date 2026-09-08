import { describe, expect, it } from "vitest";
import type { SynthPatch } from "@refrain/soundpack";
import {
  processSynthSample,
  synthFilter,
  synthOscillatorProjection,
  synthRawSample,
} from "./synth-kernel.js";

const subtractive: SynthPatch = {
  format: "refrain-synth-subtractive@0-experimental",
  oscillators: [
    { type: "sine", ratio: 1, gain: 0.8 },
    { type: "triangle", ratio: 2, gain: 0.2, detune: 3 },
  ],
  attack: 0.2,
  decay: 0.3,
  sustain: 0.6,
  release: 0.7,
  filterHz: 1800,
  filterQ: 0.7,
};
const modal: SynthPatch = {
  format: "refrain-synth-modal@0-experimental",
  modes: [
    { ratio: 1, gain: 0.8, decaySeconds: 2 },
    { ratio: 2.01, gain: 0.2, decaySeconds: 0.7 },
  ],
  attack: 0.004,
  release: 1.4,
};

describe("shared versioned synth kernel", () => {
  it("projects both closed families into the same browser-neutral oscillator facts", () => {
    expect(synthOscillatorProjection(subtractive)).toEqual([
      { type: "sine", ratio: 1, gain: 0.8, detune: 0 },
      { type: "triangle", ratio: 2, gain: 0.2, detune: 3 },
    ]);
    expect(synthOscillatorProjection(modal)).toEqual([
      {
        type: "sine",
        ratio: 1,
        gain: 0.8,
        detune: 0,
        decaySeconds: 2,
      },
      {
        type: "sine",
        ratio: 2.01,
        gain: 0.2,
        detune: 0,
        decaySeconds: 0.7,
      },
    ]);
  });

  it("is deterministic and keeps modal decay distinct from subtractive filtering", () => {
    const at = 0.137;
    expect(synthRawSample(modal, at, 440)).toBe(synthRawSample(modal, at, 440));
    expect(Math.abs(synthRawSample(modal, 3, 440))).toBeLessThan(
      Math.abs(synthRawSample(modal, 0.1, 440)) + 0.2,
    );
    expect(synthFilter(modal, 44_100)).toBeUndefined();
    const filter = synthFilter(subtractive, 44_100);
    expect(filter).toBeDefined();
    expect(processSynthSample(subtractive, filter, at, 440)).toBeTypeOf(
      "number",
    );
  });
});
