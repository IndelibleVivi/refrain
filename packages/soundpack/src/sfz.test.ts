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

  it("fails closed on unknown sound opcodes, incomplete random partitions, and path escape", () => {
    expect(() =>
      compileSfzCandidate(input(source.replace("volume=12", "cutoff=1200"))),
    ).toThrow(/Unsupported sound-affecting SFZ opcode cutoff/);
    // A lone lorand/hirand region cannot be a complete partition of [0,1].
    expect(() =>
      compileSfzCandidate(
        input(source.replace("sample=soft.wav", "sample=soft.wav\nlorand=0")),
      ),
    ).toThrow(/complete non-overlapping partition of \[0,1\]/);
    expect(() =>
      compileSfzCandidate(
        input(source.replace("sample=loud.wav", "sample=loud.wav\nhirand=0.5")),
      ),
    ).toThrow(/complete non-overlapping partition of \[0,1\]/);
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

  it("accepts the fixed controller opcodes only at their exact values", () => {
    const fixed = (over: string) =>
      `<control>
default_path=acoustic\\
<global>
ampeg_dynamic=1
ampeg_attack=0.001
ampeg_release=0.25
<group>
lokey=33
hikey=38
pitch_keycenter=37
${over}
amp_velcurve_32=1
<region>
sample=zone_vl1_rr1.wav
hirand=0.250
<region>
sample=zone_vl1_rr2.wav
lorand=0.250
hirand=0.500
<region>
sample=zone_vl1_rr3.wav
lorand=0.500
hirand=0.750
<region>
sample=zone_vl1_rr4.wav
lorand=0.750
`;
    const names = [
      "zone_vl1_rr1",
      "zone_vl1_rr2",
      "zone_vl1_rr3",
      "zone_vl1_rr4",
    ];
    const locks = names.map((name, index) => ({
      path: `acoustic/${name}.wav`,
      asset: {
        id: `fixed-${index}`,
        kind: "wav" as const,
        source: {
          repository: "https://github.com/sfzinstruments/karoryfer.shinyguitar",
          ref: "57243cca85277dbcc120ce17c6178032f93c80f3",
          url: `https://example/${name}.wav`,
        },
        localPath: `soundpacks/shiny/${name}.wav`,
        bytes: 2048 + index,
        sha256: (index + 7).toString(16).repeat(64),
        audio: { sampleRate: 44_100, frameCount: 512, channels: 1 as const },
        license: {
          expression: "CC0-1.0",
          path: "third_party/Karoryfer-Shinyguitar/LICENSE.txt",
          assetScope: "test",
        },
        processingHistory: [
          {
            operation: "source-lock",
            tool: "fixture",
            inputSha256: (index + 7).toString(16).repeat(64),
            outputSha256: (index + 7).toString(16).repeat(64),
            parameters: {},
          },
        ],
        releaseStatus: "listening-candidate" as const,
        publicReleaseAccepted: false as const,
      },
    }));
    const compileWith = (over: string) =>
      compileSfzCandidate({
        ...input(fixed(over)),
        candidateId: "archtop-guitar-shinyguitar-acoustic",
        instrumentId: "archtop_guitar",
        assetLocks: locks,
        vocabulary: {
          format: "refrain-instrument-vocabulary@0-experimental",
          id: "test-archtop@0",
          contentSha256: "f".repeat(64),
          instruments: [
            {
              id: "archtop_guitar",
              label: "Archtop guitar",
              family: "pitched",
              midiMin: 33,
              midiMax: 91,
              status: "active",
              authoringMeaning: "test",
            },
          ],
        },
        defaults: {
          ampegDynamic: 1,
          attackSeconds: 0.001,
          releaseSeconds: 0.25,
          minVelocity: 1,
          maxVelocity: 127,
        },
      });
    const accepted = compileWith(
      "amplitude=100\namplitude_oncc100=100\nhicc100=126\nampeg_releasecc106=-0.200",
    );
    expect(
      accepted.sourceMap.randomization.fixedOpcodes.map(
        (entry) => entry.opcode,
      ),
    ).toEqual(
      expect.arrayContaining([
        "amplitude",
        "amplitude_oncc100",
        "hicc100",
        "ampeg_releasecc106",
      ]),
    );
    expect(accepted.sourceMap.randomization.controllerState).toEqual({
      "100": 0,
      "106": 0,
    });
    for (const bad of [
      "amplitude=50",
      "amplitude_oncc100=50",
      "hicc100=64",
      "ampeg_releasecc106=-0.5",
    ])
      expect(() => compileWith(bad)).toThrow(/must be exactly/);
  });

  it("lowers a complete four-way lorand/hirand partition to candidate-scoped RR", () => {
    const partition = `<control>
default_path=acoustic\\
<global>
ampeg_dynamic=1
ampeg_attack=0.001
ampeg_release=0.25
<group>
lokey=33
hikey=38
hivel=32
pitch_keycenter=37
amplitude=100
amplitude_oncc100=100
hicc100=126
ampeg_releasecc106=-0.200
amp_velcurve_32=1
<region>
sample=zone_vl1_rr1.wav
hirand=0.250
<region>
sample=zone_vl1_rr2.wav
lorand=0.250
hirand=0.500
<region>
sample=zone_vl1_rr3.wav
lorand=0.500
hirand=0.750
<region>
sample=zone_vl1_rr4.wav
lorand=0.750
`;
    const names = [
      "zone_vl1_rr1",
      "zone_vl1_rr2",
      "zone_vl1_rr3",
      "zone_vl1_rr4",
    ];
    const locks = names.map((name, index) => ({
      path: `acoustic/${name}.wav`,
      asset: {
        id: `shiny-${index}`,
        kind: "wav" as const,
        source: {
          repository: "https://github.com/sfzinstruments/karoryfer.shinyguitar",
          ref: "57243cca85277dbcc120ce17c6178032f93c80f3",
          url: `https://example/${name}.wav`,
        },
        localPath: `soundpacks/shiny/${name}.wav`,
        bytes: 2048 + index,
        sha256: String(index + 3).repeat(64),
        audio: { sampleRate: 44_100, frameCount: 512, channels: 1 as const },
        license: {
          expression: "CC0-1.0",
          path: "third_party/Karoryfer-Shinyguitar/LICENSE.txt",
          assetScope: "Pinned Shinyguitar acoustic attack WAV.",
        },
        processingHistory: [
          {
            operation: "source-lock",
            tool: "fixture",
            inputSha256: String(index + 3).repeat(64),
            outputSha256: String(index + 3).repeat(64),
            parameters: {},
          },
        ],
        releaseStatus: "listening-candidate" as const,
        publicReleaseAccepted: false as const,
      },
    }));
    const compiled = compileSfzCandidate({
      ...input(partition),
      candidateId: "archtop-guitar-shinyguitar-acoustic",
      instrumentId: "archtop_guitar",
      assetLocks: locks,
      vocabulary: {
        format: "refrain-instrument-vocabulary@0-experimental",
        id: "test-archtop@0",
        contentSha256: "f".repeat(64),
        instruments: [
          {
            id: "archtop_guitar",
            label: "Archtop guitar",
            family: "pitched",
            midiMin: 33,
            midiMax: 91,
            status: "active",
            authoringMeaning: "A microphone-captured archtop guitar.",
          },
        ],
      },
      defaults: {
        ampegDynamic: 1,
        attackSeconds: 0.001,
        releaseSeconds: 0.25,
        minVelocity: 1,
        maxVelocity: 127,
      },
    });
    expect(compiled.candidate.mapping).toMatchObject({
      playableMin: 33,
      playableMax: 38,
      regions: [
        { roundRobin: { index: 0, count: 4 } },
        { roundRobin: { index: 1, count: 4 } },
        { roundRobin: { index: 2, count: 4 } },
        { roundRobin: { index: 3, count: 4 } },
      ],
    });
    expect(compiled.sourceMap.randomization).toMatchObject({
      policy: "candidate-scoped-explicit-round-robin",
      groups: [{ count: 4 }],
    });
    expect(
      new Set(
        compiled.sourceMap.randomization.groups[0]!.variants.map(
          (variant) => variant.samplePath,
        ),
      ).size,
    ).toBe(4);
    expect(
      compiled.sourceMap.randomization.fixedOpcodes.map(
        (entry) => entry.opcode,
      ),
    ).toEqual(
      expect.arrayContaining([
        "amplitude",
        "amplitude_oncc100",
        "hicc100",
        "ampeg_releasecc106",
      ]),
    );
  });
});
