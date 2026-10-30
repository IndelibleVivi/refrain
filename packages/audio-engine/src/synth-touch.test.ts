import { describe, expect, it } from "vitest";
import { candidateById, validateSynthPatch } from "@refrain/soundpack";
import {
  processSynthSample,
  synthFilter,
  synthNotePatch,
} from "./synth-kernel.js";

const candidate = (id: string) => candidateById.get(id)!.patch!;

describe("Touch note-on timbre", () => {
  it("retains historical execution and never mutates the voice patch", () => {
    const historical = candidate("lattice-pluck-subtractive-original");
    expect(synthNotePatch(historical, 0.2)).toBe(historical);
    expect(synthNotePatch(historical, 0.9)).toBe(historical);
    const touch = candidate("lattice-pluck-touch-original");
    const bytes = JSON.stringify(touch);
    const quiet = synthNotePatch(touch, 0.2);
    const strong = synthNotePatch(touch, 0.9);
    expect(quiet).not.toEqual(strong);
    expect(quiet.attack).toBe(strong.attack);
    expect(quiet.release).toBe(strong.release);
    expect(JSON.stringify(touch)).toBe(bytes);
  });

  it("changes normalized signal shape, not just gain, in both families", () => {
    for (const id of [
      "lattice-pluck-touch-original",
      "prism-lead-touch-original",
    ]) {
      const patch = candidate(id);
      const render = (velocity: number) => {
        const note = synthNotePatch(patch, velocity);
        const filter = synthFilter(note, 24000);
        return Float64Array.from({ length: 12000 }, (_, i) =>
          processSynthSample(note, filter, i / 24000, 220),
        );
      };
      // Remove scalar loudness: a mere volume multiplier would correlate at 1.
      const soft = render(0.2),
        hard = render(0.95);
      let dot = 0,
        softEnergy = 0,
        hardEnergy = 0;
      for (let i = 0; i < soft.length; i++) {
        dot += soft[i]! * hard[i]!;
        softEnergy += soft[i]! ** 2;
        hardEnergy += hard[i]! ** 2;
      }
      expect(dot / Math.sqrt(softEnergy * hardEnergy)).toBeLessThan(0.985);
      expect(render(0.95)).toEqual(hard);
    }
  });

  it("clamps effective performance velocity, preserves tail bounds, and rejects non-finite input", () => {
    for (const id of [
      "lattice-pluck-touch-original",
      "glass-bell-touch-original",
      "prism-lead-touch-original",
      "air-pad-touch-original",
    ]) {
      const patch = candidate(id);
      expect(validateSynthPatch(patch)).toEqual([]);
      expect(synthNotePatch(patch, -1)).toEqual(synthNotePatch(patch, 0));
      expect(synthNotePatch(patch, 2)).toEqual(synthNotePatch(patch, 1));
      expect(synthNotePatch(patch, 0.5).release).toBe(patch.release);
      expect(() => synthNotePatch(patch, NaN)).toThrow("finite");
      expect(
        validateSynthPatch({ ...patch, hiddenHumanize: true }),
      ).not.toEqual([]);
      expect(validateSynthPatch({ ...patch, velocityExponent: 0 })).not.toEqual(
        [],
      );
    }
  });

  it("keeps old formats closed and rejects malformed response endpoints", () => {
    const touch = candidate("prism-lead-touch-original");
    expect(
      validateSynthPatch({
        ...touch,
        format: "refrain-synth-subtractive@0-experimental",
      }),
    ).not.toEqual([]);
    expect(
      validateSynthPatch({ ...touch, filterHz: { soft: 600, hard: Infinity } }),
    ).not.toEqual([]);
    expect(
      validateSynthPatch({
        ...touch,
        filterHz: { soft: 600, hard: 3000, auto: true },
      }),
    ).not.toEqual([]);
    if (touch.format !== "refrain-synth-subtractive@1-experimental")
      throw new Error("fixture");
    expect(
      validateSynthPatch({
        ...touch,
        oscillators: [
          { ...touch.oscillators[0], gain: { soft: -1, hard: 0.7 } },
        ],
      }),
    ).not.toEqual([]);
  });
});
