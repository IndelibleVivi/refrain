import {
  normalizePortableAppearance,
  type PortableShareAppearance,
} from "./appearance.js";
import type { InlinePresentationResult } from "./presentation-ref.js";
import type { SelenV21ThemeId } from "./selen-v21-model.js";

/** No serializers, hashes, network clients, or musical defaults live here. */
export type EncodedPresentation = InlinePresentationResult;
export type ShareTheme = SelenV21ThemeId;
export type { PortableShareAppearance } from "./appearance.js";

const THEMES: readonly ShareTheme[] = [
  "paper-sonata",
  "prism",
  "nocturne-ink",
  "herbarium",
];
const SHAREABLE_PLAN_FORMATS = [
  "performance-plan@3-experimental",
  "performance-plan@4-experimental",
] as const;
const APPEARANCE_KEYS = new Set<keyof PortableShareAppearance>([
  "symbolColor",
  "textColor",
  "backgroundOpacity",
  "backgroundBlurPx",
]);
const SHA256 = /^(?:sha256:)?[0-9a-f]{64}$/;
const ARTIFACT_SHA256 = /^sha256:[0-9a-f]{64}$/;
const BASE64_URL = /^[A-Za-z0-9_-]+$/;
const PUBLIC_CATALOG_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_ASSET_RECORDS = 16_384;
const MAX_CAPABILITY_FORMATS = 64;

/** Conservative product policy, separate from the presentation fragment bound. */
export const DEFAULT_SHARE_URL_BUDGET = 8_000;

export interface AssetStamp {
  readonly assetId: string;
  readonly kind: "wav" | "soundfont";
  readonly bytes: number;
  readonly sha256: string;
}

export interface ShareRecipientCapabilities {
  /** Build-owned formats executable by the public recipient. */
  readonly supportedPlanFormats: readonly string[];
  /** A manifest is useful only when the recipient actually routes its assets. */
  readonly assetRouting: "asset-free-only" | "verified-manifest";
  readonly publishedAssets: readonly AssetStamp[];
}

export type ShareFailureReason =
  | "public-player-not-configured"
  | "invalid-public-player"
  | "invalid-inline-reference"
  | "inline-too-large"
  | "invalid-url-budget"
  | "url-budget-exceeded"
  | "binding-required"
  | "binding-not-carried"
  | "invalid-theme"
  | "invalid-appearance"
  | "invalid-published-artifact"
  | "recipient-capability-unavailable"
  | "invalid-recipient-capability"
  | "asset-closure-unavailable"
  | "invalid-asset-manifest"
  | "unpublished-assets"
  | "unsupported-performance-plan"
  | "execution-unavailable";

export type SharePlan =
  | {
      kind: "link";
      url: string;
      artifactSha256: string;
      sound: "exact-live";
    }
  | { kind: "needs-bundle"; reason: ShareFailureReason };

export interface PlanInlineShareInput {
  readonly presentation: EncodedPresentation;
  /** Explicit static HTTPS player, never location.href or a session URL. */
  readonly playerBaseUrl: string | undefined;
  readonly bindingId: string | undefined;
  readonly theme: ShareTheme;
  readonly appearance?: PortableShareAppearance;
  /** Optional exact locator for bytes already built into the public recipient. */
  readonly publishedArtifact?: {
    readonly catalogId: string;
    readonly artifactSha256: string;
  };
  readonly performancePlanFormat: string;
  readonly recipient: ShareRecipientCapabilities | undefined;
  readonly requiredAssets: readonly AssetStamp[] | undefined;
  readonly maxUrlChars?: number;
}

export const blockedShare = (reason: ShareFailureReason): SharePlan => ({
  kind: "needs-bundle",
  reason,
});

/** Syntactic hygiene only; the operator still owns DNS and deployment truth. */
export function publicPlayerBase(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password)
    return undefined;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host.includes(".") ||
    host.includes(":") ||
    /^[0-9.]+$/.test(host) ||
    /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host)
  )
    return undefined;

  // Never inherit a sender's session, token, playback, appearance, or fragment.
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/") && !/\.[a-z0-9]+$/i.test(url.pathname))
    url.pathname += "/";
  return url;
}

