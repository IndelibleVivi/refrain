import type { SharePlan } from "./share-policy.js";

export interface SharePlatform {
  share?: (data: { title: string; url: string }) => Promise<void>;
  canShare?: (data: { title: string; url: string }) => boolean;
  writeText?: (text: string) => Promise<void>;
}

export type ShareDeliveryOutcome =
  | { kind: "handed-off" | "copied" | "cancelled" }
  | { kind: "manual"; url: string }
  | { kind: "blocked"; reason: string };

function isAbortError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "AbortError"
  );
}

/** Invoke synchronously inside a click handler with an already prepared plan. */
export async function deliverShareLink(
  plan: SharePlan,
  title: string,
  action: "share" | "copy",
  platform: SharePlatform,
): Promise<ShareDeliveryOutcome> {
  if (plan.kind !== "link") return { kind: "blocked", reason: plan.reason };

  const data = { title, url: plan.url };
  if (action === "share" && platform.share) {
    let supported = true;
    try {
      supported = !platform.canShare || platform.canShare(data);
    } catch {
      supported = false;
    }
    if (supported) {
      try {
        // Keep this invocation before the first await so it retains user activation.
        await platform.share(data);
        return { kind: "handed-off" };
      } catch (error) {
        if (isAbortError(error)) return { kind: "cancelled" };
      }
    }
  }

  if (platform.writeText) {
    try {
      await platform.writeText(plan.url);
      return { kind: "copied" };
    } catch {
      // The caller can render the exact URL for manual selection.
    }
  }
  return { kind: "manual", url: plan.url };
}
