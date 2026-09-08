import { describe, expect, it } from "vitest";
import { compileAir } from "@refrain/compiler";
import { createExecutionBundle } from "./execution.js";
import {
  REFERENCE_BLOCK_FRAMES,
  renderExecutionBlocks,
} from "./block-renderer.js";

function synthBundle() {
  const compiled = compileAir({
    format: "air@0-experimental",
    title: "Block synth",
    tempo: 120,
    meter: "4/4",
    motifs: {},
    voices: [
      {
        id: "pad",
        instrument: "air_pad",
        role: "texture",
        part: "C4/1",
      },
    ],
  }).compiled!;
  return createExecutionBundle(compiled);
}

describe("bounded reference block renderer", () => {
  it("yields fixed-size blocks without a whole-piece PCM allocation", async () => {
    const bundle = synthBundle();
    let blockCount = 0;
    let nonSilent = false;
    for await (const block of renderExecutionBlocks(bundle, {}, 8_000)) {
      blockCount += 1;
      expect(block.left.length).toBeLessThanOrEqual(REFERENCE_BLOCK_FRAMES);
      expect(block.right.length).toBe(block.left.length);
      nonSilent ||= block.left.some((sample) => sample !== 0);
    }
    expect(blockCount).toBeGreaterThan(1);
    expect(nonSilent).toBe(true);
  });

  it("cancels at a block boundary", async () => {
    const bundle = synthBundle();
    let blocks = 0;
    for await (const _block of renderExecutionBlocks(bundle, {}, 8_000, {
      isCancelled: () => blocks >= 1,
    })) {
      blocks += 1;
    }
    expect(blocks).toBe(1);
  });
});
