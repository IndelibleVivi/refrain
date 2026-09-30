import { describe, expect, it } from "vitest";
import type { CompiledAir } from "@refrain/compiler";
import {
  SHINYGUITAR_AUTHORING_VOCABULARY,
  SHINYGUITAR_INSTRUMENT_VOCABULARY,
  createShinyguitarAcousticPack,
} from "../../soundpack/src/shinyguitar.js";
import { compileSfzCandidate } from "../../soundpack/src/sfz.js";
import {
  soundObjectContentSha256,
  type SoundAssetDefinition,
  type SoundpackManifest,
} from "../../soundpack/src/index.js";
import { createPerformancePlan } from "./performance.js";

/** A one-group, pitch-tight asset lock for a structural plan@4 test. */
function syntheticCandidate() {
  const locks = [0, 1, 2, 3].map((index) => ({
    path: `Programs/acoustic/z${index}.wav`,
    asset: {
      id: `shiny-plan-${index}`,
      kind: "wav" as const,
      source: {
        repository: "https://github.com/sfzinstruments/karoryfer.shinyguitar",
        ref: "57243cca85277dbcc120ce17c6178032f93c80f3",
        url: `https://example/${index}.wav`,
      },
      localPath: `soundpacks/shinyguitar-archtop/sha256/z${index}.wav`,
      bytes: 4000 + index,
      sha256: String(index + 5).repeat(64),
      audio: { sampleRate: 44_100, frameCount: 2000, channels: 1 as const },
      license: {
        expression: "CC0-1.0",
        path: "third_party/Karoryfer-Shinyguitar/LICENSE.txt",
        assetScope: "test",
      },
      processingHistory: [
        {
          operation: "source-lock",
          tool: "test",
          inputSha256: String(index + 5).repeat(64),
          outputSha256: String(index + 5).repeat(64),
          parameters: {},
        },
      ],
      releaseStatus: "listening-candidate" as const,
      publicReleaseAccepted: false as const,
    } satisfies SoundAssetDefinition,
  }));
  const sfz = [
    "<control>",
    "default_path=acoustic\\",
    "<global>",
    "ampeg_dynamic=1",
    "ampeg_attack=0.001",
    "ampeg_release=0.25",
    "<group>",
    "lokey=33",
    "hikey=91",
    "pitch_keycenter=40",
    "amplitude=100",
    "amplitude_oncc100=100",
    "hicc100=126",
    "ampeg_releasecc106=-0.200",
    "<region>",
    "sample=z0.wav",
    "lovel=1",
    "hivel=127",
    "hirand=0.250",
    "<region>",
    "sample=z1.wav",
    "lovel=1",
    "hivel=127",
    "lorand=0.250",
    "hirand=0.500",
    "<region>",
    "sample=z2.wav",
    "lovel=1",
    "hivel=127",
    "lorand=0.500",
    "hirand=0.750",
    "<region>",
    "sample=z3.wav",
    "lovel=1",
    "hivel=127",
    "lorand=0.750",
    "",
  ].join("\n");
  return compileSfzCandidate({
    sfzText: sfz,
    sfzPath: "Programs/acoustic.sfz",
    candidateId: "archtop-guitar-shinyguitar-acoustic",
    instrumentId: "archtop_guitar",
    midiFallbackProgram: 25,
    calibrationGainDb: 0,
    releaseStatus: "listening-candidate",
    vocabulary: SHINYGUITAR_INSTRUMENT_VOCABULARY,
    defaults: {
      ampegDynamic: 1,
      attackSeconds: 0.001,
      releaseSeconds: 0.25,
      minVelocity: 1,
      maxVelocity: 127,
    },
    assetLocks: locks,
  });
}

const compiled: CompiledAir = {
  format: "compiled-air@0-experimental",
  sourceFormat: "air@0-experimental",
  title: "Shinyguitar plan",
  tempo: 96,
  meter: "4/4",
  beatsPerBar: 4,
  durationBeats: 4,
  durationSeconds: 2.5,
  events: [
    {
      id: "arch:1:1",
      voiceId: "arch",
      role: "lead",
      instrument: "archtop_guitar",
      midi: 52,
      note: "E3",
      startBeat: 0,
      durationBeats: 2,
      soundingDurationBeats: 2,
      velocity: 0.72,
      gainDb: -3,
      pan: 0,
      bar: 1,
      articulation: "none",
      gate: 1,
      source: { voiceId: "arch", authoring: "part" },
    },
  ],
  motifFamilies: [],
  motifOccurrences: [],
  segments: [],
  sections: [],
};

describe("archtop_guitar plan@4 through the carried vocabulary", () => {
  const built = syntheticCandidate();
  const pack = createShinyguitarAcousticPack({
    candidate: built.candidate,
    assets: built.assets,
  });
  const manifestCore = {
    format: "refrain-soundpack@1-experimental" as const,
    id: `${pack.candidateShard.id}-plan-manifest`,
    status: "development-candidates" as const,
    assets: pack.candidateShard.assets,
    candidates: [pack.candidateShard.candidate],
  };
  const manifest: SoundpackManifest = {
    ...manifestCore,
    contentSha256: soundObjectContentSha256(manifestCore),
  };

  it("resolves a plan@4 when the explicit carried vocabulary is supplied", () => {
    const plan = createPerformancePlan(compiled, {
      performanceBinding: pack.binding,
      soundRegistry: manifest,
      instrumentVocabulary: SHINYGUITAR_INSTRUMENT_VOCABULARY,
    });
    expect(plan.format).toBe("performance-plan@4-experimental");
    expect(plan.voices[0]!.instrument).toBe("archtop_guitar");
    expect(plan.requiredAssets.length).toBeGreaterThan(0);
    expect(plan.vocabulary.id).toBe(SHINYGUITAR_INSTRUMENT_VOCABULARY.id);
  });

  it("fails closed when the carried vocabulary is omitted", () => {
    expect(() =>
      createPerformancePlan(compiled, {
        performanceBinding: pack.binding,
        soundRegistry: manifest,
      }),
    ).toThrow(/Invalid or duplicate sound candidate/);
  });

  it("carries the preserved core vocabulary plus archtop_guitar", () => {
    expect(
      SHINYGUITAR_AUTHORING_VOCABULARY.instruments.some(
        (instrument) => instrument.id === "archtop_guitar",
      ),
    ).toBe(true);
  });
});
