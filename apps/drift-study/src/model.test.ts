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
const historical = () =>
  serializeSession({ ...createSession(), format: "drift-study-session@0" });
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
describe("Drift study direct plucks", () => {
  it("keeps @0 sessions exact and rejects plucks in paths or bookmarks", () => {
    const saved = historical();
    const reopened = parseSession(saved);
    expect(reopened.format).toBe("drift-study-session@0");
    expect(serializeSession(reopened)).toBe(saved);
    const path = JSON.parse(saved);
    path.gestures = [{ at: 5, kind: "pluck", note: 0, layers: "a" }];
    expect(() => parseSession(JSON.stringify(path))).toThrow();
    const kept = JSON.parse(saved);
    kept.bookmarks = [
      {
        name: "旧岔口",
        at: 5,
        gestures: [{ at: 5, kind: "pluck", note: 0, layers: "a" }],
      },
    ];
    expect(() => parseSession(JSON.stringify(kept))).toThrow();
  });
  it("starts new sessions at @1, round-trips plucks, and upgrades old @0 edits", () => {
    const base = createSession();
    expect(base.format).toBe("drift-study-session@1");
    let s = withGesture(base, {
      at: 4,
      kind: "pluck",
      note: 2,
      layers: "both",
    });
    s = withGesture(s, { at: 9, kind: "pluck", note: 0, layers: "b" });
    expect(parseSession(serializeSession(s))).toEqual(s);

    const old = parseSession(historical());
    const plucked = withGesture(old, {
      at: 6,
      kind: "pluck",
      note: 1,
      layers: "a",
    });
    expect(old.format).toBe("drift-study-session@0");
    expect(plucked.format).toBe("drift-study-session@1");
    expect(parseSession(serializeSession(plucked))).toEqual(plucked);
    expect(
      withGesture(old, { at: 6, kind: "layers", layers: "a" }).format,
    ).toBe("drift-study-session@0");
  });
  it("rejects pluck note indices outside the material and non-integer indices", () => {
    const base = createSession();
    const ok = withGesture(base, {
      at: 1,
      kind: "pluck",
      note: 0,
      layers: "a",
    });
    expect(() =>
      withGesture(base, { at: 3, kind: "pluck", note: 4, layers: "a" }),
    ).toThrow();
    expect(() =>
      withGesture(base, { at: 3, kind: "pluck", note: -1, layers: "a" }),
    ).toThrow();
    const shaped = JSON.parse(serializeSession(ok));
    shaped.gestures = [{ at: 1, kind: "pluck", note: 1.5, layers: "a" }];
    expect(() => parseSession(JSON.stringify(shaped))).toThrow();
    shaped.gestures = [{ at: 1, kind: "pluck", note: 0, layers: "c" }];
    expect(() => parseSession(JSON.stringify(shaped))).toThrow();
  });
  it("leaves phase, rules and layer selection unchanged while keeping order", () => {
    const base = createSession();
    const plucked = withGesture(base, {
      at: 3,
      kind: "pluck",
      note: 0,
      layers: "b",
    });
    const facts = (s: ReturnType<typeof createSession>, t: number) => {
      const m = momentAt(s, t);
      return {
        frozen: m.frozen,
        layers: m.layers,
        rules: m.rules,
        phaseA: +m.phaseA.toFixed(10),
        phaseB: +m.phaseB.toFixed(10),
        evolution: +m.evolution.toFixed(6),
        erosion: +m.erosion.toFixed(6),
        bloom: +m.bloom.toFixed(6),
      };
    };
    for (const t of [0, 1, 2.99, 3, 3.5, 12, 40, 71.9])
      expect(facts(plucked, t)).toEqual(facts(base, t));
    let ordered = withGesture(base, {
      at: 5,
      kind: "rules",
      rules: { drift: 1, erosion: 0, bloom: 0 },
    });
    ordered = withGesture(ordered, {
      at: 5,
      kind: "pluck",
      note: 0,
      layers: "a",
    });
    ordered = withGesture(ordered, {
      at: 5,
      kind: "pluck",
      note: 2,
      layers: "b",
    });
    expect(ordered.gestures.map((g) => g.kind)).toEqual([
      "rules",
      "pluck",
      "pluck",
    ]);
    let path = withGesture(base, {
      at: 20,
      kind: "pluck",
      note: 2,
      layers: "a",
    });
    path = withGesture(path, { at: 30, kind: "layers", layers: "b" });
    const branch = withGesture(path, { at: 10, kind: "freeze", frozen: true });
    expect(branch.gestures.map((g) => g.kind)).toEqual(["freeze"]);
    expect(momentAt(branch, 31).layers).toBe("both");
  });
});
