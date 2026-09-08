import type { PerformanceEvent } from "./performance.js";
import {
  REFERENCE_SAMPLE_RATE,
  performanceEventAt,
  type ExecutionBundle,
} from "./execution.js";

export const TRANSPORT_SNAPSHOT_FORMAT =
  "refrain-transport-snapshot@0-experimental" as const;

export type ExecutionTransportStatus =
  | "idle"
  | "preparing"
  | "ready"
  | "playing"
  | "paused"
  | "buffering"
  | "ended"
  | "error";

export interface ActiveVoiceSnapshot {
  eventIndex: number;
  phase: "attack" | "sustain" | "release";
  elapsedFrames: number;
  attackSourceOffsetFrames: number;
  releaseSourceOffsetFrames?: number;
  oscillatorPhaseCycles?: number;
}

export interface TransportSnapshotV0 {
  format: typeof TRANSPORT_SNAPSHOT_FORMAT;
  performancePlanSha256: string;
  sampleRate: typeof REFERENCE_SAMPLE_RATE;
  positionFrame: number;
  generation: number;
  status: ExecutionTransportStatus;
  sectionId?: string;
  activeVoices: ActiveVoiceSnapshot[];
  sceneState: { checkpointFrame: number };
}

export interface ExecutionEventCursor {
  nextStartIndex: number;
  nextReleaseIndex: number;
  generation: number;
}

export interface ExecutionWindow {
  fromFrame: number;
  toFrame: number;
  attacks: number[];
  releases: number[];
}

