import { describe, expect, it } from "vitest";
import type { CompiledAir } from "@refrain/compiler";
import {
  F_LUMINOUS_HYBRID_SOUND_PROFILE,
  INSTRUMENT_VOCABULARY,
  SOUND_REGISTRY,
} from "@refrain/soundpack";
import {
  createAuthoringVocabularyClosure,
  createPerformanceBindingV1,
  createRenderSceneV1,
  createSoundProfileV2,
} from "@refrain/soundpack/vnext";
import { createPerformancePlan } from "./performance.js";
import { createExecutionBundle } from "./execution.js";
import { renderExecutionBlocks } from "./block-renderer.js";

const compiled: CompiledAir = {
  format: "compiled-air@0-experimental",
  sourceFormat: "air@0-experimental",
  title: "Vnext execution",
  tempo: 120,
  meter: "4/4",
  beatsPerBar: 4,
  durationBeats: 4,
  durationSeconds: 2,
  events: [
    {
      id: "pad:1:1",
      voiceId: "pad",
      role: "harmony",
      instrument: "air_pad",
      midi: 60,
      note: "C4",
      startBeat: 0,
      durationBeats: 4,
      soundingDurationBeats: 4,
      velocity: 0.5,
      gainDb: -4,
      pan: -0.2,
      bar: 1,
      articulation: "none",
      gate: 1,
      source: { voiceId: "pad", authoring: "part" },
    },
    {
      id: "lead:1:1",
      voiceId: "lead",
      role: "lead",
      instrument: "prism_lead",
      midi: 72,
      note: "C5",
      startBeat: 0,
      durationBeats: 2,
      soundingDurationBeats: 2,
      velocity: 0.68,
      gainDb: -2,
      pan: 0.25,
      bar: 1,
      articulation: "none",
      gate: 1,
      source: { voiceId: "lead", authoring: "part" },
    },
  ],
  motifFamilies: [],
  motifOccurrences: [],
  segments: [],
  sections: [{ id: "form", startBeat: 0, endBeat: 4 }],
};

describe("PerformanceBinding@1 execution", () => {
  it("resolves a closure-scoped profile into plan@4 and executes scene DSP", async () => {
    const vocabulary = createAuthoringVocabularyClosure({
      id: "refrain-core-instruments@0",
      instruments: INSTRUMENT_VOCABULARY.instruments,
    });
    const profile = createSoundProfileV2({
      id: "vnext-synth-pair@2",
      vocabulary,
      selections: {
        air_pad: F_LUMINOUS_HYBRID_SOUND_PROFILE.selections.air_pad!,
        prism_lead: F_LUMINOUS_HYBRID_SOUND_PROFILE.selections.prism_lead!,
      },
      manifest: SOUND_REGISTRY,
    });
    const scene = createRenderSceneV1({
      id: "vnext-room@1",
      master: { gainDb: -12, peakCeiling: 0.68, velocityScale: 1 },
      buses: [
        {
          id: "music",
          output: "master",
          processors: [
            { id: "tail", type: "room", decaySeconds: 1.5, mix: 0.2 },
          ],
        },
      ],
      routes: [{ id: "all", bus: "music", match: {} }],
    });
    const binding = createPerformanceBindingV1({
      id: "vnext-synth-pair@1",
      requiredInstrumentIds: ["air_pad", "prism_lead"],
      soundProfile: profile,
      renderScene: scene,
      manifest: SOUND_REGISTRY,
    });
    const plan = createPerformancePlan(compiled, {
      performanceBinding: binding,
      instrumentVocabulary: vocabulary,
    });
    expect(plan.format).toBe("performance-plan@4-experimental");
    expect(plan.performanceBinding.contentSha256).toBe(binding.contentSha256);
    expect(plan.requiredAssets).toEqual([]);
    expect(plan.durationSeconds).toBeGreaterThanOrEqual(3.5);

    const render = async () => {
      const bundle = createExecutionBundle(compiled, {
        performanceBinding: binding,
        instrumentVocabulary: vocabulary,
      });
      expect(bundle.plan.format).toBe("performance-plan@4-experimental");
      const tail: number[] = [];
      for await (const block of renderExecutionBlocks(bundle, {}, 8_000)) {
        const musicalEnd = compiled.durationSeconds * 8_000;
        for (let index = 0; index < block.frameCount; index += 1) {
          if (block.frameOffset + index >= musicalEnd)
            tail.push(block.left[index]!, block.right[index]!);
        }
      }
      return tail;
    };
    const first = await render();
    expect(first.some((sample) => sample !== 0)).toBe(true);
    expect(await render()).toEqual(first);
  });
});
