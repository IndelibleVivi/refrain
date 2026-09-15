import { describe, expect, it } from "vitest";
import {
  PlaybackQueue,
  PLAYBACK_MODES,
  cyclePlaybackMode,
  readPlaybackMode,
  type QueueDecision,
} from "./playback-queue.js";

const ids = ["a", "b", "c", "d"];

function playedEntry(decision: QueueDecision): string {
  if (decision.kind === "stop") throw new Error("Expected a playable entry");
  return decision.entryId;
}

function seeded(initial: number) {
  let seed = initial;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 2 ** 32;
  };
}

describe("presentation playback queue", () => {
  it("cycles through all four requested modes", () => {
    expect(PLAYBACK_MODES.map(cyclePlaybackMode)).toEqual([
      "repeat-all",
      "shuffle",
      "repeat-one",
      "sequential",
    ]);
    expect(readPlaybackMode("shuffle")).toBe("shuffle");
    expect(readPlaybackMode("unknown")).toBe("sequential");
  });

  it("stops at the end in sequential mode and wraps in repeat-all", () => {
    const sequential = new PlaybackQueue(["a", "b"]);
    expect(sequential.next("ended")).toEqual({ kind: "play", entryId: "b" });
    expect(sequential.next("ended")).toEqual({ kind: "stop" });
    expect(sequential.snapshot().currentId).toBe("b");

    const repeating = new PlaybackQueue(["a", "b"], { mode: "repeat-all" });
    expect(repeating.next("ended")).toEqual({ kind: "play", entryId: "b" });
    expect(repeating.next("ended")).toEqual({ kind: "play", entryId: "a" });
  });

  it("restarts only a natural end in repeat-one", () => {
    const queue = new PlaybackQueue(["a", "b"], { mode: "repeat-one" });
    expect(queue.next("ended")).toEqual({ kind: "restart", entryId: "a" });
    expect(queue.next("next")).toEqual({ kind: "play", entryId: "b" });
  });

  it("uses complete shuffle bags without adjacent repeats", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const queue = new PlaybackQueue(ids, {
        mode: "shuffle",
        random: seeded(seed),
      });
      const first = ids.slice(1).map(() => playedEntry(queue.next("ended")));
      expect([...first].sort()).toEqual(ids.slice(1));
      let previous = first.at(-1);
      for (let passIndex = 0; passIndex < 8; passIndex += 1) {
        const pass = ids.map(() => playedEntry(queue.next("ended")));
        expect([...pass].sort()).toEqual(ids);
        expect(pass[0]).not.toBe(previous);
        pass
          .slice(1)
          .forEach((entryId, index) => expect(entryId).not.toBe(pass[index]));
        previous = pass.at(-1);
      }
    }
  });

  it("keeps manual selection explicit and inert for empty queues", () => {
    const queue = new PlaybackQueue(ids);
    expect(queue.select("c")).toEqual({ kind: "play", entryId: "c" });
    expect(queue.snapshot().currentId).toBe("c");
    expect(new PlaybackQueue([]).next("ended")).toEqual({ kind: "stop" });
    expect(() => queue.select("missing")).toThrow("UNKNOWN_ENTRY_ID");
  });

  it("replaces membership without mutating the supplied list", () => {
    const queue = new PlaybackQueue(ids);
    queue.next();
    const next = ["b", "d"];
    queue.replaceEntries(next, "d");
    next.push("outside");
    expect(queue.snapshot().entries).toEqual(["b", "d"]);
    expect(queue.snapshot().currentId).toBe("d");
  });
});
