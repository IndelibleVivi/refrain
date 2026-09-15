import { describe, expect, it } from "vitest";
import { prepareCurrentAirShare } from "@refrain/renderer";
import {
  demoPublishedArtifacts,
  demoShareRecipient,
  demoWorks,
  firstAir,
  hasDemoSound,
  publishedDemoAir,
} from "./first-air.js";

describe("published first-listen works", () => {
  it.each(demoWorks)(
    "publishes exact sound and a short share locator for $id",
    (work) => {
      const result = firstAir(work.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(hasDemoSound(result.artifact)).toBe(true);

      const plan = prepareCurrentAirShare({
        view: result.artifact,
        theme: "prism",
        appearance: {
          symbolColor: "#a1b2c3",
          backgroundOpacity: 0.35,
        },
        deployment: {
          playerBaseUrl: "https://indeliblevivi.github.io/refrain/",
          recipient: demoShareRecipient,
          publishedArtifacts: demoPublishedArtifacts,
        },
      });
      expect(plan.kind).toBe("link");
      if (plan.kind !== "link") return;
      const url = new URL(plan.url);
      expect(url.href.length).toBeLessThan(1_000);
      expect(url.searchParams.get("catalog")).toBe(work.id);
      expect(url.searchParams.get("artifact")).toBe(plan.artifactSha256);
      expect(url.searchParams.get("binding")).toBe(
        result.artifact.performanceBinding?.id,
      );
      expect(url.searchParams.get("theme")).toBe("prism");
      expect(url.searchParams.get("appearanceSymbol")).toBe("#a1b2c3");
      expect(url.searchParams.get("appearanceOpacity")).toBe("0.35");
      expect(url.hash).toBe("");

      const received = publishedDemoAir(
        work.id,
        plan.artifactSha256,
        result.artifact.performanceBinding?.id,
      );
      expect(received.ok).toBe(true);
      if (received.ok)
        expect(received.artifact.performanceBinding?.contentSha256).toBe(
          result.artifact.performanceBinding?.contentSha256,
        );
    },
  );

  it("rejects a catalog locator whose artifact identity was changed", () => {
    expect(
      publishedDemoAir(demoWorks[0]!.id, `sha256:${"0".repeat(64)}`),
    ).toEqual({
      ok: false,
      message: "The published demo identity does not match this link.",
    });
  });

  it("does not call an unbound view sound-ready just because its closure is empty", () => {
    const result = firstAir();
    if (!result.ok) throw new Error(result.message);
    const unbound = { ...result.artifact };
    delete unbound.performanceBinding;
    delete unbound.performanceStatus;
    expect(hasDemoSound(unbound)).toBe(false);
  });
});
