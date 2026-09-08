import { describe, expect, it } from "vitest";
import { createRenderSceneV1 } from "@refrain/soundpack/vnext";
import { SceneBlockProcessor } from "./scene-renderer.js";

describe("RenderScene@1 DSP", () => {
  it("routes, processes and carries deterministic room/delay state across blocks", () => {
    const scene = createRenderSceneV1({
      id: "scene-dsp-proof@1",
      master: { gainDb: -6, peakCeiling: 0.8, velocityScale: 1 },
      buses: [
        {
          id: "lead",
          output: "master",
          processors: [
            { id: "place", type: "gain-pan", gainDb: -3, pan: 0.4, width: 1.2 },
            { id: "tone", type: "lowpass", frequencyHz: 2_000, q: 0.7 },
            { id: "warm", type: "saturation", drive: 2, mix: 0.25 },
            { id: "echo", type: "delay", delayMs: 4, feedback: 0.3, mix: 0.4 },
            { id: "space", type: "room", decaySeconds: 0.25, mix: 0.2 },
          ],
        },
      ],
      routes: [
        { id: "lead", bus: "lead", match: { roles: ["lead"] } },
        { id: "rest", bus: "master", match: {} },
      ],
    });
    const render = () => {
      const processor = new SceneBlockProcessor(scene, 1_000, 0.008, 0.5);
      const first = processor.createBlock(8);
      const bus = first.get("lead")!;
      bus.left[0] = 1;
      bus.right[0] = 1;
      const a = processor.processBlock(0, first);
      const second = processor.createBlock(8);
      const b = processor.processBlock(8, second);
      return [...a.left, ...b.left, ...a.right, ...b.right];
    };
    const first = render();
    const second = render();
    expect(first).toEqual(second);
    expect(first.slice(8, 16).some((sample) => sample !== 0)).toBe(true);
    expect(Math.max(...first.map(Math.abs))).toBeLessThanOrEqual(0.8);
  });
});
