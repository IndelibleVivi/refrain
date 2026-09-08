import { describe, expect, it } from "vitest";
import { AIR_FORMAT, type AirSource } from "@refrain/air-schema";
import { compileAir } from "@refrain/compiler";
import {
  DEFAULT_RENDER_SCENE,
  G3A_AUDITION_SOUND_PROFILE,
  createPerformanceBinding,
} from "@refrain/soundpack";
import { encodeMidi } from "./midi.js";
import { createPerformancePlan } from "./performance.js";

const source: AirSource = {
  format: AIR_FORMAT,
  title: "MIDI receipt",
  tempo: 80,
  meter: "4/4",
  motifs: {},
  voices: [
    {
      id: "lead",
      instrument: "warm_piano",
      role: "lead",
      part: "C4/4 D4/4 E4/4 G4/4",
    },
  ],
};

describe("encodeMidi", () => {
  it("writes a type-1 MIDI projection", () => {
    const compiled = compileAir(source).compiled!;
    const midi = encodeMidi(compiled);
    expect(new TextDecoder().decode(midi.slice(0, 4))).toBe("MThd");
    expect(midi.length).toBeGreaterThan(60);
  });

  it("projects voice gain, pan, and authored percussion notes", () => {
    const compiled = compileAir({
      ...source,
      voices: [
        {
          id: "drums",
          instrument: "soft_percussion",
          role: "percussion",
          part: "C2/4 C2/4 C2/4 C2/4",
          gainDb: -3,
          pan: 0.5,
        },
      ],
    }).compiled!;
    const midi = [...encodeMidi(compiled)];
    expect(midi).toContain(0xb9);
    expect(midi).toContain(7);
    expect(midi).toContain(10);
    const noteOn = midi.findIndex((byte) => byte === 0x99);
    expect(midi[noteOn + 1]).toBe(36);
  });

  it("uses the shared lifecycle and resolved velocity/profile values", () => {
    const compiled = compileAir({
      ...source,
      voices: [
        {
          id: "lead",
          instrument: "warm_piano",
          role: "lead",
          realize: [
            { id: "a", kind: "literal", part: "C4/2", articulation: "legato" },
            { id: "b", kind: "literal", part: "C4/2", articulation: "legato" },
          ],
        },
      ],
    }).compiled!;
    const plan = createPerformancePlan(compiled, {
      performanceBinding: createPerformanceBinding({
        id: "midi-profile-test@0",
        soundProfile: G3A_AUDITION_SOUND_PROFILE,
        renderScene: DEFAULT_RENDER_SCENE,
        permittedOverrides: ["masterGainDb", "velocityScale"],
        overrides: { masterGainDb: -12, velocityScale: 0.5 },
      }),
    });
    const midi = [...encodeMidi(compiled, plan)];
    expect(midi.filter((byte) => byte === 0x90)).toHaveLength(2);
    expect(midi.filter((byte) => byte === 0x80)).toHaveLength(1);
    const firstNoteOn = midi.findIndex((byte) => byte === 0x90);
    expect(midi[firstNoteOn + 2]).toBe(plan.events[0]?.noteOnVelocity);
    const volume = midi.findIndex(
      (byte, index) => byte === 0xb0 && midi[index + 1] === 7,
    );
    expect(midi[volume + 2]).toBe(plan.voices[0]?.midiChannelGain);
    const embedded = [
      ...encodeMidi(compiled, plan, { includeMasterGain: false }),
    ];
    const embeddedVolume = embedded.findIndex(
      (byte, index) => byte === 0xb0 && embedded[index + 1] === 7,
    );
    expect(embedded[embeddedVolume + 2]).toBe(plan.voices[0]?.channelGain);
  });
});
