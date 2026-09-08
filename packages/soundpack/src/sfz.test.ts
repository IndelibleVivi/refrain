import { describe, expect, it } from "vitest";
import {
  collectSfzSamplePaths,
  compileSfzCandidate,
  type CompileSfzCandidateInput,
} from "./sfz.js";

const source = `<control>
default_path=Woodwinds\\Flute\\susNV\\
<global>
ampeg_attack=0.001
ampeg_release=0.7
ampeg_dynamic=1
volume=0
<group>
seq_length=1
seq_position=1
group_label=main
<region>
sample=soft.wav
lokey=60
hikey=64
pitch_keycenter=62
lovel=0
hivel=63
volume=12
<region>
sample=loud.wav
lokey=60
hikey=64
pitch_keycenter=62
lovel=64
hivel=127
volume=4
`;

function input(sfzText = source): CompileSfzCandidateInput {
  return {
    sfzText,
    sfzPath: "FluteSusNV.sfz",
    candidateId: "flute-sfz-test",
    instrumentId: "flute",
    midiFallbackProgram: 73,
    calibrationGainDb: 0,
    releaseStatus: "listening-candidate",
    assetLocks: ["soft.wav", "loud.wav"].map((name, index) => ({
      path: `Woodwinds/Flute/susNV/${name}`,
      asset: {
        id: `flute-test-${index}`,
        kind: "wav",
        source: {
          repository: "https://github.com/sgossner/VSCO-2-CE",
          ref: "6dd651d55dde97fd4028699be9d4481f26917891",
          url: `https://assets.example/${name}`,
        },
        localPath: `soundpacks/test/${name}`,
        bytes: 1024 + index,
        sha256: String(index + 1).repeat(64),
        audio: { sampleRate: 44_100, frameCount: 480_000, channels: 1 },
        license: {
          expression: "CC0-1.0",
          path: "third_party/VSCO-2-CE/LICENSE.txt",
          assetScope: "Pinned VSCO 2 CE source WAV.",
        },
        processingHistory: [
          {
            operation: "source-lock",
            tool: "fixture",
            inputSha256: String(index + 1).repeat(64),
            outputSha256: String(index + 1).repeat(64),
            parameters: {},
          },
        ],
        releaseStatus: "listening-candidate",
        publicReleaseAccepted: false,
      },
    })),
  };
}

describe("allow-listed SFZ compiler", () => {
  it("compiles inherited regions, exact locks, coverage, and source lines", () => {
    expect(collectSfzSamplePaths(source)).toEqual([
      "Woodwinds/Flute/susNV/soft.wav",
      "Woodwinds/Flute/susNV/loud.wav",
    ]);
    const compiled = compileSfzCandidate(input());
    expect(compiled.candidate.mapping).toMatchObject({
      type: "sample-map",
      playableMin: 60,
      playableMax: 64,
      regions: [
        {
          velocity: { min: 1, max: 63 },
          gainDb: 12,
          attackSeconds: 0.001,
          release: { mode: "envelope", seconds: 0.7 },
        },
        { velocity: { min: 64, max: 127 }, gainDb: 4 },
      ],
    });
    expect(compiled.coverage).toEqual({
      playableMin: 60,
      playableMax: 64,
      regionCount: 2,
      assetCount: 2,
      velocityBreaks: [1, 63, 64, 127],
    });
    expect(
      compiled.sourceMap.regions.map((region) => region.sourceLine),
    ).toEqual([12, 20]);
  });

  it("fails closed on unknown sound opcodes, random selection, and path escape", () => {
    expect(() =>
      compileSfzCandidate(input(source.replace("volume=12", "cutoff=1200"))),
    ).toThrow(/Unsupported sound-affecting SFZ opcode cutoff/);
    expect(() =>
      compileSfzCandidate(
        input(source.replace("group_label=main", "lorand=0")),
      ),
    ).toThrow(/Unsupported sound-affecting SFZ opcode lorand/);
    expect(() =>
      compileSfzCandidate(
        input(source.replace("soft.wav", "..\\..\\..\\..\\soft.wav")),
      ),
    ).toThrow(/escapes its source root/);
  });

  it("rejects unlocked samples and unsupported sequencing semantics", () => {
    expect(() =>
      compileSfzCandidate({
        ...input(),
        assetLocks: input().assetLocks.slice(0, 1),
      }),
    ).toThrow(/has no exact asset lock/);
    expect(() =>
      compileSfzCandidate(
        input(source.replace("seq_length=1", "seq_length=2")),
      ),
    ).toThrow(/incomplete round-robin group/);
  });

  it("lowers same-line key regions, two-way RR, and explicit velocity curves", () => {
    const rrSource = `<control> default_path=Woodwinds\\Flute\\susNV\\
<global> ampeg_dynamic=1 ampeg_attack=0.01 ampeg_release=1
<group> seq_length=2 hicc107=15
<region> key=60 lovel=1 hivel=64 amp_velcurve_64=1 sample=soft.wav
<region> key=60 lovel=1 hivel=64 amp_velcurve_64=1 seq_position=2 sample=loud.wav
`;
    const compiled = compileSfzCandidate(input(rrSource));
    expect(compiled.candidate.mapping).toMatchObject({
      regions: [
        {
          pitch: { minMidi: 60, rootMidi: 60, maxMidi: 60 },
          roundRobin: { index: 0, count: 2 },
          velocityGainCurve: [
            { velocity: 0, gain: 0 },
            { velocity: 64, gain: 1 },
            { velocity: 127, gain: 1 },
          ],
        },
        { roundRobin: { index: 1, count: 2 } },
      ],
    });
  });

  it("uses the SFZ v1 pitch_keycenter default when a region omits it", () => {
    const defaultRootSource = `<control>
default_path=Woodwinds\\Flute\\susNV\\
<global>
ampeg_dynamic=1
ampeg_attack=0.01
ampeg_release=1
<region>
sample=soft.wav
lokey=59
hikey=61
lovel=1
hivel=127
`;
    const compiled = compileSfzCandidate({
      ...input(defaultRootSource),
      assetLocks: input().assetLocks.slice(0, 1),
    });
    expect(compiled.candidate.mapping).toMatchObject({
      regions: [{ pitch: { minMidi: 59, rootMidi: 60, maxMidi: 61 } }],
    });
  });
});
