import {
  renderExecutionBlocks,
  type ExecutionAssetBundle,
} from "./block-renderer.js";
import type { ExecutionBundle } from "./execution.js";

export type BlockWorkerRequest =
  | {
      type: "render";
      requestId: string;
      bundle: ExecutionBundle;
      assets: ExecutionAssetBundle;
      sampleRate: number;
      blockFrames?: number;
    }
  | { type: "cancel"; requestId: string };

export type BlockWorkerResponse =
  | {
      type: "block";
      requestId: string;
      frameOffset: number;
      frameCount: number;
      left: ArrayBuffer;
      right: ArrayBuffer;
    }
  | { type: "done"; requestId: string }
  | { type: "cancelled"; requestId: string }
  | { type: "error"; requestId: string; message: string };

const cancellations = new Set<string>();

export async function handleBlockWorkerRequest(
  request: BlockWorkerRequest,
  post: (response: BlockWorkerResponse, transfer?: Transferable[]) => void,
): Promise<void> {
  if (request.type === "cancel") {
    cancellations.add(request.requestId);
    return;
  }
  cancellations.delete(request.requestId);
  try {
    for await (const block of renderExecutionBlocks(
      request.bundle,
      request.assets,
      request.sampleRate,
      {
        ...(request.blockFrames === undefined
          ? {}
          : { blockFrames: request.blockFrames }),
        isCancelled: () => cancellations.has(request.requestId),
      },
    )) {
      const left = block.left.buffer as ArrayBuffer;
      const right = block.right.buffer as ArrayBuffer;
      post(
        {
          type: "block",
          requestId: request.requestId,
          frameOffset: block.frameOffset,
          frameCount: block.frameCount,
          left,
          right,
        },
        [left, right],
      );
    }
    const cancelled = cancellations.delete(request.requestId);
    post({
      type: cancelled ? "cancelled" : "done",
      requestId: request.requestId,
    });
  } catch (cause) {
    cancellations.delete(request.requestId);
    post({
      type: "error",
      requestId: request.requestId,
      message: cause instanceof Error ? cause.message : "Block render failed.",
    });
  }
}

const workerScope = globalThis as typeof globalThis & {
  importScripts?: (...urls: string[]) => void;
  postMessage?: (
    message: BlockWorkerResponse,
    transfer?: Transferable[],
  ) => void;
  onmessage?: (event: MessageEvent<BlockWorkerRequest>) => void;
};

if (
  typeof workerScope.importScripts === "function" &&
  typeof workerScope.postMessage === "function"
) {
  workerScope.onmessage = (event) => {
    void handleBlockWorkerRequest(event.data, (response, transfer) =>
      workerScope.postMessage!(response, transfer),
    );
  };
}
