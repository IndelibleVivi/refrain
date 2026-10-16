import { describe, expect, it } from "vitest";
import { VOICE_IDS, type Manifest } from "./contracts";
import { createScore } from "./score";
import {
  newSession,
  applyArrangement,
  setVoice,
  durationSeconds,
  sectionFrame,
} from "./model";
import { assemble, encodeWav, decodePhrase, type PhrasePcm } from "./wav";
describe("exact frozen-stem mix", () => {
  it("preserves tail overlaps, excludes absent voices, and exports the same deterministic native-gain PCM", () => {
    const score = createScore(),
      frames = 600000,
      manifest: Manifest = {
        format: "nocturne-desk-manifest@0",
        score,
        mixGain: 0.85,
        audio: {},
      },
      pcm = new Map<string, PhrasePcm>();
    for (let s = 0; s < 6; s++)
      for (const v of VOICE_IDS) {
        const key = `${s}:${v}`;
        manifest.audio[key] = {
          file: "unused.wav",
          frames,
          bytes: 44 + frames * 4,
          sha256: "a".repeat(64),
        };
        pcm.set(key, {
          left: new Float32Array(frames).fill(v === "piano" ? 0.1 : 0.2),
          right: new Float32Array(frames).fill(v === "piano" ? -0.1 : -0.2),
        });
      }
    const session = applyArrangement(newSession(), "solitude"),
      p = assemble(manifest, session, pcm);
    expect(p.left.length).toBe(sectionFrame(5) + frames);
    expect(durationSeconds(manifest, session) * 44100).toBe(p.left.length);
    expect(p.left[0]).toBeCloseTo(0.085);
    expect(p.left[sectionFrame(1)]).toBeCloseTo(0.34);
    expect(p.right[sectionFrame(1)]).toBeCloseTo(-0.34);
    const q = assemble(manifest, setVoice(session, 0, "harp", true), pcm);
    expect(q.left[0]).toBeCloseTo(0.255);
    expect(q.left[sectionFrame(1)]).toBeCloseTo(0.51);
    const bytes = encodeWav(p);
    expect(Buffer.from(encodeWav(p)).equals(Buffer.from(bytes))).toBe(true);
    const decoded = decodePhrase(bytes.buffer as ArrayBuffer, p.left.length);
    expect(decoded.left[sectionFrame(1)]).toBeCloseTo(0.34, 4);
    pcm.delete("0:piano");
    expect(() => assemble(manifest, session, pcm)).toThrow();
  });
  it("rejects non-finite/clipping and mismatched channels rather than silently normalizing", () => {
    for (const value of [NaN, Infinity, 1.01])
      expect(() =>
        encodeWav({ left: Float32Array.of(value), right: Float32Array.of(0) }),
      ).toThrow();
    expect(() =>
      encodeWav({ left: Float32Array.of(0.1), right: new Float32Array(0) }),
    ).toThrow();
  });
});
