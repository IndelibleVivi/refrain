import { useEffect, useState } from "react";
import {
  deliverShareLink,
  type ShareDeliveryOutcome,
  type SharePlatform,
} from "./share-delivery.js";
import type { ShareFailureReason, SharePlan } from "./share-policy.js";
import type { RefrainLocale } from "./ui-copy.js";
import { uiCopy } from "./ui-copy.js";

function browserSharePlatform(): SharePlatform {
  return {
    ...(typeof navigator.share === "function"
      ? { share: navigator.share.bind(navigator) }
      : {}),
    ...(typeof navigator.canShare === "function"
      ? { canShare: navigator.canShare.bind(navigator) }
      : {}),
    ...(typeof navigator.clipboard?.writeText === "function"
      ? { writeText: navigator.clipboard.writeText.bind(navigator.clipboard) }
      : {}),
  };
}

function blockedMessage(
  copy: ReturnType<typeof uiCopy>,
  reason: ShareFailureReason,
): string {
  if (
    reason === "public-player-not-configured" ||
    reason === "invalid-public-player" ||
    reason === "recipient-capability-unavailable" ||
    reason === "invalid-recipient-capability"
  )
    return copy.sharePlayerUnavailable;
  if (
    reason === "inline-too-large" ||
    reason === "url-budget-exceeded" ||
    reason === "unpublished-assets" ||
    reason === "unsupported-performance-plan"
  )
    return copy.shareNeedsBundle;
  return copy.shareUnavailable;
}

function outcomeMessage(
  copy: ReturnType<typeof uiCopy>,
  outcome: ShareDeliveryOutcome | undefined,
): string {
  if (!outcome) return "";
  if (outcome.kind === "handed-off") return copy.shareHandedOff;
  if (outcome.kind === "copied") return copy.shareCopied;
  if (outcome.kind === "cancelled") return copy.shareCancelled;
  if (outcome.kind === "manual") return copy.shareManual;
  return copy.shareUnavailable;
}

export function ShareControl(props: {
  readonly hasLocalBackground: boolean;
  readonly includeAppearance: boolean;
  readonly locale: RefrainLocale;
  readonly onIncludeAppearanceChange: (include: boolean) => void;
  readonly plan: SharePlan;
  readonly title: string;
}) {
  const copy = uiCopy(props.locale);
  const [outcome, setOutcome] = useState<ShareDeliveryOutcome>();
  const planKey =
    props.plan.kind === "link"
      ? props.plan.url
      : `blocked:${props.plan.reason}`;
  useEffect(() => setOutcome(undefined), [planKey]);

  const deliver = (action: "share" | "copy") => {
    void deliverShareLink(
      props.plan,
      props.title,
      action,
      browserSharePlatform(),
    ).then(setOutcome);
  };
  const blocked = props.plan.kind !== "link";
  const manualUrl = outcome?.kind === "manual" ? outcome.url : undefined;

  return (
    <details className="refrain-share-control">
      <summary>{copy.shareAir}</summary>
      <div className="refrain-share-control__body">
        <label className="refrain-share-control__check">
          <input
            checked={props.includeAppearance}
            type="checkbox"
            onChange={(event) =>
              props.onIncludeAppearanceChange(event.currentTarget.checked)
            }
          />
          <span>{copy.shareCurrentAppearance}</span>
        </label>
        <p>{copy.shareDisclosure}</p>
        {props.hasLocalBackground ? <p>{copy.shareBackgroundLocal}</p> : null}
        <div className="refrain-share-control__actions">
          <button
            disabled={blocked}
            type="button"
            onClick={() => deliver("share")}
          >
            {copy.share}
          </button>
          <button
            disabled={blocked}
            type="button"
            onClick={() => deliver("copy")}
          >
            {copy.copyLink}
          </button>
        </div>
        <p aria-live="polite" role="status">
          {blocked
            ? blockedMessage(copy, props.plan.reason)
            : outcomeMessage(copy, outcome)}
        </p>
        {manualUrl ? (
          <textarea
            aria-label={copy.shareLink}
            readOnly
            rows={3}
            value={manualUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
        ) : null}
      </div>
    </details>
  );
}
