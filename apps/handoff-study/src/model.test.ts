import { describe, expect, it } from "vitest";
import {
  durationSeconds,
  choose,
  newSession,
  parseSession,
  routeChunks,
  routeOf,
  serializeSession,
  validateManifest,
} from "./model";
import { fixture } from "./test-fixture";
describe("phrase handoff continuation", () => {
  it("retains a complete default and changes future phrases at two fixed gates", () => {
    const m = fixture(),
      s = newSession(m),
      t = choose(s, 0, "piano", 12),
      u = choose(t, 1, "marimba", 33);
    expect(routeOf(s)).toBe("mp");
    expect(routeOf(u)).toBe("pm");
    expect(routeChunks(s).slice(0, 2)).toEqual(routeChunks(u).slice(0, 2));
    expect(routeChunks(u).slice(2, 5)).toEqual(["p", "p", "p"]);
    expect(routeChunks(u).slice(5)).toEqual(["m", "m", "m"]);
    expect(u.choices.map((c) => c.effectiveBeat)).toEqual([16, 40]);
    expect(s.choices).toEqual([]);
    expect(routeOf(u, true)).toBe("mp");
    expect(routeOf(u)).toBe("pm");
  });
  it("saves full work and exact sound references; object transport order is irrelevant", () => {
    const m = fixture(),
      s = choose(newSession(m), 0, "piano", 4);
    const parsed = JSON.parse(serializeSession(s));
    parsed.work = Object.fromEntries(Object.entries(parsed.work).reverse());
    expect(parseSession(JSON.stringify(parsed), m)).toEqual(s);
    expect(parsed.work.routes).toBeDefined();
    expect(parsed.work.chunks).toHaveLength(2);
    expect(parsed.audio.p.sha256).toBe(m.audio.p.sha256);
  });
  it("uses the selected comparison's exact tail duration", () => {
    const m = fixture();
    m.audio.m.frames = 330000;
    const s = choose(newSession(m), 1, "marimba", 30);
    expect(durationSeconds(s)).toBe((7 * 220500 + 330000) / 44100);
    expect(durationSeconds(s, true)).toBe((7 * 220500 + 300000) / 44100);
  });
  it("rejects substituted work, sound, version, duplicate gates and impossible effective timing", () => {
    const m = fixture(),
      s = choose(newSession(m), 0, "piano", 4);
    for (const mutate of [
      (v: any) => (v.work.title = "different"),
      (v: any) => (v.audio.p.sha256 = "b".repeat(64)),
      (v: any) => (v.format = "handoff-study-session@1"),
      (v: any) => v.choices.push(v.choices[0]),
      (v: any) => (v.choices[0].effectiveBeat = 15),
      (v: any) => (v.choices[0].requestedBeat = 16),
      (v: any) => (v.privateContext = "not accepted"),
    ]) {
      const v = JSON.parse(serializeSession(s));
      mutate(v);
      expect(() => parseSession(JSON.stringify(v), m)).toThrow();
    }
    expect(() => choose(s, 0, "piano", 16)).toThrow();
    expect(() => choose(s, 0, "piano", NaN)).toThrow();
    expect(() =>
      validateManifest({
        ...m,
        audio: { ...m.audio, p: { ...m.audio.p, file: "../other.wav" } },
      }),
    ).toThrow();
  });
});
