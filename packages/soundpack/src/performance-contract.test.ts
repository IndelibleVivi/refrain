import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERFORMANCE_BINDING,
  DEFAULT_RENDER_SCENE,
  ENGINEERING_AUDITION_PALETTE,
  G3A_AUDITION_SOUND_PROFILE,
  createPerformanceBinding,
  performanceBindingShapeIsValid,
  soundObjectContentSha256,
  validatePerformanceBinding,
} from "./index.js";

describe("exact performance contracts", () => {
  it("publishes self-verifying scene, palette, profile, candidate, and renderer identity", () => {
    expect(DEFAULT_RENDER_SCENE).toMatchObject({
      format: "refrain-render-scene@0-experimental",
      masterGainDb: -9,
      peakCeiling: 0.72,
      velocityScale: 1,
    });
    expect(DEFAULT_RENDER_SCENE.contentSha256).toBe(
      soundObjectContentSha256(DEFAULT_RENDER_SCENE),
    );
    expect(ENGINEERING_AUDITION_PALETTE).toMatchObject({
      format: "refrain-sound-palette@0-experimental",
      soundProfile: {
        id: G3A_AUDITION_SOUND_PROFILE.id,
      },
      renderScene: { id: DEFAULT_RENDER_SCENE.id },
    });
    expect(DEFAULT_PERFORMANCE_BINDING).toMatchObject({
      format: "refrain-performance-binding@0-experimental",
      renderer: {
        contract: "refrain-renderer@0-experimental",
        performancePlanFormat: "performance-plan@2-experimental",
      },
    });
    expect(validatePerformanceBinding(DEFAULT_PERFORMANCE_BINDING)).toEqual([]);
    expect(performanceBindingShapeIsValid(DEFAULT_PERFORMANCE_BINDING)).toBe(
      true,
    );
    expect(DEFAULT_PERFORMANCE_BINDING.contentSha256).toBe(
      soundObjectContentSha256(DEFAULT_PERFORMANCE_BINDING),
    );
    expect(
      Object.keys(DEFAULT_PERFORMANCE_BINDING.candidateDigests).length,
    ).toBeGreaterThan(0);
  });

  it("makes an applied override a new exact binding and rejects undeclared or tampered choices", () => {
    const quieter = createPerformanceBinding({
      id: "quiet-audition@0",
      soundProfile: G3A_AUDITION_SOUND_PROFILE,
      renderScene: DEFAULT_RENDER_SCENE,
      permittedOverrides: ["masterGainDb"],
      overrides: { masterGainDb: -12 },
    });
    expect(quieter.contentSha256).not.toBe(
      DEFAULT_PERFORMANCE_BINDING.contentSha256,
    );
    expect(validatePerformanceBinding(quieter)).toEqual([]);

    expect(
      validatePerformanceBinding({
        ...quieter,
        overrides: { peakCeiling: 0.4 },
      }),
    ).toContain("PerformanceBinding overrides peakCeiling without permission.");
    expect(
      validatePerformanceBinding({
        ...quieter,
        candidateDigests: {
          ...quieter.candidateDigests,
          "warm-piano-generaluser": "0".repeat(64),
        },
      }),
    ).toContain(
      "PerformanceBinding candidate digest does not match warm-piano-generaluser.",
    );
  });
});
