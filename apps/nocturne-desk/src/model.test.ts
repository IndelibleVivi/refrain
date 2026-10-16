import { describe, expect, it } from "vitest";
import { compileAirV1 } from "@refrain/compiler/v1";
import { parseRefrainArtifact } from "@refrain/renderer/portable";
import { createScore, buildSource, buildArtifact, stemSource } from "./score";
import { VOICE_IDS, type Manifest } from "./contracts";
import {
  newSession,
  parseSession,
  serializeSession,
  setVoice,
  applyArrangement,
  validateManifest,
  stemKey,
} from "./model";
export function fixture(): Manifest {
  const score = createScore();
  return {
    format: "nocturne-desk-manifest@0",
    score,
    mixGain: 0.85,
    audio: Object.fromEntries(
      score.sections.flatMap((_, s) =>
        VOICE_IDS.map((v) => [
          stemKey(s, v),
          {
            file: `${s}-${v}-${"a".repeat(16)}.wav`,
            sha256: "a".repeat(64),
            frames: 600000,
            bytes: 2400044,
          },
        ]),
      ),
    ),
  };
}
describe("authored chamber score and exact continuation", () => {
  it("compiles all 24 independent phrases and the complete 24-bar form into a portable bound artifact", () => {
    const session = newSession(),
      score = createScore();
    for (let s = 0; s < 6; s++)
      for (const v of VOICE_IDS) {
        const c = compileAirV1(stemSource(s, v));
        expect(c.compiled, c.diagnostics.join("\n")).toBeDefined();
        expect(c.compiled!.durationBeats).toBe(16);
        expect(score.sections[s]!.notes[v].length).toBeGreaterThan(0);
      }
    for (const preset of ["manuscript", "solitude", "constellation"] as const) {
      const s = applyArrangement(session, preset),
        artifact = buildArtifact(s);
      expect(parseRefrainArtifact(artifact).ok).toBe(true);
      const c = compileAirV1(artifact.source);
      expect(c.compiled!.durationBeats).toBe(96);
      expect(artifact.performanceBindings).toHaveLength(1);
    }
  });
  it("exports only chosen notes with exact section offsets, keeping rests and immutable authoring", () => {
    const original = newSession(),
      s = setVoice(original, 0, "piano", false),
      c = compileAirV1(buildSource(s)).compiled!;
    expect(original.arrangement[0]![0]).toBe(true);
    for (let page = 0; page < 6; page++)
      for (const [vi, v] of VOICE_IDS.entries()) {
        const notes = c.events.filter(
          (e) =>
            e.voiceId === v &&
            e.notatedStartBeat >= page * 16 &&
            e.notatedStartBeat < (page + 1) * 16,
        );
        const expected = s.arrangement[page]![vi]
          ? createScore().sections[page]!.notes[v]
          : [];
        expect(
          notes.map((e) => ({
            at: e.notatedStartBeat - page * 16,
            duration: e.durationBeats,
            midi: e.midi,
            velocity: e.velocity,
          })),
        ).toEqual(expected);
      }
  });
  it("roundtrips choices, rejects corrupt/stale/extra fields and prevents an empty page", () => {
    const s = setVoice(newSession(), 2, "cello", false);
    expect(parseSession(JSON.parse(serializeSession(s)))).toEqual(s);
    for (const change of [
      (x: any) => (x.workId = "another-work"),
      (x: any) => (x.format = "nocturne-desk-session@1"),
      (x: any) => (x.arrangement[2] = [false, false, false, false]),
      (x: any) => (x.arrangement[1][0] = 1),
      (x: any) => (x.privateContext = "no"),
      (x: any) => (x.title = "\u0000"),
    ]) {
      const next = structuredClone(s);
      change(next);
      expect(() => parseSession(next)).toThrow();
    }
    expect(() =>
      setVoice(applyArrangement(s, "solitude"), 0, "piano", false),
    ).toThrow();
    const detached = parseSession(s);
    detached.arrangement[0]![0] = false;
    expect(s.arrangement[0]![0]).toBe(true);
  });
  it("requires all 24 exact, bounded, same-work audio references", () => {
    const m = fixture();
    expect(validateManifest(m)).toEqual(m);
    for (const change of [
      (x: any) => delete x.audio["5:harp"],
      (x: any) => (x.audio["0:piano"].file = "../other.wav"),
      (x: any) => x.audio["0:piano"].bytes--,
      (x: any) => (x.audio["0:piano"].frames = Infinity),
      (x: any) => x.score.sections[0].notes.piano[0].midi++,
      (x: any) => (x.mixGain = 1),
    ]) {
      const next = structuredClone(m);
      change(next);
      expect(() => validateManifest(next)).toThrow();
    }
  });
});
