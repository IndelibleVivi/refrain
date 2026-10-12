import { describe, expect, it } from "vitest";
import { newSession, choose } from "./model";
import { assemble, decodePhrase } from "./wav";
import { encodeWav } from "./wav-encoder";
import { fixture } from "./test-fixture";
describe("frozen phrase execution", () => {
  it("preserves overlapping releases and makes the chosen route audible in exact exported PCM", () => {
    const session = newSession(fixture()),
      p = {
        left: new Float32Array(300000).fill(0.125),
        right: new Float32Array(300000).fill(0.25),
      },
      m = {
        left: new Float32Array(300000).fill(-0.125),
        right: new Float32Array(300000).fill(-0.25),
      },
      pcm = new Map([
        ["p", p],
        ["m", m],
      ]);
    const a = assemble(session, pcm),
      b = assemble(choose(session, 0, "piano", 3), pcm);
    expect(a.left.length).toBe(7 * 220500 + 300000);
    expect(a.left[220500]).toBeCloseTo(0.2); // both first phrases still sounding
    expect(a.left[2 * 220500]).toBeCloseTo(0); // piano release + marimba answer
    expect(b.left[2 * 220500]).toBeCloseTo(0.2);
    const bytes = encodeWav(a),
      again = decodePhrase(bytes, a.left.length);
    expect(again.left[220500]).toBeCloseTo(a.left[220500], 4);
    expect(new DataView(bytes).getUint32(24, true)).toBe(44100);
    expect(encodeWav(assemble(session, pcm))).toEqual(bytes);
  });
  it("rejects clipped output and truncated or substituted WAV formats", () => {
    expect(() =>
      encodeWav({ left: Float32Array.of(1.2), right: Float32Array.of(0) }),
    ).toThrow();
    const bytes = encodeWav({
      left: Float32Array.of(0.1),
      right: Float32Array.of(-0.1),
    });
    expect(() => decodePhrase(bytes.slice(0, 45), 1)).toThrow();
    expect(() => decodePhrase(bytes, 2)).toThrow();
    const other = bytes.slice(0);
    new DataView(other).setUint32(24, 48000, true);
    expect(() => decodePhrase(other, 1)).toThrow();
  });
});
