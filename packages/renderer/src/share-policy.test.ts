import { describe, expect, it } from "vitest";
import {
  checkPublishedAssets,
  planInlineShare,
  publicPlayerBase,
  type AssetStamp,
  type EncodedPresentation,
  type PlanInlineShareInput,
} from "./share-policy.js";

const digest = "a".repeat(64);

function presentation(): EncodedPresentation {
  return {
    ok: true,
    artifactBytes: new Uint8Array([123, 125]),
    ref: {
      format: "refrain-presentation-ref@0-experimental",
      artifactSha256: `sha256:${digest}`,
      mediaType: "application/vnd.refrain+json",
      delivery: { kind: "inline", fragment: "e30" },
    },
  };
}

function input(): PlanInlineShareInput {
  return {
    presentation: presentation(),
    playerBaseUrl: "https://music.example.org/refrain/try/",
    bindingId: "exact-binding@1",
    theme: "nocturne-ink",
    performancePlanFormat: "performance-plan@4-experimental",
    recipient: {
      supportedPlanFormats: ["performance-plan@4-experimental"],
      assetRouting: "verified-manifest",
      publishedAssets: [],
    },
    requiredAssets: [],
  };
}

const asset: AssetStamp = {
  assetId: "sample-a",
  kind: "wav",
  bytes: 300,
  sha256: digest,
};

