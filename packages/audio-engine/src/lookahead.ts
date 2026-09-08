export interface LookaheadAction {
  offsetSeconds: number;
  order: number;
  run: (audioTime: number) => void;
}

export interface LookaheadClock {
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => number;
  clearTimer: (timer: number) => void;
}

export function scheduleWithLookahead(
  actions: LookaheadAction[],
  startedAt: number,
  clock: LookaheadClock,
  horizonSeconds = 0.2,
  intervalMs = 50,
): () => void {
  const ordered = [...actions].sort(
    (left, right) =>
      left.offsetSeconds - right.offsetSeconds || left.order - right.order,
  );
  let index = 0;
  let timer: number | undefined;
  let cancelled = false;

  const tick = () => {
    if (cancelled) return;
    const horizon = clock.now() + horizonSeconds;
    while (
      index < ordered.length &&
      startedAt + ordered[index]!.offsetSeconds <= horizon
    ) {
      const action = ordered[index]!;
      action.run(startedAt + action.offsetSeconds);
      index += 1;
    }
    if (index < ordered.length) {
      timer = clock.setTimer(tick, intervalMs);
    }
  };

  tick();
  return () => {
    cancelled = true;
    if (timer !== undefined) clock.clearTimer(timer);
  };
}
