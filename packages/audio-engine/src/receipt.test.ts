import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compileAir } from "@refrain/compiler";
import { G3B_VCSL_LISTENING_PERFORMANCE_BINDING } from "@refrain/soundpack";
import { COMPLETE_PIECE_PERFORMANCE_BINDING } from "@refrain/soundpack";
import { createExecutionBundle } from "./execution.js";
import { createPerformancePlan } from "./performance.js";
import {
  createAssetClosure,
  createExecutionAssetClosure,
  createExecutionRenderReceipt,
  createRenderReceipt,
  renderReceiptShapeIsValid,
} from "./receipt.js";

const sourceRevision = `sha256:${"a".repeat(64)}`;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalValue(record[key])]),
  );
}

function reidentifyReceipt(core: Record<string, unknown>) {
  const { renderReceiptId: _renderReceiptId, ...identity } = core;
  return {
    ...identity,
    renderReceiptId: `sha256:${createHash("sha256")
      .update(JSON.stringify(canonicalValue(identity)))
      .digest("hex")}`,
  };
}

function pianoPlan() {
  const compiled = compileAir({
    format: "air@0-experimental",
    title: "Receipt fixture",
    tempo: 80,
    meter: "4/4",
    motifs: {},
    voices: [
      {
        id: "keys",
        instrument: "warm_piano",
        role: "lead",
        part: "C4/1",
      },
    ],
  }).compiled!;
  return createPerformancePlan(compiled, {
    performanceBinding: G3B_VCSL_LISTENING_PERFORMANCE_BINDING,
  });
}

function verifiedAssets(plan: ReturnType<typeof pianoPlan>) {
  return plan.requiredAssets.map(({ assetId, bytes, sha256 }) => ({
    assetId,
    bytes,
    sha256,
  }));
}

describe("render evidence", () => {
  it("binds exact profile, plan, candidate, and asset closure deterministically", () => {
    const firstPlan = pianoPlan();
    const first = createRenderReceipt(firstPlan, {
      sourceRevision,
      adapter: "headless-pcm",
      sampleRate: 44_100,
      verifiedAssets: verifiedAssets(firstPlan),
    });
    const secondPlan = pianoPlan();
    const second = createRenderReceipt(secondPlan, {
      sourceRevision,
      adapter: "headless-pcm",
      sampleRate: 44_100,
      verifiedAssets: verifiedAssets(secondPlan),
    });
    expect(first).toEqual(second);
    expect(first.renderReceiptId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first).toMatchObject({
      format: "refrain-render-receipt@2-experimental",
      rendererContract: "refrain-renderer@0-experimental",
      performanceBindingDigest: `sha256:${G3B_VCSL_LISTENING_PERFORMANCE_BINDING.contentSha256}`,
      renderSceneDigest: `sha256:${G3B_VCSL_LISTENING_PERFORMANCE_BINDING.renderScene.contentSha256}`,
    });
    expect(first.selectedCandidates).toEqual([
      expect.objectContaining({
        instrumentId: "warm_piano",
        candidateId: "warm-piano-vcsl-kawai-c4",
        fallbackUsed: false,
      }),
    ]);
    expect(first.selectedCandidates[0]?.candidateDigest).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    expect(first.verifiedAssets).toEqual(first.requiredAssets);
    expect(renderReceiptShapeIsValid(first)).toBe(true);
    expect(
      renderReceiptShapeIsValid({ ...first, rendererContract: "tampered" }),
    ).toBe(false);
    expect(first.requiredAssets.map((asset) => asset.assetId)).toEqual([
      "vcsl-kawai-piano-c4-rr1",
    ]);
  });

  it("exports only selected regions and their provenance-bearing assets", () => {
    const closure = createAssetClosure(pianoPlan());
    expect(closure.candidates).toHaveLength(1);
    expect(closure.assets).toHaveLength(1);
    expect(closure.candidates[0]?.mapping).toMatchObject({
      type: "sample-map",
      regions: [{ id: "warm-piano-vcsl-kawai-c4-main" }],
    });
    expect(closure.assets[0]).toMatchObject({
      id: "vcsl-kawai-piano-c4-rr1",
      license: { expression: "CC0-1.0" },
    });
  });

  it("records MIDI's deliberate timbre approximation", () => {
    const receipt = createRenderReceipt(pianoPlan(), {
      sourceRevision,
      adapter: "midi",
    });
    expect(receipt.adaptationNotes?.join(" ")).toContain("sample regions");
  });

  it("binds a compact @3 plan and its exact asset closure", () => {
    const compiled = pianoPlan().compiled;
    const bundle = createExecutionBundle(compiled, {
      sourceRevision,
      performanceBinding: COMPLETE_PIECE_PERFORMANCE_BINDING,
    });
    const verified = bundle.plan.assetRequirements.map(
      ({ assetId, bytes, sha256 }) => ({ assetId, bytes, sha256 }),
    );
    const receipt = createExecutionRenderReceipt(bundle, {
      sourceRevision,
      adapter: "wav",
      sampleRate: 44_100,
      outputSha256: `sha256:${"d".repeat(64)}`,
      outputAmplitude: { mode: "native-gain" },
      verifiedAssets: verified,
    });
    expect(receipt.rendererContract).toBe("refrain-renderer@1-experimental");
    expect(receipt.performancePlanDigest).toBe(bundle.planSha256);
    expect(renderReceiptShapeIsValid(receipt)).toBe(true);
    expect(createExecutionAssetClosure(bundle).assets).toHaveLength(1);
  });

  it("rejects audible receipts that are not bound to verified bytes", () => {
    const plan = pianoPlan();
    expect(() =>
      createRenderReceipt(plan, {
        sourceRevision,
        adapter: "headless-pcm",
      }),
    ).toThrow(/assets actually verified/);
    expect(() =>
      createRenderReceipt(plan, {
        sourceRevision,
        adapter: "headless-pcm",
        verifiedAssets: verifiedAssets(plan).map((asset) => ({
          ...asset,
          sha256: "0".repeat(64),
        })),
      }),
    ).toThrow(/do not match/);
  });

  it("rejects re-identified imported receipts that violate adapter and byte semantics", () => {
    const plan = pianoPlan();
    const wav = createRenderReceipt(plan, {
      sourceRevision,
      adapter: "wav",
      sampleRate: 44_100,
      outputSha256: `sha256:${"b".repeat(64)}`,
      outputAmplitude: { mode: "native-gain" },
      verifiedAssets: verifiedAssets(plan),
    });
    const { outputAmplitude: _outputAmplitude, ...wavWithoutAmplitudeCore } =
      wav;
    expect(
      renderReceiptShapeIsValid(reidentifyReceipt(wavWithoutAmplitudeCore)),
    ).toBe(false);

    const { verifiedAssets: _verifiedAssets, ...wavWithoutBytesCore } = wav;
    expect(
      renderReceiptShapeIsValid(reidentifyReceipt(wavWithoutBytesCore)),
    ).toBe(false);

    const midi = createRenderReceipt(plan, {
      sourceRevision,
      adapter: "midi",
      outputSha256: `sha256:${"c".repeat(64)}`,
    });
    expect(
      renderReceiptShapeIsValid(
        reidentifyReceipt({
          ...midi,
          outputAmplitude: { mode: "native-gain" },
        }),
      ),
    ).toBe(false);
  });
});