function validAssetStamp(value: AssetStamp): boolean {
  return (
    typeof value?.assetId === "string" &&
    value.assetId.length > 0 &&
    value.assetId.length <= 1_024 &&
    (value.kind === "wav" || value.kind === "soundfont") &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    typeof value.sha256 === "string" &&
    SHA256.test(value.sha256)
  );
}

function normalizedSha(value: string): string {
  return value.replace(/^sha256:/, "");
}

export function checkPublishedAssets(
  required: readonly AssetStamp[] | undefined,
  published: readonly AssetStamp[],
):
  | "ok"
  | "asset-closure-unavailable"
  | "invalid-asset-manifest"
  | "unpublished-assets" {
  if (required === undefined) return "asset-closure-unavailable";
  if (
    required.length > MAX_ASSET_RECORDS ||
    published.length > MAX_ASSET_RECORDS ||
    !required.every(validAssetStamp) ||
    !published.every(validAssetStamp)
  )
    return "invalid-asset-manifest";

  const publishedById = new Map<string, AssetStamp>();
  for (const asset of published) {
    if (publishedById.has(asset.assetId)) return "invalid-asset-manifest";
    publishedById.set(asset.assetId, asset);
  }
  if (new Set(required.map((asset) => asset.assetId)).size !== required.length)
    return "invalid-asset-manifest";

  for (const expected of required) {
    const available = publishedById.get(expected.assetId);
    if (
      !available ||
      available.kind !== expected.kind ||
      available.bytes !== expected.bytes ||
      normalizedSha(available.sha256) !== normalizedSha(expected.sha256)
    )
      return "unpublished-assets";
  }
  return "ok";
}

function normalizedAppearance(
  value: PortableShareAppearance | undefined,
): PortableShareAppearance | "invalid" | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return "invalid";

  const keys = Reflect.ownKeys(value);
  if (
    keys.length === 0 ||
    keys.some(
      (key) => typeof key !== "string" || !APPEARANCE_KEYS.has(key as never),
    )
  )
    return "invalid";

  const normalized = normalizePortableAppearance(value);
  if (!normalized || Object.keys(normalized).length !== keys.length)
    return "invalid";
  return normalized;
}

function presentationResult(value: unknown):
  | {
      ok: true;
      artifactSha256: string;
      fragment: string;
    }
  | {
      ok: false;
      reason: "inline-too-large";
      artifactSha256: string;
    }
  | { ok: false; reason: "invalid-inline-reference" } {
  if (value === null || typeof value !== "object")
    return { ok: false, reason: "invalid-inline-reference" };
  const encoded = value as Record<string, unknown>;

  if (encoded.ok === false) {
    return encoded.reason === "inline-too-large" &&
      typeof encoded.artifactSha256 === "string" &&
      ARTIFACT_SHA256.test(encoded.artifactSha256)
      ? {
          ok: false,
          reason: "inline-too-large",
          artifactSha256: encoded.artifactSha256,
        }
      : { ok: false, reason: "invalid-inline-reference" };
  }
  if (
    encoded.ok !== true ||
    encoded.ref === null ||
    typeof encoded.ref !== "object"
  )
    return { ok: false, reason: "invalid-inline-reference" };

  const ref = encoded.ref as Record<string, unknown>;
  if (
    ref.format !== "refrain-presentation-ref@0-experimental" ||
    ref.mediaType !== "application/vnd.refrain+json" ||
    typeof ref.artifactSha256 !== "string" ||
    !ARTIFACT_SHA256.test(ref.artifactSha256) ||
    ref.delivery === null ||
    typeof ref.delivery !== "object"
  )
    return { ok: false, reason: "invalid-inline-reference" };

  const delivery = ref.delivery as Record<string, unknown>;
  if (
    delivery.kind !== "inline" ||
    typeof delivery.fragment !== "string" ||
    !BASE64_URL.test(delivery.fragment)
  )
    return { ok: false, reason: "invalid-inline-reference" };
  return {
    ok: true,
    artifactSha256: ref.artifactSha256,
    fragment: delivery.fragment,
  };
}

