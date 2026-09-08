import {
  SOUND_REGISTRY,
  resolvePerformanceBindingAgainstRuntime,
  type PerformanceBinding,
  type PerformanceBindingRuntimeStatus,
} from "./index.js";
import {
  resolvePerformanceBindingV1AgainstRuntime,
  type PerformanceBindingV1,
} from "./vnext.js";

export type ExactPerformanceBinding = PerformanceBinding | PerformanceBindingV1;

/** Runtime availability is separate from historical integrity and surface assets. */
export function performanceStatusForSource(
  binding: ExactPerformanceBinding,
  source: { voices: ReadonlyArray<{ instrument: string }> },
): PerformanceBindingRuntimeStatus {
  const status =
    binding.format === "refrain-performance-binding@1-experimental"
      ? resolvePerformanceBindingV1AgainstRuntime(binding, SOUND_REGISTRY)
      : resolvePerformanceBindingAgainstRuntime(binding);
  if (status.status === "unavailable") return status;
  const missing = [...new Set(source.voices.map((v) => v.instrument))]
    .filter((id) => binding.soundProfile.selections[id] === undefined)
    .sort();
  return missing.length === 0
    ? status
    : {
        status: "unavailable",
        reason: "instrument-vocabulary-not-installed",
        message: `PerformanceBinding ${binding.id} does not embody: ${missing.join(", ")}.`,
        errors: missing.map((id) => `No exact sound selection for ${id}.`),
      };
}
