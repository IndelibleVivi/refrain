import { describe, expect, it, vi } from "vitest";
import { CompletePieceBrowserEngine } from "./complete-browser.js";
import { REFERENCE_SAMPLE_RATE, type ExecutionBundle } from "./execution.js";
import { OperationAuthority } from "./operation-authority.js";
import type {
  ExecutionTransportStatus,
  TransportSnapshotV0,
} from "./execution-transport.js";

type EngineInternals = Record<string, any>;

function snapshot(
  status: ExecutionTransportStatus,
  positionFrame: number,
): TransportSnapshotV0 {
  return {
    format: "refrain-transport-snapshot@0-experimental",
    performancePlanSha256: "plan",
    sampleRate: REFERENCE_SAMPLE_RATE,
    positionFrame,
    generation: 0,
    status,
    activeVoices: [],
    sceneState: { checkpointFrame: 0 },
  };
}

function harness(
  status: ExecutionTransportStatus = "ready",
  positionFrame = 0,
): {
  engine: CompletePieceBrowserEngine;
  internals: EngineInternals;
  order: string[];
} {
  const order: string[] = [];
  const engine = Object.create(
    CompletePieceBrowserEngine.prototype,
  ) as CompletePieceBrowserEngine;
  const internals = engine as unknown as EngineInternals;
  let current = snapshot(status, positionFrame);
  internals.destroyed = false;
  internals.operations = new OperationAuthority();
  internals.context = { currentTime: 0 };
  internals.originAudioTime = 0;
  internals.originFrame = positionFrame;
  internals.adapter = "direct-nodes@1";
  internals.bundle = {
    planSha256: "plan",
    plan: { renderDurationSeconds: 120, assetRequirements: [] },
  } as unknown as ExecutionBundle;
  internals.preparation = {
    openingClosure: [],
    assets: [],
    policy: { prefetchLeadSeconds: 12 },
  };
  internals.transportController = {
    snapshot: () => current,
    command: (command: {
      type: string;
      targetFrame?: number;
      positionFrame?: number;
    }) => {
      const frame =
        command.targetFrame ?? command.positionFrame ?? current.positionFrame;
      const nextStatus =
        command.type === "prepare"
          ? "preparing"
          : command.type === "pause"
            ? "paused"
            : command.type === "stop" || command.type === "restart"
              ? "ready"
              : command.type === "buffer"
                ? "buffering"
                : current.status;
      current = snapshot(nextStatus, command.type === "restart" ? 0 : frame);
      return current;
    },
  };
  internals.assetStore = {
    prepareMany: vi.fn(async () => {
      order.push("prepare");
      return [];
    }),
  };
  internals.ensureAdapterReady = vi.fn(async () => {
    order.push("adapter");
  });
  internals.startPrefetch = vi.fn(() => order.push("prefetch"));
  internals.observeFirstGraphSound = vi.fn(async () => undefined);
  internals.startAt = vi.fn((frame: number) => order.push(`start:${frame}`));
  internals.haltPlayback = vi.fn(() => order.push("halt"));
  internals.emit = vi.fn();
  return { engine, internals, order };
}

describe("CompletePieceBrowserEngine start authority", () => {
  it("starts first playback atomically at the requested frame", async () => {
    const { engine, order } = harness();

    await engine.playAt(30);

    expect(order).toEqual([
      "prepare",
      "adapter",
      "prefetch",
      `start:${30 * REFERENCE_SAMPLE_RATE}`,
    ]);
    expect(order).not.toContain("start:0");
  });

  it("counts retained PCM and loop projections without retaining raw WAV bytes", async () => {
    const { internals } = harness();
    const createBuffer = () => {
      const channels = [Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7])];
      return {
        numberOfChannels: 1,
        length: 8,
        sampleRate: 4,
        duration: 2,
        getChannelData: (channel: number) => channels[channel]!,
      } as unknown as AudioBuffer;
    };
    const decoded = createBuffer();
    internals.context = {
      decodeAudioData: vi.fn(async () => decoded),
      createBuffer: vi.fn(() => createBuffer()),
    };
    internals.loopProjectionsByAsset = new Map([
      [
        "sample",
        [
          {
            key: "sample:2:8:2",
            startFrame: 2,
            endFrame: 8,
            crossfadeFrames: 2,
          },
        ],
      ],
    ]);

    const result = await internals.decodeAsset(
      { assetId: "sample", kind: "wav" },
      new Uint8Array([1, 2, 3, 4]).buffer,
      new AbortController().signal,
    );

    expect(result.value).toMatchObject({ kind: "wav", buffer: decoded });
    expect("bytes" in result.value).toBe(false);
    expect(result.value.loopBuffers).toHaveProperty("size", 1);
    expect(result.decodedBytes).toBe(64);
  });

  it("makes adapter readiness precede every path that starts sound", async () => {
    const resume = harness("paused", 12 * REFERENCE_SAMPLE_RATE);
    await resume.engine.resume();
    expect(resume.order).toEqual([
      "prepare",
      "adapter",
      "prefetch",
      `start:${12 * REFERENCE_SAMPLE_RATE}`,
    ]);

    const playingSeek = harness("playing", 4 * REFERENCE_SAMPLE_RATE);
    await playingSeek.engine.seek(20);
    expect(playingSeek.order).toEqual([
      "halt",
      "prepare",
      "adapter",
      "prefetch",
      `start:${20 * REFERENCE_SAMPLE_RATE}`,
    ]);

    const restart = harness("paused", 30 * REFERENCE_SAMPLE_RATE);
    await restart.engine.restart();
    expect(restart.order).toEqual([
      "halt",
      "prepare",
      "adapter",
      "prefetch",
      "start:0",
    ]);

    const recovery = harness("playing", 8 * REFERENCE_SAMPLE_RATE);
    await recovery.internals.bufferAt(9 * REFERENCE_SAMPLE_RATE);
    expect(recovery.order).toEqual([
      "halt",
      "prepare",
      "adapter",
      "prefetch",
      `start:${9 * REFERENCE_SAMPLE_RATE}`,
    ]);
  });

  it("rebases prefetch after resume, paused seek, restart, and buffering", async () => {
    const pausedSeek = harness("paused", 2 * REFERENCE_SAMPLE_RATE);
    await pausedSeek.engine.seek(40);
    expect(pausedSeek.internals.ensureAdapterReady).not.toHaveBeenCalled();
    expect(pausedSeek.internals.startPrefetch).toHaveBeenCalledTimes(1);

    const pauseResume = harness("playing", 6 * REFERENCE_SAMPLE_RATE);
    pauseResume.engine.pause();
    await pauseResume.engine.resume();
    expect(pauseResume.internals.startPrefetch).toHaveBeenCalledTimes(1);
    expect(pauseResume.internals.ensureAdapterReady).toHaveBeenCalledTimes(1);
  });
});
