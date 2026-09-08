import { describe, expect, it } from "vitest";
import { compileAir } from "@refrain/compiler";
import {
  DEFAULT_PERFORMANCE_BINDING,
  DEFAULT_RENDER_SCENE,
  G3A_AUDITION_SOUND_PROFILE,
  SOUND_REGISTRY,
  candidateContentSha256,
  createPerformanceBinding,
  soundObjectContentSha256,
  soundProfileWithCandidates,
} from "@refrain/soundpack";
import {
  createAuditionPerformancePlan,
  createPerformancePlan,
} from "./performance.js";

describe("PerformancePlan", () => {
  it("resolves one channel, gain, pan, program, and note-off policy for every adapter", () => {
    const compiled = compileAir({
      format: "air@0-experimental",
      title: "Plan parity",
      tempo: 80,
      meter: "4/4",
      motifs: {},
      voices: [
        {
          id: "keys",
          instrument: "warm_piano",
          role: "harmony",
          part: "[C4,E4,G4]/1",
          gainDb: -3,
          pan: -0.25,
        },
        {
          id: "pad",
          instrument: "air_pad",
          role: "texture",
          part: "C4/1@pp",
          pan: 0.25,
        },
        {
          id: "drums",
          instrument: "soft_percussion",
          role: "percussion",
          part: "C2/4 r/4 D2/4 r/4",
        },
      ],
    }).compiled!;

    const plan = createPerformancePlan(compiled);
    expect(plan.format).toBe("performance-plan@2-experimental");
    expect(plan.performanceBinding).toEqual(DEFAULT_PERFORMANCE_BINDING);
    expect(plan.resolvedRenderProfile).toMatchObject({
      masterGainDb: -9,
      peakCeiling: 0.72,
      velocityScale: 1,
    });
    expect(plan).not.toHaveProperty("renderProfile");
    expect(plan.voices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          voiceId: "keys",
          candidateId: "warm-piano-generaluser",
          engine: "soundfont",
          channel: 0,
          program: 0,
          effectiveGainDb: -11,
          pan: -0.25,
        }),
        expect.objectContaining({
          voiceId: "pad",
          channel: 1,
          midiFallbackProgram: 89,
          effectiveGainDb: -18,
          pan: 0.25,
        }),
        expect.objectContaining({
          voiceId: "drums",
          channel: 9,
          effectiveGainDb: -16,
        }),
      ]),
    );
    expect(plan.events.find((event) => event.voiceId === "pad")).toMatchObject({
      channel: 1,
      velocity: 0.28,
      noteOnVelocity: 36,
      durationBeats: 4,
      soundingDurationBeats: 4,
      effectiveGainDb: -18,
    });
  });

  it("resolves an explicit per-instrument sampler candidate without changing AIR", () => {
    const compiled = compileAir({
      format: "air@0-experimental",
      title: "Candidate projection",
      tempo: 80,
      meter: "4/4",
      motifs: {},
      voices: [
        {
          id: "keys",
          instrument: "warm_piano",
          role: "lead",
          part: "C4/1",
        },
      ],
    }).compiled!;
    const soundProfile = soundProfileWithCandidates(
      G3A_AUDITION_SOUND_PROFILE,
      { warm_piano: "warm-piano-vcsl-kawai-c4" },
    );
    const plan = createPerformancePlan(compiled, {
      performanceBinding: createPerformanceBinding({
        id: "sampler-projection@0",
        soundProfile,
        renderScene: DEFAULT_RENDER_SCENE,
      }),
    });
    expect(plan.voices[0]).toMatchObject({
      engine: "sampler",
      candidateId: "warm-piano-vcsl-kawai-c4",
      effectiveGainDb: -3,
      mapping: { type: "sample-map" },
    });
    expect(plan.events[0]?.sample).toMatchObject({
      attackAssetId: "vcsl-kawai-piano-c4-rr1",
      rootMidi: 60,
    });
  });

  it("resolves master gain, peak ceiling, and velocity once for every adapter", () => {
    const compiled = compileAir({
      format: "air@0-experimental",
      title: "Profile authority",
      tempo: 80,
      meter: "4/4",
      motifs: {},
      voices: [
        {
          id: "keys",
          instrument: "warm_piano",
          role: "lead",
          part: "C4/1",
        },
      ],
    }).compiled!;
    const plan = createPerformancePlan(compiled, {
      performanceBinding: createPerformanceBinding({
        id: "profile-authority@0",
        soundProfile: G3A_AUDITION_SOUND_PROFILE,
        renderScene: DEFAULT_RENDER_SCENE,
        permittedOverrides: ["masterGainDb", "peakCeiling", "velocityScale"],
        overrides: {
          masterGainDb: -12,
          peakCeiling: 0.4,
          velocityScale: 0.5,
        },
      }),
    });
    expect(plan.resolvedRenderProfile).toEqual({
      masterGainDb: -12,
      peakCeiling: 0.4,
      velocityScale: 0.5,
    });
    expect(plan.events[0]).toMatchObject({
      performanceVelocity: 0.34,
      noteOnVelocity: 43,
    });
    expect(plan.voices[0]!.midiChannelGain).toBeLessThan(
      plan.voices[0]!.channelGain,
    );
  });

  it("routes audition through the same instrument gain and percussion-note policy", () => {
    const piano = createAuditionPerformancePlan("warm_piano", 60);
    expect(piano.voices[0]).toMatchObject({
      program: 0,
      effectiveGainDb: -8,
    });
    expect(piano.events[0]).toMatchObject({ midi: 60, effectiveGainDb: -8 });

    const kit = createAuditionPerformancePlan("soft_percussion", 60);
    expect(kit.voices[0]).toMatchObject({ channel: 9 });
    expect(kit.events[0]?.midi).toBe(36);
  });

  it("resolves an SFZ velocity curve into canonical event-specific sample gain", () => {
    const compiled = compileAir({
      format: "air@0-experimental",
      title: "Velocity curve",
      tempo: 80,
      meter: "4/4",
      motifs: {},
      voices: [
        {
          id: "keys",
          instrument: "warm_piano",
          role: "lead",
          part: "C4/1",
        },
      ],
    }).compiled!;
    const candidate = structuredClone(
      SOUND_REGISTRY.candidates.find(
        (item) => item.id === "warm-piano-vcsl-kawai-c4",
      )!,
    );
    if (candidate.mapping.type !== "sample-map")
      throw new Error("Fixture candidate is not a sample map.");
    for (const region of candidate.mapping.regions)
      region.velocityGainCurve = [
        { velocity: 0, gain: 0 },
        { velocity: 127, gain: 0.5 },
      ];
    const registryCore = {
      format: SOUND_REGISTRY.format,
      id: SOUND_REGISTRY.id,
      status: SOUND_REGISTRY.status,
      assets: [...SOUND_REGISTRY.assets],
      candidates: SOUND_REGISTRY.candidates.map((item) =>
        item.id === candidate.id ? candidate : item,
      ),
    };
    const registry = {
      ...registryCore,
      contentSha256: soundObjectContentSha256(registryCore),
    };
    const profileCore = {
      format: G3A_AUDITION_SOUND_PROFILE.format,
      id: "velocity-curve@1",
      vocabulary: { ...G3A_AUDITION_SOUND_PROFILE.vocabulary },
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
    const exactProfile = {
      ...profileCore,
      contentSha256: soundObjectContentSha256(profileCore),
    };
    const binding = createPerformanceBinding(
      {
        id: "velocity-curve@0",
        soundProfile: exactProfile,
        renderScene: DEFAULT_RENDER_SCENE,
      },
      registry,
    );
    const plan = createPerformancePlan(compiled, {
      performanceBinding: binding,
      soundRegistry: registry,
    });

    const event = plan.events[0]!;
    expect(
      10 ** (event.sample!.gainDb / 20) * event.performanceVelocity,
    ).toBeCloseTo((event.noteOnVelocity / 127) * 0.5, 8);
  });
});
