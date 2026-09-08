import type { PerformanceBindingRuntimeStatus } from "@refrain/soundpack";
import type { RendererAssetConfig } from "./types.js";

export type RendererPlaybackCapability =
  | { status: "available" }
  | {
      status: "unavailable";
      reason:
        | "performance-binding-unavailable"
        | "performance-binding-missing"
        | "execution-bundle-invalid"
        | "soundfont-origin-missing"
        | "sample-origin-missing";
      message: string;
    };

export function rendererPlaybackCapability(input: {
  hasBinding: boolean;
  performanceStatus?: PerformanceBindingRuntimeStatus;
  completePiece: boolean;
  assetRequirements?: ReadonlyArray<{ kind: "wav" | "soundfont" }>;
  executionError?: string;
  assets: RendererAssetConfig;
}): RendererPlaybackCapability {
  if (!input.hasBinding)
    return {
      status: "unavailable",
      reason: "performance-binding-missing",
      message:
        "No exact performance binding is attached. Structure, selection, source export, and portable artifact export remain available.",
    };
  if (input.performanceStatus?.status === "unavailable")
    return {
      status: "unavailable",
      reason: "performance-binding-unavailable",
      message: input.performanceStatus.message,
    };
  if (input.executionError)
    return {
      status: "unavailable",
      reason: "execution-bundle-invalid",
      message: input.executionError,
    };
  if (!input.completePiece && !input.assets.soundBankUrl)
    return {
      status: "unavailable",
      reason: "soundfont-origin-missing",
      message:
        input.assets.unavailableReason ??
        "This performance needs a browser-reachable SoundFont origin.",
    };
  const requirements = input.assetRequirements ?? [];
  if (
    requirements.some((requirement) => requirement.kind === "soundfont") &&
    (!input.assets.soundBankUrl || !input.assets.workletUrl)
  )
    return {
      status: "unavailable",
      reason: "soundfont-origin-missing",
      message:
        "This exact performance requires a browser-reachable SoundFont and AudioWorklet origin.",
    };
  if (
    requirements.some((requirement) => requirement.kind === "wav") &&
    input.assets.assetBaseUrl === undefined
  )
    return {
      status: "unavailable",
      reason: "sample-origin-missing",
      message:
        "This exact performance requires browser-reachable verified sample assets.",
    };
  return { status: "available" };
}
