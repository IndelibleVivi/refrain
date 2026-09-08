import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAir } from "@refrain/air-schema";
import { compileAir } from "@refrain/compiler";
import {
  COMPLETE_PIECE_PERFORMANCE_BINDING,
  DEFAULT_PERFORMANCE_BINDING,
} from "@refrain/soundpack";
import {
  createAuditionExecutionBundle,
  createExecutionBundle,
  createPreparationPlan,
  performanceEventAt,
} from "./execution.js";

const SOURCE_REVISION = `sha256:${"a".repeat(64)}`;

function compileFixture(path: string) {
  const parsed = parseAir(readFileSync(path, "utf8"));
  if (!parsed.source) throw new Error(parsed.diagnostics[0]?.message);
  const result = compileAir(parsed.source);
  if (!result.compiled) throw new Error(result.diagnostics[0]?.message);
  return result.compiled;
}

describe("sealed complete-piece execution", () => {
  it("produces a compact deterministic plan and a bounded typed index", () => {
    const compiled = compileFixture(
      "fixtures/complete-piece/upper-envelope.air.json",
    );
    const first = createExecutionBundle(compiled, {
      sourceRevision: SOURCE_REVISION,
      performanceBinding: COMPLETE_PIECE_PERFORMANCE_BINDING,
    });
    const second = createExecutionBundle(compiled, {
      sourceRevision: SOURCE_REVISION,
      performanceBinding: COMPLETE_PIECE_PERFORMANCE_BINDING,
    });
    expect(first.plan.format).toBe("performance-plan@3-experimental");
    expect(first.planSha256).toBe(second.planSha256);
    expect(first.plan).not.toHaveProperty("compiled");
    expect(first.plan).not.toHaveProperty("events");
    expect(first.plan).not.toHaveProperty("soundProfile");
    expect(first.plan.assetRequirements[0]).not.toHaveProperty("localPath");
    expect(first.plan.eventResolutions).toHaveLength(21_840);
    expect(first.index.eventStartFrames.byteLength).toBe(21_840 * 4);
    expect(first.index.checkpoints.length).toBeLessThanOrEqual(250);
    expect(performanceEventAt(first, 0).id).toBe(compiled.events[0]!.id);
  });

  it("keeps preparation policy outside deterministic plan identity", () => {
    const compiled = compileFixture(
      "fixtures/complete-piece/relational-complete.air.json",
    );
    const bundle = createExecutionBundle(compiled, {
      sourceRevision: SOURCE_REVISION,
    });
    const ordinary = createPreparationPlan(bundle);
    const narrow = createPreparationPlan(bundle, {
      ...ordinary.policy,
      openingWindowSeconds: 2,
    });
    expect(ordinary.performancePlanSha256).toBe(bundle.planSha256);
    expect(narrow.performancePlanSha256).toBe(bundle.planSha256);
    expect(ordinary.policy.openingWindowSeconds).toBe(12);
    expect(bundle.planSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("rejects a historical @2 binding at the complete-piece boundary", () => {
    const compiled = compileFixture(
      "fixtures/complete-piece/relational-complete.air.json",
    );
    expect(() =>
      createExecutionBundle(compiled, {
        sourceRevision: SOURCE_REVISION,
        performanceBinding: DEFAULT_PERFORMANCE_BINDING,
      }),
    ).toThrow(/requires performance-plan@3-experimental/);
  });

  it("preserves an explicit audition candidate inside the @3 binding", () => {
    const bundle = createAuditionExecutionBundle("marimba", 60, {
      candidateId: "marimba-vcsl-c4",
    });
    expect(bundle.plan.performanceBinding.renderer.performancePlanFormat).toBe(
      "performance-plan@3-experimental",
    );
    expect(bundle.plan.voices[0]?.candidateId).toBe("marimba-vcsl-c4");
    expect(bundle.plan.assetRequirements.map((asset) => asset.assetId)).toEqual(
      ["vcsl-marimba-c4-med-01"],
    );
  });
});
