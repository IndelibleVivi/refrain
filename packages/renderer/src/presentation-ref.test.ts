import { describe, expect, it } from "vitest";
import { parseAir } from "@refrain/air-schema";
import { DEFAULT_PERFORMANCE_BINDING } from "@refrain/soundpack";
import { receiptIdOf, sourceRevisionOf } from "./identity.js";
import { createRefrainArtifact } from "./portable.js";
import {
  createInlinePresentationRef,
  decodeInlinePresentationRef,
} from "./presentation-ref.js";
import type { AirReceipt } from "./types.js";

describe("artifact-byte presentation references", () => {
  it("round-trips exact Artifact @1 bytes through inline delivery", () => {
    const source = parseAir({
      format: "air@0-experimental",
      title: "Inline artifact",
      tempo: 100,
      meter: "4/4",
      motifs: {},
      voices: [
        {
          id: "pad",
          instrument: "air_pad",
          role: "texture",
          part: "C4/1",
        },
      ],
    }).source!;
    const sourceRevision = sourceRevisionOf(source);
    const core = {
      format: "refrain-receipt@0-experimental" as const,
      sourceRevision,
      airId: sourceRevision,
      sourceFormat: source.format,
      verification: {
        contract: "musical-relation@0-experimental" as const,
        status: "not_applicable" as const,
        motifLinks: [],
      },
    };
    const receipt: AirReceipt = { ...core, receiptId: receiptIdOf(core) };
    const artifact = createRefrainArtifact({
      source,
      receipt,
      performanceBinding: DEFAULT_PERFORMANCE_BINDING,
    });
    const inline = createInlinePresentationRef(artifact);
    if (!inline.ok) throw new Error(inline.reason);
    const parsed = decodeInlinePresentationRef(inline.ref);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.artifact).toEqual(artifact);
  });

  it("returns a typed session fallback instead of overflowing the URL", () => {
    const source = parseAir({
      format: "air@0-experimental",
      title: "Large exact artifact",
      tempo: 100,
      meter: "4/4",
      motifs: {},
      voices: Array.from({ length: 12 }, (_, index) => ({
        id: `voice_${index}`,
        instrument: "air_pad",
        role: "texture",
        part: Array.from({ length: 800 }, () => "C4/16").join(" "),
      })),
    }).source!;
    const sourceRevision = sourceRevisionOf(source);
    const core = {
      format: "refrain-receipt@0-experimental" as const,
      sourceRevision,
      airId: sourceRevision,
      sourceFormat: source.format,
      verification: {
        contract: "musical-relation@0-experimental" as const,
        status: "not_applicable" as const,
        motifLinks: [],
      },
    };
    const receipt: AirReceipt = { ...core, receiptId: receiptIdOf(core) };
    const artifact = createRefrainArtifact({
      source,
      receipt,
      performanceBinding: DEFAULT_PERFORMANCE_BINDING,
    });
    const result = createInlinePresentationRef(artifact);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("inline-too-large");
      expect(result.fragmentChars).toBeGreaterThan(result.maximumFragmentChars);
    }
  });
});
