import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileAir } from "@refrain/compiler";
import { createExecutionBundle } from "@refrain/audio-engine";
import { streamExecutionWav } from "@refrain/audio-engine/node-wav";

function bundle() {
  return createExecutionBundle(
    compileAir({
      format: "air@0-experimental",
      title: "Streaming WAV",
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
    }).compiled!,
  );
}

describe("Node complete-piece WAV sink", () => {
  it("is bounded and byte-stable across two passes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "refrain-stream-test-"));
    try {
      const firstPath = join(directory, "first.wav");
      const secondPath = join(directory, "second.wav");
      const first = await streamExecutionWav(bundle(), {}, firstPath, {
        sampleRate: 8_000,
      });
      const second = await streamExecutionWav(bundle(), {}, secondPath, {
        sampleRate: 8_000,
      });
      expect(first.outputSha256).toBe(second.outputSha256);
      expect(first.amplitudeScale).toBeLessThanOrEqual(1);
      expect(first.peakWorkingBytes).toBeLessThan(100_000);
      expect((await readFile(firstPath)).subarray(0, 4).toString()).toBe(
        "RIFF",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
