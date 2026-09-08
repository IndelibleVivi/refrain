import { describe, expect, it } from "vitest";
import { rendererPlaybackCapability } from "./playback-capability.js";

describe("renderer playback capability", () => {
  it("allows zero-asset complete-piece synthesis without an asset origin", () => {
    expect(
      rendererPlaybackCapability({
        hasBinding: true,
        completePiece: true,
        assetRequirements: [],
        assets: {},
      }),
    ).toEqual({ status: "available" });
  });

  it("fails sampled and SoundFont execution before the user presses Play", () => {
    expect(
      rendererPlaybackCapability({
        hasBinding: true,
        completePiece: true,
        assetRequirements: [{ kind: "wav" }],
        assets: {},
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "sample-origin-missing",
    });
    expect(
      rendererPlaybackCapability({
        hasBinding: true,
        completePiece: true,
        assetRequirements: [{ kind: "soundfont" }],
        assets: { soundBankUrl: "/sound.sf2" },
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "soundfont-origin-missing",
    });
  });

  it("accepts an explicit same-origin sample plane", () => {
    expect(
      rendererPlaybackCapability({
        hasBinding: true,
        completePiece: true,
        assetRequirements: [{ kind: "wav" }],
        assets: { assetBaseUrl: "" },
      }),
    ).toEqual({ status: "available" });
  });

  it("keeps structure available when no exact binding exists", () => {
    expect(
      rendererPlaybackCapability({
        hasBinding: false,
        completePiece: false,
        assets: {},
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "performance-binding-missing",
    });
  });

  it("derives the soundfont, sampler, and pure-synth matrix from exact execution bundles", () => {
    const historical = compileAnyAir(
      JSON.parse(
        readFileSync("fixtures/valid/returning-home.air.json", "utf8"),
      ),
    ).compiled!;
    const synthetic = compileAnyAir(
      JSON.parse(
        readFileSync("fixtures/air-v1/synthetic-counterpulse.air.json", "utf8"),
      ),
    ).compiled!;
    const soundfont = createExecutionBundle(historical, {
      performanceBinding: COMPLETE_PIECE_PERFORMANCE_BINDING,
    });
    const sampler = createExecutionBundle(historical, {
      performanceBinding: F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING,
    });
    const pureSynth = createExecutionBundle(synthetic, {
      performanceBinding: F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
    });

    expect(
      rendererPlaybackCapability({
        hasBinding: true,
        completePiece: true,
        assetRequirements: soundfont.plan.assetRequirements,
        assets: {},
      }),
    ).toMatchObject({ reason: "soundfont-origin-missing" });
    expect(
      rendererPlaybackCapability({
        hasBinding: true,
        completePiece: true,
        assetRequirements: sampler.plan.assetRequirements,
        assets: {},
      }),
    ).toMatchObject({ reason: "sample-origin-missing" });
    expect(pureSynth.plan.assetRequirements).toEqual([]);
    expect(
      rendererPlaybackCapability({
        hasBinding: true,
        completePiece: true,
        assetRequirements: pureSynth.plan.assetRequirements,
        assets: {},
      }),
    ).toEqual({ status: "available" });
  });
});
import { readFileSync } from "node:fs";
import { compileAnyAir } from "@refrain/compiler/any";
import { createExecutionBundle } from "@refrain/audio-engine/execution";
import {
  COMPLETE_PIECE_PERFORMANCE_BINDING,
  F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING,
  F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
} from "@refrain/soundpack";
