import { describe, expect, it } from "vitest";
import { deliverShareLink } from "./share-delivery.js";
import type { SharePlan } from "./share-policy.js";

const readyPlan: SharePlan = {
  kind: "link",
  url: "https://music.example.org/try/?binding=exact#artifact=sha256%3Aabc&bytes=e30",
  artifactSha256: `sha256:${"a".repeat(64)}`,
  sound: "exact-live",
};

describe("share delivery fallbacks", () => {
  it("starts native sharing synchronously inside the caller's gesture", async () => {
    let invoked = false;
    const outcome = deliverShareLink(readyPlan, "一首曲子", "share", {
      share: async () => {
        invoked = true;
      },
    });
    expect(invoked).toBe(true);
    await expect(outcome).resolves.toEqual({ kind: "handed-off" });
  });

  it("treats AbortError as cancellation without surprising clipboard fallback", async () => {
    let copies = 0;
    const outcome = await deliverShareLink(readyPlan, "一首曲子", "share", {
      share: async () => {
        throw new DOMException("cancel", "AbortError");
      },
      writeText: async () => {
        copies += 1;
      },
    });
    expect(outcome).toEqual({ kind: "cancelled" });
    expect(copies).toBe(0);
  });

  it("falls back from unavailable native sharing to exactly one clipboard write", async () => {
    const writes: string[] = [];
    const outcome = await deliverShareLink(readyPlan, "一首曲子", "share", {
      writeText: async (value) => {
        writes.push(value);
      },
    });
    expect(outcome).toEqual({ kind: "copied" });
    expect(writes).toEqual([readyPlan.url]);
  });

  it("skips native sharing when canShare rejects these exact scalar fields", async () => {
    let nativeCalls = 0;
    const outcome = await deliverShareLink(readyPlan, "一首曲子", "share", {
      canShare: () => false,
      share: async () => {
        nativeCalls += 1;
      },
      writeText: async () => undefined,
    });
    expect(nativeCalls).toBe(0);
    expect(outcome).toEqual({ kind: "copied" });
  });

  it("falls back after native denial but exposes manual text after clipboard denial", async () => {
    const outcome = await deliverShareLink(readyPlan, "一首曲子", "share", {
      share: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
      writeText: async () => {
        throw new Error("denied");
      },
    });
    expect(outcome).toEqual({ kind: "manual", url: readyPlan.url });
  });

  it("uses explicit copy without opening the native share sheet", async () => {
    let nativeCalls = 0;
    const outcome = await deliverShareLink(readyPlan, "一首曲子", "copy", {
      share: async () => {
        nativeCalls += 1;
      },
      writeText: async () => undefined,
    });
    expect(nativeCalls).toBe(0);
    expect(outcome).toEqual({ kind: "copied" });
  });

  it("returns selectable manual text when no delivery API exists", async () => {
    await expect(
      deliverShareLink(readyPlan, "一首曲子", "share", {}),
    ).resolves.toEqual({ kind: "manual", url: readyPlan.url });
  });

  it("does not invoke any outward operation for a blocked plan", async () => {
    const outcome = await deliverShareLink(
      { kind: "needs-bundle", reason: "unpublished-assets" },
      "一首曲子",
      "share",
      {
        share: async () => {
          throw new Error("must not share");
        },
        writeText: async () => {
          throw new Error("must not copy");
        },
      },
    );
    expect(outcome).toEqual({
      kind: "blocked",
      reason: "unpublished-assets",
    });
  });
});
