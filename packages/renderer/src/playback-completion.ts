export interface PlaybackRun {
  readonly identity: string;
  readonly runId: number;
}

export interface CompletionSnapshot {
  readonly status: string;
  readonly generation: number;
}

export interface NaturalPlaybackEnd extends PlaybackRun {
  readonly reason: "natural";
}

/** Admits one real transport end for the current audible playback run. */
export class PlaybackCompletionGate {
  private sequence = 0;
  private active: PlaybackRun | undefined;
  private playingGeneration: number | undefined;
  private highestGeneration = -1;

  begin(identity: string): PlaybackRun {
    if (!identity) throw new Error("MISSING_PLAYBACK_IDENTITY");
    const run = Object.freeze({ identity, runId: ++this.sequence });
    this.active = run;
    this.playingGeneration = undefined;
    this.highestGeneration = -1;
    return run;
  }

  cancel(run?: PlaybackRun): void {
    if (run !== undefined && run !== this.active) return;
    this.active = undefined;
    this.playingGeneration = undefined;
  }

  observe(
    run: PlaybackRun,
    snapshot: CompletionSnapshot,
  ): NaturalPlaybackEnd | undefined {
    if (
      run !== this.active ||
      !Number.isSafeInteger(snapshot.generation) ||
      snapshot.generation < 0
    )
      return undefined;
    if (snapshot.generation < this.highestGeneration) return undefined;
    this.highestGeneration = snapshot.generation;
    if (snapshot.status === "playing") {
      this.playingGeneration = snapshot.generation;
      return undefined;
    }
    if (
      snapshot.status === "ended" &&
      this.playingGeneration === snapshot.generation
    ) {
      this.cancel(run);
      return { ...run, reason: "natural" };
    }
    if (["paused", "ready", "idle", "error"].includes(snapshot.status))
      this.cancel(run);
    return undefined;
  }
}
