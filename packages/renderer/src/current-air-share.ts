import { createExecutionBundle } from "@refrain/audio-engine/execution";
import {
  carriedBindings,
  portableArtifactForView,
} from "./artifact-document.js";
import {
  createInlinePresentationRef,
  type InlinePresentationResult,
} from "./presentation-ref.js";
import {
  blockedShare,
  planInlineShare,
  type AssetStamp,
  type SharePlan,
  type ShareRecipientCapabilities,
} from "./share-policy.js";
import type { PortableShareAppearance } from "./appearance.js";
import type { SelenV21ThemeId } from "./selen-v21-model.js";
import type { AnyAirArtifact } from "./types.js";

export interface ShareDeployment {
  readonly playerBaseUrl: string | undefined;
  readonly recipient: ShareRecipientCapabilities;
  readonly publishedArtifacts?: readonly {
    readonly catalogId: string;
    readonly artifactSha256: string;
  }[];
  readonly maxUrlChars?: number;
}

export type PreparedCurrentAirShare =
  | SharePlan
  | {
      readonly kind: "prepared";
      readonly bindingId: string;
      readonly deployment: ShareDeployment;
      readonly performancePlanFormat: string;
      readonly presentation: InlinePresentationResult;
      readonly publishedArtifact?: {
        readonly catalogId: string;
        readonly artifactSha256: string;
      };
      readonly requiredAssets: readonly AssetStamp[];
    };

export function prepareCurrentAirShareContext(input: {
  view: AnyAirArtifact;
  deployment: ShareDeployment | undefined;
}): PreparedCurrentAirShare {
  if (!input.deployment) return blockedShare("public-player-not-configured");
  const binding = input.view.performanceBinding;
  if (!binding) return blockedShare("binding-required");
  const document = portableArtifactForView(input.view);
  const carried = carriedBindings(document).find(
    (candidate) =>
      candidate.id === binding.id &&
      candidate.contentSha256 === binding.contentSha256,
  );
  if (!carried) return blockedShare("binding-not-carried");
  try {
    const presentation = createInlinePresentationRef(document);
    const artifactSha256 = presentation.ok
      ? presentation.ref.artifactSha256
      : presentation.artifactSha256;
    const publishedArtifact = input.deployment.publishedArtifacts?.find(
      (candidate) => candidate.artifactSha256 === artifactSha256,
    );
    const execution = createExecutionBundle(input.view.compiled, {
      sourceRevision: input.view.receipt.sourceRevision,
      performanceBinding: binding,
    });
    return {
      kind: "prepared",
      bindingId: binding.id,
      deployment: input.deployment,
      presentation,
      ...(publishedArtifact ? { publishedArtifact } : {}),
      performancePlanFormat: binding.renderer.performancePlanFormat,
      requiredAssets: execution.plan.assetRequirements,
    };
  } catch {
    return blockedShare("execution-unavailable");
  }
}

export function planPreparedCurrentAirShare(input: {
  prepared: PreparedCurrentAirShare;
  theme: SelenV21ThemeId;
  appearance?: PortableShareAppearance;
}): SharePlan {
  if (input.prepared.kind !== "prepared") return input.prepared;
  const prepared = input.prepared;
  return planInlineShare({
    presentation: prepared.presentation,
    playerBaseUrl: prepared.deployment.playerBaseUrl,
    bindingId: prepared.bindingId,
    theme: input.theme,
    ...(input.appearance ? { appearance: input.appearance } : {}),
    ...(prepared.publishedArtifact
      ? { publishedArtifact: prepared.publishedArtifact }
      : {}),
    performancePlanFormat: prepared.performancePlanFormat,
    recipient: prepared.deployment.recipient,
    requiredAssets: prepared.requiredAssets,
    ...(prepared.deployment.maxUrlChars === undefined
      ? {}
      : { maxUrlChars: prepared.deployment.maxUrlChars }),
  });
}

export function prepareCurrentAirShare(input: {
  view: AnyAirArtifact;
  theme: SelenV21ThemeId;
  appearance?: PortableShareAppearance;
  deployment: ShareDeployment | undefined;
}): SharePlan {
  return planPreparedCurrentAirShare({
    prepared: prepareCurrentAirShareContext({
      view: input.view,
      deployment: input.deployment,
    }),
    theme: input.theme,
    ...(input.appearance ? { appearance: input.appearance } : {}),
  });
}
