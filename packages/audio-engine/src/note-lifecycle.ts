import type { PerformanceEvent } from "./performance.js";

export interface NoteLifecycleAction {
  beat: number;
  type: "noteOn" | "noteOff";
  event: PerformanceEvent;
}

interface Boundary {
  beat: number;
  kind: "start" | "end";
  event: PerformanceEvent;
}

/**
 * Preserve every authored attack while releasing a channel/pitch only after
 * all overlapping sounding events for that key have ended.
 */
export function createNoteLifecycle(
  events: readonly PerformanceEvent[],
): NoteLifecycleAction[] {
  const groups = new Map<string, Boundary[]>();
  for (const event of events) {
    const key = `${event.channel}:${event.midi}`;
    const boundaries = groups.get(key) ?? [];
    boundaries.push({ beat: event.startBeat, kind: "start", event });
    boundaries.push({ beat: event.noteOffBeat, kind: "end", event });
    groups.set(key, boundaries);
  }

  const actions: NoteLifecycleAction[] = [];
  for (const boundaries of groups.values()) {
    boundaries.sort(
      (left, right) =>
        left.beat - right.beat ||
        (left.kind === right.kind ? 0 : left.kind === "end" ? -1 : 1),
    );
    let active = 0;
    for (const boundary of boundaries) {
      if (boundary.kind === "start") {
        active += 1;
        actions.push({
          beat: boundary.beat,
          type: "noteOn",
          event: boundary.event,
        });
        continue;
      }
      active = Math.max(0, active - 1);
      if (active === 0) {
        actions.push({
          beat: boundary.beat,
          type: "noteOff",
          event: boundary.event,
        });
      }
    }
  }
  return actions.sort(
    (left, right) =>
      left.beat - right.beat ||
      (left.type === right.type ? 0 : left.type === "noteOff" ? -1 : 1) ||
      left.event.channel - right.event.channel ||
      left.event.midi - right.event.midi,
  );
}
