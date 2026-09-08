import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleWithLookahead } from "./lookahead.js";

afterEach(() => vi.useRealTimers());

describe("scheduleWithLookahead", () => {
  it("does not dispatch a future note after cancellation", () => {
    vi.useFakeTimers();
    let now = 0;
    const sent: string[] = [];
    const cancel = scheduleWithLookahead(
      [
        { offsetSeconds: 0, order: 0, run: () => sent.push("first") },
        { offsetSeconds: 3, order: 0, run: () => sent.push("later") },
      ],
      0.08,
      {
        now: () => now,
        setTimer: (callback, delay) =>
          Number(setTimeout(callback, delay) as unknown),
        clearTimer: (timer) => clearTimeout(timer),
      },
    );
    expect(sent).toEqual(["first"]);
    cancel();
    now = 4;
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual(["first"]);
  });

  it("schedules each event once across a fresh replay", () => {
    vi.useFakeTimers();
    let now = 0;
    const sent: string[] = [];
    const clock = {
      now: () => now,
      setTimer: (callback: () => void, delay: number) =>
        Number(setTimeout(callback, delay) as unknown),
      clearTimer: (timer: number) => clearTimeout(timer),
    };
    const actions = [
      { offsetSeconds: 0, order: 0, run: () => sent.push("note") },
    ];
    scheduleWithLookahead(actions, 0.08, clock);
    now = 1;
    vi.runAllTimers();
    scheduleWithLookahead(actions, 1.08, clock);
    expect(sent).toEqual(["note", "note"]);
  });
});
