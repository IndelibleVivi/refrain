import { describe, expect, it } from "vitest";
import { parseAir } from "@refrain/air-schema";
import { compileAir } from "@refrain/compiler";
import { createExecutionBundle } from "@refrain/audio-engine/execution";
import { createExecutionRenderReceipt } from "@refrain/audio-engine/receipt";
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
import { receiptIdOf, sourceRevisionOf } from "./identity.js";
import { createRefrainArtifactV2, parseRefrainArtifact } from "./portable.js";
import type { AirReceipt } from "./types.js";

describe("RefrainArtifact@2", () => {
  it("binds strict vnext performance and render evidence without widening artifact@1", () => {
    const source = parseAir({
      format: "air@0-experimental",
      title: "Artifact v2 proof",
      tempo: 120,
      meter: "4/4",
      motifs: {},
      voices: [
        { id: "pad", instrument: "air_pad", role: "harmony", part: "C4/1" },
        { id: "lead", instrument: "prism_lead", role: "lead", part: "C5/1" },
      ],
    }).source!;
    const compiled = compileAir(source).compiled!;
    const sourceRevision = sourceRevisionOf(source);
    const receiptCore = {
      format: "refrain-receipt@0-experimental" as const,
      sourceRevision,
      airId: sourceRevision,
      sourceFormat: source.format,
      verification: {
        contract: "musical-relation@0-experimental" as const,
        status: "not_applicable" as const,
        motifLinks: [],
      },
    };
    const receipt: AirReceipt = {
      ...receiptCore,
      receiptId: receiptIdOf(receiptCore),
    };
    const vocabulary = createAuthoringVocabularyClosure({
      id: "refrain-core-instruments@0",
      instruments: INSTRUMENT_VOCABULARY.instruments,
    });
    const profile = createSoundProfileV2({
      id: "artifact-v2-proof@2",
      vocabulary,
      selections: {
        air_pad: F_LUMINOUS_HYBRID_SOUND_PROFILE.selections.air_pad!,
        prism_lead: F_LUMINOUS_HYBRID_SOUND_PROFILE.selections.prism_lead!,
      },
      manifest: SOUND_REGISTRY,
    });
    const scene = createRenderSceneV1({
      id: "artifact-v2-proof@1",
      master: { gainDb: -12, peakCeiling: 0.68, velocityScale: 1 },
      buses: [
        {
          id: "music",
          output: "master",
          processors: [
            { id: "air", type: "room", decaySeconds: 0.8, mix: 0.15 },
          ],
        },
      ],
      routes: [{ id: "all", bus: "music", match: {} }],
    });
    const binding = createPerformanceBindingV1({
      id: "artifact-v2-proof@1",
      requiredInstrumentIds: ["air_pad", "prism_lead"],
      soundProfile: profile,
      renderScene: scene,
      manifest: SOUND_REGISTRY,
    });
    const bundle = createExecutionBundle(compiled, {
      sourceRevision,
      performanceBinding: binding,
      instrumentVocabulary: vocabulary,
    });
    const renderReceipt = createExecutionRenderReceipt(bundle, {
      sourceRevision,
      adapter: "midi",
    });
    expect(renderReceipt.format).toBe("refrain-render-receipt@3-experimental");
    if (renderReceipt.format !== "refrain-render-receipt@3-experimental")
      throw new Error("Expected a vnext render receipt.");
    const artifact = createRefrainArtifactV2({
      source,
      receipt,
      performanceBinding: binding,
      renderReceipts: [renderReceipt],
    });
    expect(parseRefrainArtifact(artifact)).toMatchObject({ ok: true });
    expect(
      parseRefrainArtifact({
        ...artifact,
        format: "refrain-artifact@1-experimental",
      }),
    ).toMatchObject({ ok: false });
  });
});
