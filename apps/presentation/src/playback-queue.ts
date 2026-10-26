export const PLAYBACK_MODES = [
  "sequential",
  "repeat-all",
  "shuffle",
  "repeat-one",
] as const;

export type PlaybackMode = (typeof PLAYBACK_MODES)[number];

export type QueueDecision =
  { kind: "play" | "restart"; entryId: string } | { kind: "stop" };

export interface QueueSnapshot {
  readonly entries: readonly string[];
  readonly currentId: string | undefined;
  readonly mode: PlaybackMode;
  readonly history: readonly string[];
  readonly remaining: readonly string[];
}

const MAX_QUEUE_ENTRIES = 1_024;
const MAX_HISTORY = 256;

export function readPlaybackMode(value: unknown): PlaybackMode {
  return PLAYBACK_MODES.includes(value as PlaybackMode)
    ? (value as PlaybackMode)
    : "sequential";
}

export function cyclePlaybackMode(mode: PlaybackMode): PlaybackMode {
  return PLAYBACK_MODES[
    (PLAYBACK_MODES.indexOf(mode) + 1) % PLAYBACK_MODES.length
  ]!;
}

function checkedEntries(entries: readonly string[]): string[] {
  if (entries.length > MAX_QUEUE_ENTRIES) throw new Error("QUEUE_TOO_LARGE");
  if (
    entries.some(
      (entryId) =>
        typeof entryId !== "string" || !entryId || entryId.length > 1_024,
    )
  )
    throw new Error("INVALID_ENTRY_ID");
  if (new Set(entries).size !== entries.length)
    throw new Error("DUPLICATE_ENTRY_ID");
  return [...entries];
}

/** Presentation-only queue policy. Entry IDs never become musical identity. */
export class PlaybackQueue {
  private entries: string[];
  private currentId: string | undefined;
  private mode: PlaybackMode;
  private remaining: string[] = [];
  private history: string[] = [];
  private forward: string[] = [];
  private firstBag = true;
  private readonly random: () => number;

  constructor(
    entries: readonly string[],
    options: {
      currentId?: string;
      mode?: PlaybackMode;
      random?: () => number;
    } = {},
  ) {
    this.entries = checkedEntries(entries);
    if (
      options.currentId !== undefined &&
      !this.entries.includes(options.currentId)
    )
      throw new Error("UNKNOWN_ENTRY_ID");
    this.currentId = options.currentId ?? this.entries[0];
    this.mode = readPlaybackMode(options.mode);
    this.random = options.random ?? Math.random;
  }

  snapshot(): QueueSnapshot {
    return {
      entries: [...this.entries],
      currentId: this.currentId,
      mode: this.mode,
      history: [...this.history],
      remaining: [...this.remaining],
    };
  }

  setMode(mode: PlaybackMode): void {
    if (!PLAYBACK_MODES.includes(mode))
      throw new Error("INVALID_PLAYBACK_MODE");
    if (this.mode === mode) return;
    this.mode = mode;
    this.remaining = [];
    this.forward = [];
    this.firstBag = true;
  }

  cycleMode(): PlaybackMode {
    this.setMode(cyclePlaybackMode(this.mode));
    return this.mode;
  }

  replaceEntries(entries: readonly string[], selectedId?: string): void {
    const next = checkedEntries(entries);
    if (selectedId !== undefined && !next.includes(selectedId))
      throw new Error("UNKNOWN_ENTRY_ID");
    this.entries = next;
    this.currentId =
      selectedId ??
      (this.currentId && next.includes(this.currentId)
        ? this.currentId
        : next[0]);
    this.history = this.history.filter((entryId) => next.includes(entryId));
    this.forward = [];
    this.remaining = [];
    this.firstBag = true;
  }

  select(entryId: string): QueueDecision {
    if (!this.entries.includes(entryId)) throw new Error("UNKNOWN_ENTRY_ID");
    this.forward = [];
    this.remaining = this.remaining.filter(
      (candidate) => candidate !== entryId,
    );
    return this.move(entryId);
  }

  next(reason: "ended" | "next" = "next"): QueueDecision {
    if (!this.entries.length) return { kind: "stop" };
    if (reason === "ended" && this.mode === "repeat-one" && this.currentId)
      return { kind: "restart", entryId: this.currentId };

    const forward = this.forward.shift();
    if (forward !== undefined) return this.move(forward);
    if (this.mode === "shuffle") return this.nextShuffled();

    const index =
      this.currentId === undefined ? -1 : this.entries.indexOf(this.currentId);
    let nextIndex = index + 1;
    if (nextIndex >= this.entries.length) {
      if (this.mode === "sequential") return { kind: "stop" };
      nextIndex = 0;
    }
    return this.move(this.entries[nextIndex]!);
  }

  previous(): QueueDecision {
    const historical = this.history.pop();
    if (historical !== undefined) {
      if (this.currentId !== undefined) {
        this.forward.unshift(this.currentId);
        this.forward = this.forward.slice(0, MAX_HISTORY);
      }
      this.currentId = historical;
      return { kind: "play", entryId: historical };
    }
    if (this.currentId === undefined) return { kind: "stop" };
    if (this.mode === "shuffle")
      return { kind: "restart", entryId: this.currentId };
    const index = this.entries.indexOf(this.currentId);
    const target =
      index > 0
        ? this.entries[index - 1]
        : this.mode === "sequential"
          ? undefined
          : this.entries.at(-1);
    if (!target) return { kind: "restart", entryId: this.currentId };
    this.forward.unshift(this.currentId);
    this.forward = this.forward.slice(0, MAX_HISTORY);
    this.currentId = target;
    return { kind: "play", entryId: target };
  }

  private move(entryId: string): QueueDecision {
    if (entryId === this.currentId) return { kind: "restart", entryId };
    if (this.currentId !== undefined) {
      this.history.push(this.currentId);
      if (this.history.length > MAX_HISTORY) this.history.shift();
    }
    this.currentId = entryId;
    return { kind: "play", entryId };
  }

  private nextShuffled(): QueueDecision {
    if (this.entries.length === 1) return this.move(this.entries[0]!);
    if (!this.remaining.length) {
      const bag = this.firstBag
        ? this.entries.filter((entryId) => entryId !== this.currentId)
        : [...this.entries];
      for (let index = bag.length - 1; index > 0; index -= 1) {
        const value = this.random();
        if (!Number.isFinite(value) || value < 0 || value >= 1)
          throw new Error("INVALID_RANDOM_SOURCE");
        const other = Math.floor(value * (index + 1));
        [bag[index], bag[other]] = [bag[other]!, bag[index]!];
      }
      if (bag[0] === this.currentId && bag.length > 1)
        [bag[0], bag[1]] = [bag[1]!, bag[0]!];
      this.remaining = bag;
      this.firstBag = false;
    }
    return this.move(this.remaining.shift()!);
  }
}
