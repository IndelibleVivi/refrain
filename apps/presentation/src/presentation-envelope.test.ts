import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  receiptIdentityJson,
  type AirReceipt,
  type PresentationEnvelope,
} from "@refrain/renderer";
import { hum } from "@refrain/mcp-server/hum";
import {
  DEFAULT_RENDER_SCENE,
  G3A_AUDITION_SOUND_PROFILE,
  SOUND_REGISTRY,
  candidateContentSha256,
  createPerformanceBinding,
  createSoundPalette,
  soundObjectContentSha256,
  type PerformanceBinding,
  type SoundProfile,
  type SoundpackManifest,
} from "@refrain/soundpack";
import {
  decodePresentationHash,
  verifyPresentationEnvelope,
} from "./presentation-envelope.js";

const fixture = JSON.parse(
  readFileSync(resolve("fixtures/valid/returning-home.air.json"), "utf8"),
);

function hashOf(envelope: PresentationEnvelope): string {
  return `#air=${Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url")}`;
}

function reidentifyReceipt(receipt: AirReceipt): AirReceipt {
  const { receiptId: _receiptId, ...core } = receipt;
  return {
    ...core,
    receiptId: `sha256:${createHash("sha256")
      .update(receiptIdentityJson(core))
      .digest("hex")}`,
  };
}

function extendedFixture(title: string) {
  return {
    ...fixture,
    title,
    voices: fixture.voices.map((voice: Record<string, unknown>) =>
      typeof voice.part === "string"
        ? { ...voice, part: `${voice.part} | r/1` }
        : voice,
    ),
  };
}

function unavailablePerformanceFixture(): PerformanceBinding {
  const registry = structuredClone(SOUND_REGISTRY) as SoundpackManifest;
  const candidate = registry.candidates.find(
    (item) => item.id === "warm-piano-generaluser",
  )!;
  candidate.id = "historical-warm-piano-generaluser";
  registry.contentSha256 = soundObjectContentSha256(registry);
  const profileCore = {
    format: G3A_AUDITION_SOUND_PROFILE.format,
    id: "historical-presentation@1",
    vocabulary: G3A_AUDITION_SOUND_PROFILE.vocabulary,
    selections: {
      ...G3A_AUDITION_SOUND_PROFILE.selections,
      warm_piano: {
        candidateChain: [
          {
            id: candidate.id,
            sha256: candidateContentSha256(candidate, registry),
          },
        ],
        fallbackPolicy: "strict" as const,
      },
    },
  };
  const profile: SoundProfile = {
    ...profileCore,
    contentSha256: soundObjectContentSha256(profileCore),
  };
  const palette = createSoundPalette({
    id: "historical-presentation@1",
    status: "engineering",
    soundProfile: profile,
    renderScene: DEFAULT_RENDER_SCENE,
    authoringGuide: "Unavailable exact-candidate presentation fixture.",
  });
  return createPerformanceBinding(
    {
      id: "historical-presentation@1",
      soundProfile: profile,
      renderScene: DEFAULT_RENDER_SCENE,
      soundPalette: palette,
    },
    registry,
  );
}

describe("presentation envelope", () => {
  it("recompiles and verifies a compact source-and-receipt envelope", async () => {
    const result = hum({ air: fixture, caption: "A compact URL." });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const envelope: PresentationEnvelope = {
      format: "refrain-presentation@1-experimental",
      source: result.source,
      receipt: result.receipt,
      performanceBinding: result.performanceBinding,
      caption: result.caption,
    };
    const decoded = decodePresentationHash(hashOf(envelope));
    const verified = await verifyPresentationEnvelope(decoded);
    expect(verified).toMatchObject({
      ok: true,
      artifact: {
        receipt: { sourceRevision: result.receipt.sourceRevision },
      },
    });
  });

  it("rejects source tampering instead of trusting compiled URL data", async () => {
    const result = hum({ air: fixture });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const envelope: PresentationEnvelope = {
      format: "refrain-presentation@1-experimental",
      source: { ...result.source, title: "Tampered" },
      receipt: result.receipt,
      performanceBinding: result.performanceBinding,
    };
    const verified = await verifyPresentationEnvelope(
      decodePresentationHash(hashOf(envelope)),
    );
    expect(verified).toMatchObject({
      ok: false,
      message: expect.stringContaining("source revision"),
    });
  });

  it("rejects every portable musical-receipt integrity failure in the browser verifier", async () => {
    const root = hum({ air: fixture });
    const independent = hum({
      air: { ...fixture, title: "Independent presentation identity" },
    });
    expect(root.ok && independent.ok).toBe(true);
    if (!root.ok || !independent.ok) return;
    expect(root.receipt.sourceRevision).not.toBe(
      independent.receipt.sourceRevision,
    );
    expect(root.receipt.receiptId).not.toBe(independent.receipt.receiptId);

    const verified = hum({
      air: extendedFixture("Verified presentation evidence"),
      from: {
        air: root.source,
        receipt: root.receipt,
        relation: "extend",
      },
    });
    const lineaged = hum({
      air: { ...fixture, title: "Presentation lineage" },
      from: {
        air: root.source,
        receipt: root.receipt,
        relation: "reply",
      },
    });
    expect(verified.ok && lineaged.ok).toBe(true);
    if (!verified.ok || !lineaged.ok) return;

    const invalidCases = [
      {
        name: "crossed source and receipt",
        source: root.source,
        receipt: independent.receipt,
      },
      {
        name: "stale receiptId",
        source: root.source,
        receipt: {
          ...root.receipt,
          receiptId: `sha256:${"0".repeat(64)}`,
        },
      },
      {
        name: "stale evidenceId",
        source: verified.source,
        receipt: reidentifyReceipt({
          ...verified.receipt,
          verification: {
            ...verified.receipt.verification,
            evidenceId: `sha256:${"0".repeat(64)}`,
          },
        }),
      },
      {
        name: "invalid root status",
        source: root.source,
        receipt: reidentifyReceipt({
          ...root.receipt,
          verification: {
            ...root.receipt.verification,
            status: "declared",
          },
        }),
      },
      {
        name: "invalid lineage status",
        source: lineaged.source,
        receipt: reidentifyReceipt({
          ...lineaged.receipt,
          verification: {
            ...lineaged.receipt.verification,
            status: "not_applicable",
          },
        }),
      },
    ] as const;

    for (const invalid of invalidCases) {
      const envelope: PresentationEnvelope = {
        format: "refrain-presentation@1-experimental",
        source: invalid.source,
        receipt: invalid.receipt,
        performanceBinding: root.performanceBinding,
      };
      await expect(
        verifyPresentationEnvelope(envelope),
        invalid.name,
      ).resolves.toMatchObject({ ok: false });
    }
  });

  it("keeps historical structure available while disabling unresolved exact performance", async () => {
    const result = hum({ air: fixture });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const historicalBinding = unavailablePerformanceFixture();
    const envelope: PresentationEnvelope = {
      format: "refrain-presentation@1-experimental",
      source: result.source,
      receipt: result.receipt,
      performanceBinding: historicalBinding,
    };

    const verified = await verifyPresentationEnvelope(
      decodePresentationHash(hashOf(envelope)),
    );
    expect(verified).toMatchObject({
      ok: true,
      artifact: {
        receipt: { sourceRevision: result.receipt.sourceRevision },
        performanceBinding: { id: historicalBinding.id },
        performanceStatus: {
          status: "unavailable",
          reason: "candidate-not-installed",
        },
      },
    });
  });
});