describe("zero-upload inline share planning", () => {
  it("preserves the public deployment subpath and exact current binding/theme", () => {
    const plan = planInlineShare(input());
    expect(plan.kind).toBe("link");
    if (plan.kind !== "link") return;

    const url = new URL(plan.url);
    expect(url.pathname).toBe("/refrain/try/");
    expect(url.searchParams.get("binding")).toBe("exact-binding@1");
    expect(url.searchParams.get("theme")).toBe("nocturne-ink");
    expect(new URLSearchParams(url.hash.slice(1))).toEqual(
      new URLSearchParams({
        artifact: `sha256:${digest}`,
        bytes: "e30",
      }),
    );
    expect(plan).toMatchObject({
      artifactSha256: `sha256:${digest}`,
      sound: "exact-live",
    });
  });

  it("carries only explicitly supplied bounded scalar appearance", () => {
    const plan = planInlineShare({
      ...input(),
      appearance: {
        symbolColor: "#A1B2C3",
        textColor: "#102030",
        backgroundOpacity: 0.35,
        backgroundBlurPx: 12,
      },
    });
    expect(plan.kind).toBe("link");
    if (plan.kind !== "link") return;

    const query = new URL(plan.url).searchParams;
    expect(query.get("appearanceSymbol")).toBe("#a1b2c3");
    expect(query.get("appearanceText")).toBe("#102030");
    expect(query.get("appearanceOpacity")).toBe("0.35");
    expect(query.get("appearanceBlur")).toBe("12");
  });

  it("writes no appearance query state when none was selected", () => {
    const plan = planInlineShare(input());
    expect(plan.kind).toBe("link");
    if (plan.kind !== "link") return;

    const query = new URL(plan.url).searchParams;
    expect(
      [...query.keys()].filter((key) => key.startsWith("appearance")),
    ).toEqual([]);
  });

  it.each([
    { symbolColor: "red" },
    { textColor: "#12345" },
    { backgroundOpacity: -0.01 },
    { backgroundOpacity: 0.66 },
    { backgroundBlurPx: -1 },
    { backgroundBlurPx: 25 },
    { backgroundImage: "blob:https://private.example/secret" },
    {},
  ])("rejects non-portable or unbounded appearance: %o", (appearance) => {
    expect(
      planInlineShare({
        ...input(),
        appearance: appearance as PlanInlineShareInput["appearance"],
      }),
    ).toEqual({ kind: "needs-bundle", reason: "invalid-appearance" });
  });

  it("does not leak source query, fragment, or stale appearance state", () => {
    const plan = planInlineShare({
      ...input(),
      playerBaseUrl:
        "https://music.example.org/try/?sessionHref=SECRET&token=PRIVATE&appearanceSymbol=%23FFFFFF#old-data",
    });
    expect(plan.kind).toBe("link");
    if (plan.kind !== "link") return;

    for (const value of [
      "SECRET",
      "PRIVATE",
      "sessionHref",
      "old-data",
      "appearanceSymbol",
    ])
      expect(plan.url).not.toContain(value);
  });

  it.each([
    "http://music.example.org/",
    "https://localhost/",
    "https://127.0.0.1/",
    "https://2130706433/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://10.0.0.2/",
    "https://my-mac.local/",
    "https://host.internal/",
    "https://host.lan/",
    "https://private-host/",
    "https://name:secret@music.example.org/",
    "file:///tmp/player.html",
    "javascript:alert(1)",
  ])("rejects a non-public player base: %s", (base) => {
    expect(publicPlayerBase(base)).toBeUndefined();
  });

  it("supports an explicit player file and normalizes a deployment root", () => {
    expect(
      publicPlayerBase("https://music.example.org/try/index.html")?.pathname,
    ).toBe("/try/index.html");
    expect(publicPlayerBase("https://music.example.org/try")?.pathname).toBe(
      "/try/",
    );
  });

  it("fails closed without an explicitly configured public player", () => {
    expect(planInlineShare({ ...input(), playerBaseUrl: undefined })).toEqual({
      kind: "needs-bundle",
      reason: "public-player-not-configured",
    });
  });

  it("requires the recipient to advertise the selected plan format", () => {
    expect(
      planInlineShare({
        ...input(),
        recipient: {
          ...input().recipient!,
          supportedPlanFormats: ["performance-plan@3-experimental"],
        },
      }),
    ).toEqual({
      kind: "needs-bundle",
      reason: "unsupported-performance-plan",
    });
    expect(
      planInlineShare({ ...input(), performancePlanFormat: "unknown-plan" }),
    ).toEqual({
      kind: "needs-bundle",
      reason: "unsupported-performance-plan",
    });
  });

  it("rejects missing or malformed recipient capability declarations", () => {
    expect(planInlineShare({ ...input(), recipient: undefined })).toEqual({
      kind: "needs-bundle",
      reason: "recipient-capability-unavailable",
    });
    expect(
      planInlineShare({
        ...input(),
        recipient: {
          ...input().recipient!,
          assetRouting: "trust-the-link" as never,
        },
      }),
    ).toEqual({
      kind: "needs-bundle",
      reason: "invalid-recipient-capability",
    });
  });

  it("allows asset-free execution without remote asset publication", () => {
    const plan = planInlineShare({
      ...input(),
      recipient: {
        supportedPlanFormats: ["performance-plan@4-experimental"],
        assetRouting: "asset-free-only",
        publishedAssets: [],
      },
    });
    expect(plan.kind).toBe("link");
    expect(checkPublishedAssets([], [])).toBe("ok");
  });

  it("never treats an unknown asset closure as asset-free", () => {
    expect(planInlineShare({ ...input(), requiredAssets: undefined })).toEqual({
      kind: "needs-bundle",
      reason: "asset-closure-unavailable",
    });
  });

  it("requires verified-manifest routing for non-empty exact asset closure", () => {
    expect(
      planInlineShare({
        ...input(),
        requiredAssets: [asset],
        recipient: {
          supportedPlanFormats: ["performance-plan@4-experimental"],
          assetRouting: "asset-free-only",
          publishedAssets: [],
        },
      }),
    ).toEqual({ kind: "needs-bundle", reason: "unpublished-assets" });

    expect(
      planInlineShare({
        ...input(),
        requiredAssets: [asset],
        recipient: {
          supportedPlanFormats: ["performance-plan@4-experimental"],
          assetRouting: "verified-manifest",
          publishedAssets: [asset],
        },
      }).kind,
    ).toBe("link");
  });

  it("matches every required asset by ID, kind, bytes, and SHA-256", () => {
    expect(checkPublishedAssets([asset], [asset])).toBe("ok");
    expect(
      checkPublishedAssets([asset], [{ ...asset, sha256: `sha256:${digest}` }]),
    ).toBe("ok");
    for (const change of [
      { bytes: 301 },
      { sha256: "b".repeat(64) },
      { kind: "soundfont" as const },
    ])
      expect(checkPublishedAssets([asset], [{ ...asset, ...change }])).toBe(
        "unpublished-assets",
      );
    expect(checkPublishedAssets([asset], [])).toBe("unpublished-assets");
  });

  it("rejects duplicate, malformed, or impossible asset manifests", () => {
    expect(checkPublishedAssets([asset], [asset, asset])).toBe(
      "invalid-asset-manifest",
    );
    expect(checkPublishedAssets([asset, asset], [asset])).toBe(
      "invalid-asset-manifest",
    );
    for (const change of [
      { bytes: Number.NaN },
      { bytes: 0 },
      { sha256: "bad" },
      { kind: "mp3" },
    ])
      expect(
        checkPublishedAssets([{ ...asset, ...change } as AssetStamp], []),
      ).toBe("invalid-asset-manifest");
  });

  it("carries the canonical inline-too-large result without another codec", () => {
    const tooLarge = {
      ok: false as const,
      reason: "inline-too-large" as const,
      artifactSha256: `sha256:${digest}`,
      artifactBytes: new Uint8Array(),
      fragmentChars: 49_153,
      maximumFragmentChars: 49_152,
    };
    expect(planInlineShare({ ...input(), presentation: tooLarge })).toEqual({
      kind: "needs-bundle",
      reason: "inline-too-large",
    });
  });

  it("uses a short exact locator for an artifact already published by the recipient", () => {
    const tooLarge = {
      ok: false as const,
      reason: "inline-too-large" as const,
      artifactSha256: `sha256:${digest}`,
      artifactBytes: new Uint8Array(),
      fragmentChars: 80_000,
      maximumFragmentChars: 49_152,
    };
    const plan = planInlineShare({
      ...input(),
      presentation: tooLarge,
      publishedArtifact: {
        catalogId: "velvet-mischief",
        artifactSha256: `sha256:${digest}`,
      },
    });
    expect(plan.kind).toBe("link");
    if (plan.kind !== "link") return;
    const url = new URL(plan.url);
    expect(url.searchParams.get("catalog")).toBe("velvet-mischief");
    expect(url.searchParams.get("artifact")).toBe(`sha256:${digest}`);
    expect(url.hash).toBe("");
  });

  it("rejects a malformed or mismatched published artifact locator", () => {
    for (const publishedArtifact of [
      { catalogId: "../private", artifactSha256: `sha256:${digest}` },
      {
        catalogId: "velvet-mischief",
        artifactSha256: "sha256:" + "b".repeat(64),
      },
    ])
      expect(planInlineShare({ ...input(), publishedArtifact })).toEqual({
        kind: "needs-bundle",
        reason: "invalid-published-artifact",
      });
  });

  it("enforces a separate conservative share-channel URL budget", () => {
    const large = presentation();
    if (!large.ok) throw new Error("fixture must be inline");
    large.ref.delivery.fragment = "a".repeat(9_000);
    expect(planInlineShare({ ...input(), presentation: large })).toEqual({
      kind: "needs-bundle",
      reason: "url-budget-exceeded",
    });
    expect(planInlineShare({ ...input(), maxUrlChars: 10 })).toEqual({
      kind: "needs-bundle",
      reason: "invalid-url-budget",
    });
  });

  it("rejects incomplete or corrupted inline presentation fields", () => {
    for (const corrupt of [
      (value: Record<string, unknown>) => {
        value.format = "wrong";
      },
      (value: Record<string, unknown>) => {
        value.mediaType = "text/html";
      },
      (value: Record<string, unknown>) => {
        value.artifactSha256 = "fake";
      },
      (value: Record<string, unknown>) => {
        value.delivery = { kind: "session", href: "https://private/" };
      },
      (value: Record<string, unknown>) => {
        value.delivery = { kind: "inline", fragment: "<script>" };
      },
    ]) {
      const encoded = presentation();
      if (!encoded.ok) throw new Error("fixture must be inline");
      corrupt(encoded.ref as unknown as Record<string, unknown>);
      expect(planInlineShare({ ...input(), presentation: encoded })).toEqual({
        kind: "needs-bundle",
        reason: "invalid-inline-reference",
      });
    }
  });

  it("does not silently default a missing binding or unknown theme", () => {
    expect(planInlineShare({ ...input(), bindingId: undefined })).toEqual({
      kind: "needs-bundle",
      reason: "binding-required",
    });
    expect(planInlineShare({ ...input(), theme: "invented" as never })).toEqual(
      { kind: "needs-bundle", reason: "invalid-theme" },
    );
  });

  it("does not mutate canonical presentation, appearance, or sound records", () => {
    const value: PlanInlineShareInput = {
      ...input(),
      appearance: {
        symbolColor: "#abcdef",
        backgroundOpacity: 0.5,
      },
      requiredAssets: [asset],
      recipient: {
        supportedPlanFormats: ["performance-plan@4-experimental"],
        assetRouting: "verified-manifest",
        publishedAssets: [asset],
      },
    };
    const before = structuredClone(value);
    planInlineShare(value);
    expect(value).toEqual(before);
  });
});
