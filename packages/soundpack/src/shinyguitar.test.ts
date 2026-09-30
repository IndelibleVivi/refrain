import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  INSTRUMENT_VOCABULARY,
  SOUND_REGISTRY,
  candidateContentSha256,
  validateSoundpackManifest,
  type SoundProfileSelection,
} from "./index.js";
import { collectSfzSamplePaths, compileSfzCandidate } from "./sfz.js";
import {
  validateCandidateShard,
  validateSoundCatalog,
  type CandidateShard,
} from "./factory.js";
import {
  CORE_AUTHORING_VOCABULARY,
  createPerformanceBindingV1,
  createSoundProfileV2,
  validateExtensionPackV1,
  validateExtensionPackAuthoringVocabulary,
  validatePerformanceBindingV1,
  validateSoundProfileV2,
  type AuthoringVocabularyClosure,
} from "./vnext.js";
import {
  ARCHTOP_GUITAR_INSTRUMENT,
  SHINYGUITAR_AIR_VOCABULARY,
  SHINYGUITAR_AUTHORING_VOCABULARY,
  SHINYGUITAR_BINDING_ID,
  SHINYGUITAR_INSTRUMENT_VOCABULARY,
  SHINYGUITAR_SOUND_PROFILE_ID,
  createShinyguitarAcousticPack,
  createShinyguitarAcousticProvider,
  shinyguitarAcousticExtensionPack,
  shinyguitarAcousticManifest,
  shinyguitarAcousticPin,
} from "./shinyguitar.js";

const SOURCE_ROOT = process.env.REFRAIN_SHINYGUITAR_SOURCE_ROOT ?? "";
const hasSource =
  SOURCE_ROOT.length > 0 && existsSync(`${SOURCE_ROOT}/Programs/acoustic.sfz`);

