import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PERFORMANCE_BINDINGS,
  DEFAULT_PERFORMANCE_BINDING,
  SOUND_REGISTRY,
} from "@refrain/soundpack";
import {
  SYNTHETIC_SPICES_PROFILE,
  SYNTHETIC_SPICES_SCENE,
} from "@refrain/soundpack/proof-packs";
import { createPerformanceBindingV1 } from "@refrain/soundpack/vnext";
import { selectPerformanceBinding } from "./select-performance-binding.js";

describe("presentation PerformanceBinding selection", () => {
  it("preserves an imported historical default despite an unrelated current ID collision", () => {
    const historical = {
      ...DEFAULT_PERFORMANCE_BINDING,
      contentSha256: "f".repeat(64),
    };
    const selected = selectPerformanceBinding({
      builtIns: BUILT_IN_PERFORMANCE_BINDINGS,
      imported: [historical],
      runtimeDefault: DEFAULT_PERFORMANCE_BINDING,
      importedDefaultId: historical.id,
    });
    expect(selected).toMatchObject({
      binding: { contentSha256: historical.contentSha256 },
      explicit: false,
      historicalDefault: true,
    });
  });

  it("rejects an ambiguous explicit ID instead of silently choosing content", () => {
    const historical = {
      ...DEFAULT_PERFORMANCE_BINDING,
      contentSha256: "f".repeat(64),
    };
    expect(() =>
      selectPerformanceBinding({
        builtIns: BUILT_IN_PERFORMANCE_BINDINGS,
        imported: [historical],
        runtimeDefault: DEFAULT_PERFORMANCE_BINDING,
        requestedId: historical.id,
      }),
    ).toThrow(/multiple content identities/);
  });

  it("preserves an imported PerformanceBinding@1 without coercing it to a built-in", () => {
    const binding = createPerformanceBindingV1({
      id: "presentation-vnext-selection@1",
      requiredInstrumentIds: ["air_pad"],
      soundProfile: SYNTHETIC_SPICES_PROFILE,
      renderScene: SYNTHETIC_SPICES_SCENE,
      manifest: SOUND_REGISTRY,
    });
    const selected = selectPerformanceBinding({
      builtIns: BUILT_IN_PERFORMANCE_BINDINGS,
      imported: [binding],
      runtimeDefault: DEFAULT_PERFORMANCE_BINDING,
      importedDefaultId: binding.id,
    });

    expect(selected.binding).toEqual(binding);
    expect(selected.historicalDefault).toBe(true);
  });
});
