import { describe, expect, it } from "vitest";
import {
  createSession,
  momentAt,
  parseSession,
  serializeSession,
  withGesture,
} from "./model";

const delta = (s: ReturnType<typeof createSession>, t: number) => {
  const m = momentAt(s, t);
  return (m.phaseB - m.phaseA + 1) % 1;
};
describe("Drift study editable work and performance", () => {
  it("freezes evolution and relative phase while the loop clock keeps moving", () => {
    const s = withGesture(createSession(), {
      at: 10,
      kind: "freeze",
      frozen: true,
    });
    const before = momentAt(s, 10),
      later = momentAt(s, 12);
    expect(later.evolution).toBe(before.evolution);
    expect(later.erosion).toBe(before.erosion);
    expect(later.bloom).toBe(before.bloom);
    expect(delta(s, 12)).toBeCloseTo(delta(s, 10), 12);
    expect(later.phaseA).not.toBe(before.phaseA);
  });
  it("resumes from the held process, without catching up to wall time", () => {
    let s = withGesture(createSession(), {
      at: 10,
      kind: "freeze",
      frozen: true,
    });
    s = withGesture(s, { at: 30, kind: "freeze", frozen: false });
    expect(momentAt(s, 30).evolution).toBe(10);
    expect(momentAt(s, 32).evolution).toBe(12);
  });
  it("changes phase velocity without teleporting phase", () => {
    const original = createSession();
    const changed = withGesture(original, {
      at: 7,
      kind: "rules",
      rules: { drift: 1, erosion: 0, bloom: 0 },
    });
    expect(delta(changed, 7)).toBeCloseTo(delta(original, 7), 12);
    expect(delta(changed, 9)).toBeGreaterThan(delta(original, 9));
    expect(momentAt(changed, 9).erosion).toBe(momentAt(changed, 7).erosion);
  });
  it("branches in the past, retains same-time order, and preserves named paths", () => {
    let s = withGesture(createSession(), {
      at: 5,
      kind: "freeze",
      frozen: true,
    });
    s = withGesture(s, { at: 30, kind: "layers", layers: "a" });
    s.bookmarks = [
      { name: "原来的路", at: 31, gestures: structuredClone(s.gestures) },
    ];
    const before = structuredClone(s);
    const branch = withGesture(s, { at: 5, kind: "freeze", frozen: false });
    expect(s).toEqual(before);
    expect(branch.gestures).toHaveLength(2);
    expect(momentAt(branch, 31).layers).toBe("both");
    expect(momentAt(branch, 6).frozen).toBe(false);
    expect(branch.bookmarks[0].gestures).toEqual(before.gestures);
  });
  it("round-trips rules, material, future actions and bookmarks", () => {
    let s = withGesture(createSession(), {
      at: 16,
      kind: "layers",
      layers: "b",
    });
    s = withGesture(s, { at: 35, kind: "freeze", frozen: true });
    s.cursor = 12;
    s.bookmarks = [
      { name: "还没走散", at: 12, gestures: structuredClone(s.gestures) },
    ];
    const reopened = parseSession(serializeSession(s));
    expect(reopened).toEqual(s);
    for (const t of [0, 12, 16, 35, 55, 72])
      expect(momentAt(reopened, t)).toEqual(momentAt(s, t));
  });
  it.each([
    (s: any) => {
      s.format = "refrain-artifact@3-experimental";
    },
    (s: any) => {
      s.work.rules.extra = 1;
    },
    (s: any) => {
      s.work.notes[0].midi = 200;
    },
    (s: any) => {
      s.cursor = 1000;
    },
    (s: any) => {
      s.gestures = [
        { at: 10, kind: "freeze", frozen: true },
        { at: 2, kind: "layers", layers: "a" },
      ];
    },
    (s: any) => {
      s.bookmarks = [{ name: "bad", at: -1, gestures: [] }];
    },
  ])("rejects unsupported or invalid saved facts", (mutate) => {
    const s = createSession();
    mutate(s);
    expect(() => parseSession(JSON.stringify(s))).toThrow();
  });
});