function lowerBound(values: Uint32Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function releaseLowerBound(bundle: ExecutionBundle, target: number): number {
  let low = 0;
  let high = bundle.index.releaseOrder.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const eventIndex = bundle.index.releaseOrder[middle]!;
    if (bundle.index.noteOffFrames[eventIndex]! < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function createExecutionCursor(
  bundle: ExecutionBundle,
  frame: number,
  generation: number,
): ExecutionEventCursor {
  const bounded = Math.max(
    0,
    Math.min(
      Math.round(bundle.plan.renderDurationSeconds * REFERENCE_SAMPLE_RATE),
      Math.round(frame),
    ),
  );
  return {
    nextStartIndex: lowerBound(bundle.index.eventStartFrames, bounded),
    nextReleaseIndex: releaseLowerBound(bundle, bounded),
    generation,
  };
}

export function pullExecutionWindow(
  bundle: ExecutionBundle,
  cursor: ExecutionEventCursor,
  fromFrame: number,
  toFrame: number,
): ExecutionWindow {
  if (toFrame < fromFrame)
    throw new Error("Execution window end must not precede its start.");
  const attacks: number[] = [];
  while (cursor.nextStartIndex < bundle.index.eventStartFrames.length) {
    const frame = bundle.index.eventStartFrames[cursor.nextStartIndex]!;
    if (frame >= toFrame) break;
    if (frame >= fromFrame) attacks.push(cursor.nextStartIndex);
    cursor.nextStartIndex += 1;
  }
  const releases: number[] = [];
  while (cursor.nextReleaseIndex < bundle.index.releaseOrder.length) {
    const eventIndex = bundle.index.releaseOrder[cursor.nextReleaseIndex]!;
    const frame = bundle.index.noteOffFrames[eventIndex]!;
    if (frame >= toFrame) break;
    if (frame >= fromFrame) releases.push(eventIndex);
    cursor.nextReleaseIndex += 1;
  }
  return { fromFrame, toFrame, attacks, releases };
}

function nearestCheckpoint(bundle: ExecutionBundle, targetFrame: number) {
  let selected = bundle.index.checkpoints[0]!;
  for (const checkpoint of bundle.index.checkpoints) {
    if (checkpoint.frame > targetFrame) break;
    selected = checkpoint;
  }
  return selected;
}

export function activeEventIndexesAt(
  bundle: ExecutionBundle,
  targetFrame: number,
): number[] {
  const checkpoint = nearestCheckpoint(bundle, targetFrame);
  const active = new Set(
    checkpoint.activeEventIndexes.filter(
      (eventIndex) => bundle.index.renderEndFrames[eventIndex]! > targetFrame,
    ),
  );
  let eventIndex = lowerBound(bundle.index.eventStartFrames, checkpoint.frame);
  while (
    eventIndex < bundle.index.eventStartFrames.length &&
    bundle.index.eventStartFrames[eventIndex]! < targetFrame
  ) {
    if (bundle.index.renderEndFrames[eventIndex]! > targetFrame)
      active.add(eventIndex);
    eventIndex += 1;
  }
  return [...active].sort((left, right) => left - right);
}

export function reconstructExecutionEventAt(
  bundle: ExecutionBundle,
  eventIndex: number,
  targetFrame: number,
): { event: PerformanceEvent; state: ActiveVoiceSnapshot } | undefined {
  const startFrame = bundle.index.eventStartFrames[eventIndex];
  const noteOffFrame = bundle.index.noteOffFrames[eventIndex];
  const renderEndFrame = bundle.index.renderEndFrames[eventIndex];
  if (
    startFrame === undefined ||
    noteOffFrame === undefined ||
    renderEndFrame === undefined ||
    targetFrame < startFrame ||
    targetFrame >= renderEndFrame
  )
    return undefined;
  const event = performanceEventAt(bundle, eventIndex);
  const elapsedFrames = targetFrame - startFrame;
  const playbackRate = event.sample?.playbackRate ?? 1;
  const attackSourceOffsetFrames = Math.round(elapsedFrames * playbackRate);
  const release = targetFrame >= noteOffFrame;
  const frequency = 440 * 2 ** ((event.midi - 69) / 12);
  return {
    event,
    state: {
      eventIndex,
      phase: release ? "release" : elapsedFrames === 0 ? "attack" : "sustain",
      elapsedFrames,
      attackSourceOffsetFrames,
      ...(release && event.sample?.releaseSample
        ? {
            releaseSourceOffsetFrames: Math.round(
              (targetFrame - noteOffFrame) *
                event.sample.releaseSample.playbackRate,
            ),
          }
        : {}),
      ...(!event.sample
        ? {
            oscillatorPhaseCycles:
              ((elapsedFrames / REFERENCE_SAMPLE_RATE) * frequency) % 1,
          }
        : {}),
    },
  };
}

export function createTransportSnapshot(
  bundle: ExecutionBundle,
  status: ExecutionTransportStatus,
  positionFrame: number,
  generation: number,
): TransportSnapshotV0 {
  const frame = Math.max(
    0,
    Math.min(
      Math.round(bundle.plan.renderDurationSeconds * REFERENCE_SAMPLE_RATE),
      Math.round(positionFrame),
    ),
  );
  const section = bundle.index.sections.find(
    (item) => frame >= item.startFrame && frame < item.endFrame,
  );
  const checkpoint = nearestCheckpoint(bundle, frame);
  const activeVoices = activeEventIndexesAt(bundle, frame).flatMap(
    (eventIndex) => {
      const reconstructed = reconstructExecutionEventAt(
        bundle,
        eventIndex,
        frame,
      );
      return reconstructed ? [reconstructed.state] : [];
    },
  );
  return {
    format: TRANSPORT_SNAPSHOT_FORMAT,
    performancePlanSha256: bundle.planSha256,
    sampleRate: REFERENCE_SAMPLE_RATE,
    positionFrame: frame,
    generation,
    status,
    ...(section ? { sectionId: section.id } : {}),
    activeVoices,
    sceneState: { checkpointFrame: checkpoint.frame },
  };
}

export function sectionFrame(
  bundle: ExecutionBundle,
  sectionId: string,
): number {
  const section = bundle.index.sections.find((item) => item.id === sectionId);
  if (!section) throw new Error(`Unknown section ${sectionId}.`);
  return section.startFrame;
}

export class ExecutionTransportController {
  private status: ExecutionTransportStatus = "idle";
  private positionFrame = 0;
  private generation = 0;

  constructor(readonly bundle: ExecutionBundle) {}

  snapshot(): TransportSnapshotV0 {
    return createTransportSnapshot(
      this.bundle,
      this.status,
      this.positionFrame,
      this.generation,
    );
  }

  command(
    command:
      | { type: "prepare"; targetFrame?: number }
      | { type: "play" | "pause" | "resume" | "stop" | "restart" }
      | { type: "seek"; targetFrame: number }
      | { type: "jump"; sectionId: string }
      | { type: "buffer"; targetFrame: number }
      | { type: "fail" }
      | { type: "advance"; positionFrame: number },
  ): TransportSnapshotV0 {
    if (command.type === "prepare") {
      this.positionFrame = command.targetFrame ?? this.positionFrame;
      this.status = "preparing";
    } else if (command.type === "play" || command.type === "resume") {
      this.status = "playing";
      this.generation += 1;
    } else if (command.type === "pause") {
      this.status = "paused";
      this.generation += 1;
    } else if (command.type === "stop") {
      this.positionFrame = 0;
      this.status = "ready";
      this.generation += 1;
    } else if (command.type === "restart") {
      this.positionFrame = 0;
      this.status = "playing";
      this.generation += 1;
    } else if (command.type === "seek") {
      this.positionFrame = command.targetFrame;
      this.generation += 1;
    } else if (command.type === "jump") {
      this.positionFrame = sectionFrame(this.bundle, command.sectionId);
      this.generation += 1;
    } else if (command.type === "buffer") {
      this.positionFrame = command.targetFrame;
      this.status = "buffering";
      this.generation += 1;
    } else if (command.type === "fail") {
      this.status = "error";
      this.generation += 1;
    } else if (command.type === "advance") {
      this.positionFrame = command.positionFrame;
      const endFrame = Math.round(
        this.bundle.plan.renderDurationSeconds * REFERENCE_SAMPLE_RATE,
      );
      if (this.positionFrame >= endFrame) {
        this.positionFrame = endFrame;
        this.status = "ended";
      }
    } else throw new Error("Unsupported transport command.");
    return this.snapshot();
  }
}
