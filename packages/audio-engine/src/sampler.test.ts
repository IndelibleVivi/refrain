import { describe, expect, it } from "vitest";
import { createAuditionPerformancePlan } from "./performance.js";
import { decodeWave, mixSamplerEvent, type DecodedWave } from "./sampler.js";

function pcm16Wave(samples: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((character, index) =>
      view.setUint8(offset + index, character.charCodeAt(0)),
    );
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 44_100, true);
  view.setUint32(28, 88_200, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) =>
    view.setInt16(44 + index * 2, sample, true),
  );
  return buffer;
}

describe("sampler WAV decoder", () => {
  it("decodes pinned-candidate PCM semantics without browser APIs", () => {
    const decoded = decodeWave(pcm16Wave([0, 16_384, -16_384]));
    expect(decoded).toMatchObject({ sampleRate: 44_100, frameCount: 3 });
    expect([...decoded.channels[0]!]).toEqual([0, 0.5, -0.5]);
  });

  it("loops a resolved sustain region until note-off and applies its envelope release", () => {
    const plan = createAuditionPerformancePlan("warm_piano", 60, {
      candidateId: "warm-piano-vcsl-kawai-c4",
    });
    const voice = plan.voices[0]!;
    const event = {
      ...plan.events[0]!,
      soundingDurationBeats: 2,
      noteOffBeat: 2,
      sample: {
        ...plan.events[0]!.sample!,
        attackAssetId: "loop",
        playbackRate: 1,
        loop: { mode: "sustain" as const, startFrame: 1, endFrame: 3 },
        release: { mode: "envelope" as const, seconds: 0.5 },
        renderEndSeconds: 2.5,
      },
    };
    const wave: DecodedWave = {
      sampleRate: 4,
      channels: [new Float32Array([0, 1, -1, 0])],
      frameCount: 4,
    };
    const left = new Float32Array(10);
    const right = new Float32Array(10);
    mixSamplerEvent(
      event,
      voice,
      new Map([["loop", wave]]),
      60,
      4,
      left,
      right,
    );

    expect(left.slice(4, 8).some((sample) => Math.abs(sample) > 0.01)).toBe(
      true,
    );
    expect(Math.abs(left[9]!)).toBeLessThan(
      Math.max(...left.slice(4, 9).map((sample) => Math.abs(sample))),
    );
  });

  it("lets natural one-shots ring past note-off and mixes a sampled release when resolved", () => {
    const plan = createAuditionPerformancePlan("warm_piano", 60, {
      candidateId: "warm-piano-vcsl-kawai-c4",
    });
    const voice = plan.voices[0]!;
    const base = plan.events[0]!;
    const natural = {
      ...base,
      soundingDurationBeats: 0.25,
      noteOffBeat: 0.25,
      sample: {
        ...base.sample!,
        attackAssetId: "one-shot",
        playbackRate: 1,
        loop: { mode: "none" as const },
        release: { mode: "natural" as const },
        renderEndSeconds: 1,
      },
    };
    const oneShot: DecodedWave = {
      sampleRate: 4,
      channels: [new Float32Array([0, 1, 1, 1])],
      frameCount: 4,
    };
    const naturalLeft = new Float32Array(4);
    const naturalRight = new Float32Array(4);
    mixSamplerEvent(
      natural,
      voice,
      new Map([["one-shot", oneShot]]),
      60,
      4,
      naturalLeft,
      naturalRight,
    );
    expect(naturalLeft[3]).toBeGreaterThan(0);

    const sampledRelease = {
      ...base,
      soundingDurationBeats: 0.5,
      noteOffBeat: 0.5,
      sample: {
        ...base.sample!,
        attackAssetId: "silent-attack",
        playbackRate: 1,
        loop: { mode: "none" as const },
        release: { mode: "sample" as const, seconds: 1 },
        releaseSample: {
          regionId: "release-region",
          assetId: "release",
          rootMidi: 60,
          playbackRate: 1,
          gainDb: 0,
        },
        renderEndSeconds: 1.5,
      },
    };
    const silence: DecodedWave = {
      sampleRate: 4,
      channels: [new Float32Array(4)],
      frameCount: 4,
    };
    const release: DecodedWave = {
      sampleRate: 4,
      channels: [new Float32Array([0, 1, 1, 0])],
      frameCount: 4,
    };
    const releaseLeft = new Float32Array(6);
    const releaseRight = new Float32Array(6);
    mixSamplerEvent(
      sampledRelease,
      voice,
      new Map([
        ["silent-attack", silence],
        ["release", release],
      ]),
      60,
      4,
      releaseLeft,
      releaseRight,
    );
    expect(releaseLeft[3]).toBeGreaterThan(0);
  });
});