function recipientFailure(
  planFormat: string,
  recipient: ShareRecipientCapabilities | undefined,
  requiredAssets: readonly AssetStamp[] | undefined,
): ShareFailureReason | undefined {
  if (!recipient) return "recipient-capability-unavailable";
  if (
    !Array.isArray(recipient.supportedPlanFormats) ||
    recipient.supportedPlanFormats.length > MAX_CAPABILITY_FORMATS ||
    recipient.supportedPlanFormats.some(
      (format) =>
        typeof format !== "string" ||
        format.length === 0 ||
        format.length > 256,
    ) ||
    new Set(recipient.supportedPlanFormats).size !==
      recipient.supportedPlanFormats.length ||
    (recipient.assetRouting !== "asset-free-only" &&
      recipient.assetRouting !== "verified-manifest") ||
    !Array.isArray(recipient.publishedAssets)
  )
    return "invalid-recipient-capability";

  if (
    !SHAREABLE_PLAN_FORMATS.includes(planFormat as never) ||
    !recipient.supportedPlanFormats.includes(planFormat)
  )
    return "unsupported-performance-plan";
  if (requiredAssets === undefined) return "asset-closure-unavailable";
  if (
    requiredAssets.length > 0 &&
    recipient.assetRouting !== "verified-manifest"
  )
    return "unpublished-assets";

  const assets = checkPublishedAssets(
    requiredAssets,
    recipient.publishedAssets,
  );
  return assets === "ok" ? undefined : assets;
}

export function planInlineShare(input: PlanInlineShareInput): SharePlan {
  if (!input.playerBaseUrl) return blockedShare("public-player-not-configured");
  const target = publicPlayerBase(input.playerBaseUrl);
  if (!target) return blockedShare("invalid-public-player");
  if (
    typeof input.bindingId !== "string" ||
    input.bindingId.length === 0 ||
    input.bindingId.length > 1_024
  )
    return blockedShare("binding-required");
  if (!THEMES.includes(input.theme)) return blockedShare("invalid-theme");

  const appearance = normalizedAppearance(input.appearance);
  if (appearance === "invalid") return blockedShare("invalid-appearance");

  const presentation = presentationResult(input.presentation);
  if (!presentation.ok && presentation.reason !== "inline-too-large")
    return blockedShare(presentation.reason);
  const artifactSha256 = presentation.artifactSha256;
  if (
    input.publishedArtifact !== undefined &&
    (!PUBLIC_CATALOG_ID.test(input.publishedArtifact.catalogId) ||
      !ARTIFACT_SHA256.test(input.publishedArtifact.artifactSha256) ||
      input.publishedArtifact.artifactSha256 !== artifactSha256)
  )
    return blockedShare("invalid-published-artifact");

  const recipientReason = recipientFailure(
    input.performancePlanFormat,
    input.recipient,
    input.requiredAssets,
  );
  if (recipientReason) return blockedShare(recipientReason);

  const maximum = input.maxUrlChars ?? DEFAULT_SHARE_URL_BUDGET;
  if (!Number.isSafeInteger(maximum) || maximum < 256)
    return blockedShare("invalid-url-budget");

  target.searchParams.set("binding", input.bindingId);
  target.searchParams.set("theme", input.theme);
  if (appearance?.symbolColor)
    target.searchParams.set("appearanceSymbol", appearance.symbolColor);
  if (appearance?.textColor)
    target.searchParams.set("appearanceText", appearance.textColor);
  if (appearance?.backgroundOpacity !== undefined)
    target.searchParams.set(
      "appearanceOpacity",
      String(appearance.backgroundOpacity),
    );
  if (appearance?.backgroundBlurPx !== undefined)
    target.searchParams.set(
      "appearanceBlur",
      String(appearance.backgroundBlurPx),
    );
  if (input.publishedArtifact) {
    target.searchParams.set("catalog", input.publishedArtifact.catalogId);
    target.searchParams.set("artifact", artifactSha256);
  } else if (!presentation.ok) {
    return blockedShare(presentation.reason);
  } else {
    target.hash = new URLSearchParams({
      artifact: artifactSha256,
      bytes: presentation.fragment,
    }).toString();
  }

  if (target.href.length > maximum) return blockedShare("url-budget-exceeded");
  return {
    kind: "link",
    url: target.href,
    artifactSha256,
    sound: "exact-live",
  };
}
