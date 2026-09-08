import { describe, expect, it } from "vitest";
import { compileAir } from "@refrain/compiler";
import { G3B_VCSL_LISTENING_PERFORMANCE_BINDING } from "@refrain/soundpack";
import { createPerformancePlan } from "./performance.js";
import { attenuatePeak, encodePcmWav, renderPcm } from "./pcm.js";

describe("attenuatePeak", () => {
  it("leaves quiet material quiet and only reduces peaks above the ceiling", () => {
    const quietLeft = new Float32Array([0.05, -0.1]);
    const quietRight = new Float32Array([0.08, -0.04]);
    expect(attenuatePeak(quietLeft, quietRight, 0.72)).toBe(1);
    expect([...quietLeft]).toEqual([0.05000000074505806, -0.10000000149011612]);

    const loudLeft = new Float32Array([0.4, -1]);
    const loudRight = new Float32Array([0.8, 0.2]);
    expect(attenuatePeak(loudLeft, loudRight, 0.72)).toBeCloseTo(0.72);
    expect(Math.max(...[...loudLeft, ...loudRight].map(Math.abs))).toBeCloseTo(
      0.72,
    );
  });
});

describe("encodePcmWav", () => {
  it("preserves native resolved amplitude by default", () => {
    const wav = encodePcmWav({
      left: Float32Array.from([-0.5, 0, 0.5]),
      right: Float32Array.from([0.25, -0.25, 0]),
      sampleRate: 44_100,
      durationSeconds: 3 / 44_100,
    });
    const bytes = new Uint8Array(wav);
    const view = new DataView(wav);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint32(40, true)).toBe(12);
    expect(
      Array.from({ length: 6 }, (_, index) =>
        view.getInt16(44 + index * 2, true),
      ),
    ).toEqual([-16_383, 8191, 0, -8191, 16_383, 0]);
  });

  it("keeps audition peak matching explicit and separate from native output", () => {
    const pcm = {
      left: Float32Array.from([-0.5, 0, 0.5]),
      right: Float32Array.from([0.25, -0.25, 0]),
      sampleRate: 44_100,
      durationSeconds: 3 / 44_100,
    };
    const wav = encodePcmWav(pcm, {
      amplitude: {
        mode: "audition-peak-matched",
        targetPeak: 1,
        contract: "refrain-audition-peak-match@0-experimental",
      },
    });
    const view = new DataView(wav);
    expect(
      Array.from({ length: 6 }, (_, index) =>
        view.getInt16(44 + index * 2, true),
      ),
    ).toEqual([-32_767, 16_383, 0, -16_383, 32_767, 0]);
  });
});

describe("renderPcm cancellation", () => {
  it("rejects a same-length sampler replacement before decode", async () => {
    const compiled = compileAir({
      format: "air@0-experimental",
      title: "Corrupt sample",
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
      performanceBinding: G3B_VCSL_LISTENING_PERFORMANCE_BINDING,
    });
    const required = plan.requiredAssets[0]!;
    await expect(
      renderPcm(
        compiled,
        { samples: { [required.assetId]: new ArrayBuffer(required.bytes) } },
        8000,
        { plan },
      ),
    ).rejects.toThrow(/failed SHA-256 verification/);
  });

  it("yields and abandons a pending synth render", async () => {
    const compiled = compileAir({
      format: "air@0-experimental",
      title: "Cancelable render",
      tempo: 30,
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
    }).compiled!;
    let checks = 0;
    const result = await renderPcm(compiled, new ArrayBuffer(0), 8000, {
      isCancelled: () => {
        checks += 1;
        return checks >= 3;
      },
    });
    expect(result).toBeUndefined();
    expect(checks).toBeGreaterThanOrEqual(3);
  });

  it("preserves authored quietness and contains dense synth peaks", async () => {
    const render = async (dynamic: "pp" | "ff", voices = 1) => {
      const compiled = compileAir({
        format: "air@0-experimental",
        title: `${dynamic} render`,
        tempo: 120,
        meter: "4/4",
        motifs: {},
        voices: Array.from({ length: voices }, (_, index) => ({
          id: `pad-${index}`,
          instrument: "air_pad",
          role: "texture",
          part: `[C4,E4,G4,C5]/1@${dynamic}`,
          gainDb: 6,
        })),
      }).compiled!;
      return (await renderPcm(compiled, new ArrayBuffer(0), 4000))!;
    };
    const quiet = await render("pp");
    const loud = await render("ff");
    const dense = await render("ff", 8);
    const peak = (values: Float32Array[]) =>
      Math.max(...values.flatMap((value) => [...value]).map(Math.abs));
    expect(peak([quiet.left, quiet.right])).toBeLessThan(
      peak([loud.left, loud.right]),
    );
    expect(peak([dense.left, dense.right])).toBeLessThanOrEqual(0.720001);
  });
});
