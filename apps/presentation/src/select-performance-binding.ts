import {
  SOUND_REGISTRY,
  resolvePerformanceBindingAgainstRuntime,
  type PerformanceBinding,
} from "@refrain/soundpack";
import {
  resolvePerformanceBindingV1AgainstRuntime,
  type PerformanceBindingV1,
} from "@refrain/soundpack/vnext";

export type SelectablePerformanceBinding =
  PerformanceBinding | PerformanceBindingV1;

export interface SelectPerformanceBindingInput {
  builtIns: readonly SelectablePerformanceBinding[];
  imported: readonly SelectablePerformanceBinding[];
  runtimeDefault: SelectablePerformanceBinding;
  requestedId?: string;
  importedDefaultId?: string;
}

export interface SelectedPerformanceBinding {
  binding: SelectablePerformanceBinding;
  explicit: boolean;
  historicalDefault: boolean;
}

export function selectPerformanceBinding(
  input: SelectPerformanceBindingInput,
): SelectedPerformanceBinding {
  const selectedId =
    input.requestedId ?? input.importedDefaultId ?? input.runtimeDefault.id;
  let candidates: SelectablePerformanceBinding[];
  if (input.requestedId !== undefined) {
    const byDigest = new Map<string, SelectablePerformanceBinding>();
    for (const binding of [...input.imported, ...input.builtIns]) {
      if (binding.id === selectedId)
        byDigest.set(binding.contentSha256, binding);
    }
    candidates = [...byDigest.values()];
  } else if (input.importedDefaultId !== undefined) {
    candidates = input.imported.filter((binding) => binding.id === selectedId);
  } else {
    candidates = input.builtIns.filter((binding) => binding.id === selectedId);
  }
  if (candidates.length > 1) {
    throw new Error(
      `PerformanceBinding ${selectedId} names multiple content identities; an ID alone cannot select one safely.`,
    );
  }
  const binding = candidates[0];
  if (!binding) {
    const available = [
      ...new Set(
        [...input.imported, ...input.builtIns].map((candidate) => candidate.id),
      ),
    ].sort();
    throw new Error(
      `Unknown PerformanceBinding ${selectedId}. Available bindings: ${available.join(", ")}.`,
    );
  }
  return {
    binding,
    explicit: input.requestedId !== undefined,
    historicalDefault:
      input.requestedId === undefined && input.importedDefaultId !== undefined,
  };
}

function runtimeStatus(binding: SelectablePerformanceBinding) {
  return binding.format === "refrain-performance-binding@1-experimental"
    ? resolvePerformanceBindingV1AgainstRuntime(binding, SOUND_REGISTRY)
    : resolvePerformanceBindingAgainstRuntime(binding);
}

export function performanceStatusForSource(
  binding: SelectablePerformanceBinding,
  source: { voices: Array<{ instrument: string }> },
) {
  const status = runtimeStatus(binding);
  if (status.status === "unavailable") return status;
  const missing = [...new Set(source.voices.map((voice) => voice.instrument))]
    .filter(
      (instrument) => binding.soundProfile.selections[instrument] === undefined,
    )
    .sort();
  return missing.length === 0
    ? status
    : {
        status: "unavailable" as const,
        reason: "instrument-vocabulary-not-installed" as const,
        message: `PerformanceBinding ${binding.id} does not embody: ${missing.join(", ")}.`,
        errors: missing.map(
          (instrument) => `No exact sound selection for ${instrument}.`,
        ),
      };
}