/** Minimal 24-bit/16-bit PCM WAV metadata reader for the local source test. */
function wavMetadata(
  bytes: Buffer,
  path: string,
): { sampleRate: number; frameCount: number; channels: 1 | 2 } {
  if (
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new Error(`${path} is not RIFF/WAVE.`);
  let cursor = 12;
  let sampleRate: number | undefined;
  let channels: number | undefined;
  let blockAlign: number | undefined;
  let dataBytes: number | undefined;
  while (cursor + 8 <= bytes.length) {
    const kind = bytes.toString("ascii", cursor, cursor + 4);
    const length = bytes.readUInt32LE(cursor + 4);
    const start = cursor + 8;
    if (kind === "fmt ") {
      channels = bytes.readUInt16LE(start + 2);
      sampleRate = bytes.readUInt32LE(start + 4);
      blockAlign = bytes.readUInt16LE(start + 12);
    } else if (kind === "data") {
      dataBytes = length;
    }
    cursor = start + length + (length % 2);
  }
  if (
    !sampleRate ||
    !blockAlign ||
    dataBytes === undefined ||
    (channels !== 1 && channels !== 2)
  )
    throw new Error(`${path} has incomplete WAV metadata.`);
  return {
    sampleRate,
    frameCount: dataBytes / blockAlign,
    channels,
  };
}

const SYNTHETIC_ASSETS = [
  { id: "shiny-a", sha256: "a".repeat(64), bytes: 1024 + 1, sampleRate: 44100 },
  { id: "shiny-b", sha256: "b".repeat(64), bytes: 1024 + 2, sampleRate: 44100 },
];

/** A tiny Shinyguitar-shaped candidate for structure tests without the source. */
function syntheticMaterial() {
  const locks = SYNTHETIC_ASSETS.map((asset, index) => ({
    path: `Programs/acoustic/z${index}.wav`,
    asset: {
      id: asset.id,
      kind: "wav" as const,
      source: {
        repository: "https://github.com/sfzinstruments/karoryfer.shinyguitar",
        ref: "57243cca85277dbcc120ce17c6178032f93c80f3",
        url: `https://example/${asset.id}.wav`,
      },
      localPath: `soundpacks/shinyguitar-archtop/sha256/${asset.id}.wav`,
      bytes: asset.bytes,
      sha256: asset.sha256,
      audio: {
        sampleRate: asset.sampleRate,
        frameCount: 1000,
        channels: 1 as const,
      },
      license: {
        expression: "CC0-1.0",
        path: "third_party/Karoryfer-Shinyguitar/LICENSE.txt",
        assetScope: "test",
      },
      processingHistory: [
        {
          operation: "source-lock",
          tool: "test",
          inputSha256: asset.sha256,
          outputSha256: asset.sha256,
          parameters: {},
        },
      ],
      releaseStatus: "listening-candidate" as const,
      publicReleaseAccepted: false as const,
    },
  }));
  const sfz = `<control>
default_path=acoustic\\
<global>
ampeg_dynamic=1
ampeg_attack=0.001
ampeg_release=0.25
<group>
lokey=33
hikey=48
pitch_keycenter=40
amplitude=100
amplitude_oncc100=100
hicc100=126
ampeg_releasecc106=-0.200
amp_velcurve_96=1
<region>
sample=z0.wav
lovel=1
hivel=96
hirand=0.250
<region>
sample=z1.wav
lovel=1
hivel=96
lorand=0.250
hirand=0.500
<region>
sample=z0.wav
lovel=1
hivel=96
lorand=0.500
hirand=0.750
<region>
sample=z1.wav
lovel=1
hivel=96
lorand=0.750
`;
  return { locks, sfz };
}

describe("shinyguitar archtop pack (synthetic structure)", () => {
  it("preserves every core instrument in the carried vocabulary and appends archtop_guitar", () => {
    expect(SHINYGUITAR_AUTHORING_VOCABULARY.instruments).toHaveLength(
      CORE_AUTHORING_VOCABULARY.instruments.length + 1,
    );
    const carriedIds = SHINYGUITAR_AUTHORING_VOCABULARY.instruments.map(
      (instrument) => instrument.id,
    );
    for (const instrument of CORE_AUTHORING_VOCABULARY.instruments) {
      expect(carriedIds).toContain(instrument.id);
      expect(
        SHINYGUITAR_AUTHORING_VOCABULARY.instruments.find(
          (item) => item.id === instrument.id,
        ),
      ).toEqual(instrument);
    }
    expect(
      SHINYGUITAR_AUTHORING_VOCABULARY.instruments.find(
        (instrument) => instrument.id === "archtop_guitar",
      ),
    ).toEqual(ARCHTOP_GUITAR_INSTRUMENT);
    expect(INSTRUMENT_VOCABULARY.instruments.map((i) => i.id)).not.toContain(
      "archtop_guitar",
    );
  });

  it("builds a canonical shard, catalog, sparse profile, scene and binding", () => {
    const { locks, sfz } = syntheticMaterial();
    const compiled = compileSfzCandidate({
      sfzText: sfz,
      sfzPath: "Programs/acoustic.sfz",
      candidateId: "archtop-guitar-shinyguitar-acoustic",
      instrumentId: "archtop_guitar",
      midiFallbackProgram: 25,
      calibrationGainDb: 0,
      releaseStatus: "listening-candidate",
      vocabulary: SHINYGUITAR_INSTRUMENT_VOCABULARY,
      assetLocks: locks,
    });
    const pack = createShinyguitarAcousticPack({
      candidate: compiled.candidate,
      assets: compiled.assets,
    });
    expect(
      validateCandidateShard(
        pack.candidateShard,
        SHINYGUITAR_INSTRUMENT_VOCABULARY,
      ),
    ).toEqual([]);
    expect(validateSoundCatalog(pack.catalog)).toEqual([]);
    expect(
      validateSoundProfileV2(
        pack.soundProfile,
        shinyguitarAcousticManifest(pack),
        SHINYGUITAR_AUTHORING_VOCABULARY,
      ),
    ).toEqual([]);
    expect(
      validatePerformanceBindingV1(
        pack.binding,
        shinyguitarAcousticManifest(pack),
      ),
    ).toEqual([]);
    expect(
      validateExtensionPackV1(shinyguitarAcousticExtensionPack(pack)),
    ).toEqual([]);
    expect(
      validateExtensionPackAuthoringVocabulary(
        shinyguitarAcousticExtensionPack(pack),
        SHINYGUITAR_AIR_VOCABULARY,
      ),
    ).toEqual([]);
    expect(pack.binding.id).toBe(SHINYGUITAR_BINDING_ID);
    expect(pack.soundProfile.id).toBe(SHINYGUITAR_SOUND_PROFILE_ID);
    expect(pack.catalog.candidates[0]!.shard.sha256).toBe(
      pack.candidateShard.contentSha256,
    );
    expect(pack.extensionPack.modules.map((m) => m.kind).sort()).toEqual([
      "authoring-vocabulary",
      "candidate-shard",
      "render-scene",
      "sound-profile",
    ]);
  });

  it("resolves the exact pin through the pack provider and rejects mismatch", () => {
    const { locks, sfz } = syntheticMaterial();
    const compiled = compileSfzCandidate({
      sfzText: sfz,
      sfzPath: "Programs/acoustic.sfz",
      candidateId: "archtop-guitar-shinyguitar-acoustic",
      instrumentId: "archtop_guitar",
      midiFallbackProgram: 25,
      calibrationGainDb: 0,
      releaseStatus: "listening-candidate",
      vocabulary: SHINYGUITAR_INSTRUMENT_VOCABULARY,
      assetLocks: locks,
    });
    const pack = createShinyguitarAcousticPack({
      candidate: compiled.candidate,
      assets: compiled.assets,
    });
    const provider = createShinyguitarAcousticProvider(pack);
    expect(
      provider.checkAvailability(shinyguitarAcousticPin(pack)).status,
    ).toBe("available");
    expect(
      provider.checkAvailability({
        id: pack.candidateShard.id,
        sha256: "0".repeat(64),
      }).status,
    ).toBe("unavailable");
    expect(() =>
      provider.resolveExact({ id: "unknown", sha256: "0".repeat(64) }),
    ).toThrow(/not installed/);
  });

  it("fails closed when the pack vocabulary is omitted or mismatched", () => {
    const { locks, sfz } = syntheticMaterial();
    expect(() =>
      compileSfzCandidate({
        sfzText: sfz,
        sfzPath: "Programs/acoustic.sfz",
        candidateId: "archtop-guitar-shinyguitar-acoustic",
        instrumentId: "archtop_guitar",
        midiFallbackProgram: 25,
        calibrationGainDb: 0,
        releaseStatus: "listening-candidate",
        // no vocabulary: validated against the core list, which lacks archtop_guitar
        assetLocks: locks,
      }),
    ).toThrow(/Invalid or duplicate sound candidate/);
    const mismatched: AuthoringVocabularyClosure = {
      ...SHINYGUITAR_AUTHORING_VOCABULARY,
      instruments: CORE_AUTHORING_VOCABULARY.instruments,
    };
    expect(() =>
      createSoundProfileV2({
        id: "bad@2",
        vocabulary: mismatched,
        selections: {
          archtop_guitar: {
            candidateChain: [
              {
                id: "archtop-guitar-shinyguitar-acoustic",
                sha256: "0".repeat(64),
              },
            ],
            fallbackPolicy: "strict",
          } satisfies SoundProfileSelection,
        },
        manifest: SOUND_REGISTRY,
      }),
    ).toThrow();
  });
});

describe.runIf(hasSource)(
  "shinyguitar archtop pack (real pinned source)",
  () => {
    it("lowers the 272-region program into 68 four-way RR groups over MIDI 33-91", async () => {
      const { readFile } = await import("node:fs/promises");
      const { resolve } = await import("node:path");
      const sfzPath = "Programs/acoustic.sfz";
      const sfzText = await readFile(resolve(SOURCE_ROOT, sfzPath), "utf8");
      const declaredPaths = collectSfzSamplePaths(sfzText, sfzPath);
      expect(declaredPaths).toHaveLength(272);
      const locks = [];
      let totalBytes = 0;
      for (const declared of declaredPaths) {
        const relative = declared.startsWith("Programs/")
          ? declared.slice("Programs/".length)
          : declared;
        const bytes = await readFile(resolve(SOURCE_ROOT, "Samples", relative));
        totalBytes += bytes.length;
        const digest = createHash("sha256").update(bytes).digest("hex");
        locks.push({
          path: declared,
          asset: {
            id: `shiny-${declared
              .replace(/\.[^.]+$/, "")
              .replace(/[^a-z0-9]+/gi, "-")
              .toLowerCase()}`,
            kind: "wav" as const,
            source: {
              repository:
                "https://github.com/sfzinstruments/karoryfer.shinyguitar",
              ref: "57243cca85277dbcc120ce17c6178032f93c80f3",
              url: `https://example/${declared}`,
            },
            localPath: `soundpacks/shinyguitar-archtop/sha256/${digest}.wav`,
            bytes: bytes.length,
            sha256: digest,
            audio: wavMetadata(bytes, declared),
            license: {
              expression: "CC0-1.0",
              path: "third_party/Karoryfer-Shinyguitar/LICENSE.txt",
              assetScope: "test",
            },
            processingHistory: [
              {
                operation: "source-lock",
                tool: "test",
                inputSha256: digest,
                outputSha256: digest,
                parameters: {},
              },
            ],
            releaseStatus: "listening-candidate" as const,
            publicReleaseAccepted: false as const,
          },
        });
      }
      expect(totalBytes).toBe(222_776_152);
      const compiled = compileSfzCandidate({
        sfzText,
        sfzPath,
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
      const mapping = compiled.candidate.mapping;
      if (mapping.type !== "sample-map") throw new Error("not a sample map");
      expect(mapping.playableMin).toBe(33);
      expect(mapping.playableMax).toBe(91);
      expect(mapping.regions).toHaveLength(272);
      expect(compiled.assets).toHaveLength(272);
      expect(compiled.sourceMap.randomization.groups).toHaveLength(68);
      for (const group of compiled.sourceMap.randomization.groups)
        expect(group.count).toBe(4);
      for (const region of mapping.regions)
        expect(region.roundRobin).toMatchObject({ count: 4 });
      expect(compiled.coverage.velocityBreaks).toEqual([
        1, 32, 33, 64, 65, 96, 97, 127,
      ]);
      // Every MIDI 33-91 x velocity 1-127 has exactly one four-way RR group.
      for (let midi = 33; midi <= 91; midi += 1)
        for (let velocity = 1; velocity <= 127; velocity += 1) {
          const hits = mapping.regions.filter(
            (region) =>
              midi >= region.pitch.minMidi &&
              midi <= region.pitch.maxMidi &&
              velocity >= region.velocity.min &&
              velocity <= region.velocity.max,
          );
          expect(hits).toHaveLength(4);
          expect(new Set(hits.map((r) => r.roundRobin!.index)).size).toBe(4);
        }
    });
  },
);

describe("checked-in shinyguitar pack projection", () => {
  const packRoot = new URL("../packs/shinyguitar-archtop/", import.meta.url);
  it("round-trips the generated shard, catalog, profile, scene, binding, and ExtensionPack@1", async () => {
    const { readFile } = await import("node:fs/promises");
    const read = async (name: string) =>
      JSON.parse(await readFile(new URL(name, packRoot), "utf8"));
    const shard = (await read(
      "candidates/sha256/" +
        JSON.parse(
          await readFile(new URL("build-record.json", packRoot), "utf8"),
        ).candidate.shardSha256 +
        ".json",
    )) as CandidateShard;
    expect(
      validateCandidateShard(shard, SHINYGUITAR_INSTRUMENT_VOCABULARY),
    ).toEqual([]);
    const catalog = await read("catalog.json");
    expect(validateSoundCatalog(catalog)).toEqual([]);
    expect(catalog.candidates[0].shard.sha256).toBe(shard.contentSha256);
    const profile = await read("sound-profile.json");
    const { soundObjectContentSha256 } = await import("./index.js");
    const packManifest = {
      format: "refrain-soundpack@1-experimental" as const,
      id: `${shard.id}-shard-validation`,
      status: "development-candidates" as const,
      assets: shard.assets,
      candidates: [shard.candidate],
    };
    expect(
      validateSoundProfileV2(
        profile,
        {
          ...packManifest,
          contentSha256: soundObjectContentSha256(packManifest),
        },
        SHINYGUITAR_AUTHORING_VOCABULARY,
      ),
    ).toEqual([]);
    const binding = await read("performance-binding.json");
    expect(binding.id).toBe(SHINYGUITAR_BINDING_ID);
    const pack = await read("pack.json");
    expect(validateExtensionPackV1(pack)).toEqual([]);
    const airVocabulary = await read("authoring-vocabulary.json");
    const runtimeVocabulary = await read("runtime-vocabulary.json");
    expect(airVocabulary).toEqual(SHINYGUITAR_AIR_VOCABULARY);
    expect(runtimeVocabulary).toEqual(SHINYGUITAR_AUTHORING_VOCABULARY);
    expect(
      validateExtensionPackAuthoringVocabulary(pack, airVocabulary),
    ).toEqual([]);
    expect(pack.modules.map((m: { kind: string }) => m.kind).sort()).toEqual([
      "authoring-vocabulary",
      "candidate-shard",
      "render-scene",
      "sound-profile",
    ]);
    expect(pack.modules).toHaveLength(4);
    expect(pack.assets).toHaveLength(272);
    const record = await read("build-record.json");
    expect(record.candidate.regionCount).toBe(272);
    expect(record.counts.randomGroups).toBe(68);
    expect(record.counts.audioBytes).toBe(222_776_152);
  });
});
