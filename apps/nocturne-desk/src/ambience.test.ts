import { describe, expect, it } from "vitest";
import { leafNoise } from "./ambience";
describe("local leaf wind texture", () => {
  it("is deterministic, quiet, non-silent, zero-centred and click-free at the loop seam", () => {
    const a = leafNoise(48000 * 2, 48000),
      b = leafNoise(48000 * 2, 48000);
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    let peak = 0,
      sum = 0,
      squares = 0;
    for (const n of a) {
      expect(Number.isFinite(n)).toBe(true);
      peak = Math.max(peak, Math.abs(n));
      sum += n;
      squares += n * n;
    }
    expect(peak).toBeLessThan(0.25);
    expect(Math.sqrt(squares / a.length)).toBeGreaterThan(0.005);
    expect(Math.abs(sum / a.length)).toBeLessThan(0.01);
    expect(Math.abs(a[0]!)).toBe(0);
    expect(Math.abs(a.at(-1)!)).toBe(0);
  });
});
