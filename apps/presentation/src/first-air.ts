import {
  artifactBytesOf,
  checkPublishedAssets,
  type AnyAirArtifact,
  type AssetStamp,
  type ShareRecipientCapabilities,
} from "@refrain/renderer";
import { portableArtifactForView } from "@refrain/renderer/artifact-document";
import { createExecutionBundle } from "@refrain/audio-engine/execution";
import velvetText from "../../../examples/demo/velvet-mischief.refrain.json?raw";
import doorText from "../../../examples/demo/after-the-door.refrain.json?raw";
import { verifyArtifactForPresentation } from "./presentation-envelope.js";

export const demoWorks = [
  {
    id: "velvet-mischief",
    title: "Velvet Mischief · 夜色偏心",
    text: velvetText,
  },
  { id: "after-the-door", title: "After the Door · 门后", text: doorText },
];

const verifiedWorks = new Map(
  demoWorks.map((work) => [
    work.id,
    verifyArtifactForPresentation(JSON.parse(work.text)),
  ]),
);

const exactRequirements = (artifact: AnyAirArtifact): AssetStamp[] => {
  const binding = artifact.performanceBinding;
  if (!binding) return [];
  return createExecutionBundle(artifact.compiled, {
    sourceRevision: artifact.receipt.sourceRevision,
    performanceBinding: binding,
  }).plan.assetRequirements.map(({ assetId, kind, bytes, sha256 }) => ({
    assetId,
    kind,
    bytes,
    sha256,
  }));
};

export const demoPublishedArtifacts = demoWorks.map((work) => {
  const result = verifiedWorks.get(work.id)!;
  if (!result.ok) throw new Error(result.message);
  return {
    catalogId: work.id,
    artifactSha256: artifactBytesOf(portableArtifactForView(result.artifact))
      .artifactSha256,
  };
});

const publishedAssetsById = new Map<string, AssetStamp>();
for (const result of verifiedWorks.values()) {
  if (!result.ok) throw new Error(result.message);
  for (const asset of exactRequirements(result.artifact)) {
    const present = publishedAssetsById.get(asset.assetId);
    if (
      present &&
      (present.kind !== asset.kind ||
        present.bytes !== asset.bytes ||
        present.sha256 !== asset.sha256)
    )
      throw new Error(`Conflicting demo asset identity for ${asset.assetId}.`);
    publishedAssetsById.set(asset.assetId, asset);
  }
}

export const demoPublishedAssets = [...publishedAssetsById.values()];
export const demoShareRecipient = {
  supportedPlanFormats: [
    "performance-plan@3-experimental",
    "performance-plan@4-experimental",
  ],
  assetRouting: "verified-manifest",
  publishedAssets: demoPublishedAssets,
} satisfies ShareRecipientCapabilities;

export function firstAir(id = demoWorks[0]!.id) {
  return verifiedWorks.get(id)!;
}

export function publishedDemoAir(
  catalogId: string,
  artifactSha256: string,
  bindingId?: string,
) {
  const work = demoWorks.find((candidate) => candidate.id === catalogId);
  const published = demoPublishedArtifacts.find(
    (candidate) => candidate.catalogId === catalogId,
  );
  if (!work || !published || published.artifactSha256 !== artifactSha256)
    return {
      ok: false as const,
      message: "The published demo identity does not match this link.",
    };
  return verifyArtifactForPresentation(JSON.parse(work.text), bindingId);
}

export function hasDemoSound(artifact: AnyAirArtifact) {
  if (!artifact.performanceBinding) return false;
  try {
    return (
      checkPublishedAssets(exactRequirements(artifact), demoPublishedAssets) ===
      "ok"
    );
  } catch {
    return false;
  }
}
