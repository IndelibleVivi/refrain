import { describe, expect, it } from "vitest";
import { BiquadLowPass, lowPassCoefficients } from "./filter.js";

describe("shared synth low-pass", () => {
  it("uses cutoff and Q in a stable realtime/offline coefficient contract", () => {
    const soft = lowPassCoefficients(1800, 0.4, 44_100);
    const resonant = lowPassCoefficients(1800, 1.2, 44_100);
    expect(soft).not.toEqual(resonant);

    const filter = new BiquadLowPass(1800, 0.7, 44_100);
    const response = Array.from({ length: 128 }, (_, index) =>
      filter.process(index === 0 ? 1 : 0),
    );
    expect(response.every(Number.isFinite)).toBe(true);
    expect(Math.max(...response.map(Math.abs))).toBeLessThan(1);
    expect(response.at(-1)).toBeCloseTo(0, 3);
  });
});
