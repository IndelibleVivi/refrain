import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { format as formatText } from "prettier";
import {
  SOUND_REGISTRY,
  validateSoundpackManifest,
  soundObjectContentSha256,
  type InstrumentCandidate,
  type SampleRegion,
  type SoundAssetDefinition,
  type SoundpackManifest,
} from "@refrain/soundpack";
import {
  SFZ_COMPILER_CONTRACT,
  collectSfzSamplePaths,
  compileSfzCandidate,
  type CompiledSfzCandidate,
  type SfzCompilerDefaults,
} from "@refrain/soundpack/sfz";
import {
  containerWavAsset,
  directGitWavAsset,
  gitShow,
  sha256,
  writeCandidateShard,
} from "./lib/sound-build.js";

const VSCO_REF = "6dd651d55dde97fd4028699be9d4481f26917891";
const VSCO_REPOSITORY = "https://github.com/sgossner/VSCO-2-CE";
const VSCO_RAW_ROOT = `https://raw.githubusercontent.com/sgossner/VSCO-2-CE/${VSCO_REF}`;
const CELLO_REF = "6fd75fbfc1dbb3109bf26220ba1adea46188a18b";
const CELLO_REPOSITORY =
  "https://github.com/sfzinstruments/karoryfer-bigcat.cello";
const CELLO_RAW_ROOT = `https://raw.githubusercontent.com/sfzinstruments/karoryfer-bigcat.cello/${CELLO_REF}`;
const GUITAR_ARCHIVE_URL =
  "https://freepats.zenvoid.org/Guitar/SpanishClassicalGuitar/SpanishClassicalGuitar-SFZ-20190618.7z";
const GUITAR_ARCHIVE_SHA256 =
  "ef2fb7de0cc0ab561c4ebc28494f3fc2962596e4f32f16d6c96b8a385c7c098b";
const GUITAR_ARCHIVE_BYTES = 7_262_494;
const GUITAR_PACKAGE_ROOT = "SpanishClassicalGuitar-SFZ-20190618";
const FULL_ARTICULATION_FALLBACKS = {
  staccato: "none",
  tenuto: "none",
  accent: "none",
  legato: "none",
} as const;

interface BuiltCandidate {
  candidate: InstrumentCandidate;
  assets: SoundAssetDefinition[];
  evidence: Record<string, unknown>;
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`${name} is required.`);
  return resolve(value);
}

function assertCommit(repository: string, ref: string): void {
  const actual = execFileSync(
    "git",
    ["-C", repository, "rev-parse", `${ref}^{commit}`],
    { encoding: "utf8" },
  ).trim();
  if (actual !== ref) throw new Error(`Pinned source commit ${ref} is absent.`);
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await operation(items[index]!);
      }
    }),
  );
  return output;
}

async function fetchPinnedBytes(
  rawRoot: string,
  path: string,
): Promise<Buffer> {
  const url = `${rawRoot.replace(/\/$/, "")}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok)
    throw new Error(
      `Pinned source ${path} failed with HTTP ${response.status}.`,
    );
  return Buffer.from(await response.arrayBuffer());
}

function exactAssetsForRegions(
  regions: readonly SampleRegion[],
  assets: readonly SoundAssetDefinition[],
): SoundAssetDefinition[] {
  const ids = new Set(regions.map((region) => region.assetId));
  return assets.filter((asset) => ids.has(asset.id));
}

function assertFullCoverage(candidate: InstrumentCandidate): void {
  if (candidate.mapping.type !== "sample-map")
    throw new Error(`${candidate.id} is not a sample map.`);
  for (
    let midi = candidate.mapping.playableMin;
    midi <= candidate.mapping.playableMax;
    midi += 1
  ) {
    for (let velocity = 1; velocity <= 127; velocity += 1) {
      const matches = candidate.mapping.regions.filter(
        (region) =>
          region.trigger === "attack" &&
          region.articulation === "none" &&
          midi >= region.pitch.minMidi &&
          midi <= region.pitch.maxMidi &&
          velocity >= region.velocity.min &&
          velocity <= region.velocity.max,
      );
      if (!matches.length)
        throw new Error(
          `${candidate.id} has no region for MIDI ${midi} velocity ${velocity}.`,
        );
      const ordinary = matches.filter((region) => !region.roundRobin);
      const rr = matches.filter((region) => region.roundRobin);
      if (ordinary.length > 1 || (ordinary.length && rr.length))
        throw new Error(
          `${candidate.id} has ambiguous coverage at MIDI ${midi} velocity ${velocity}.`,
        );
      if (rr.length) {
        const count = rr[0]!.roundRobin!.count;
        const indexes = new Set(rr.map((region) => region.roundRobin!.index));
        if (rr.length !== count || indexes.size !== count)
          throw new Error(
            `${candidate.id} has incomplete RR coverage at MIDI ${midi} velocity ${velocity}.`,
          );
      }
    }
  }
}

function rangedCandidate(
  compiled: CompiledSfzCandidate,
  input: {
    candidateId: string;
    instrumentId: string;
    minMidi: number;
    maxMidi: number;
    extendEdges?: boolean;
  },
): BuiltCandidate {
  if (compiled.candidate.mapping.type !== "sample-map")
    throw new Error(`${compiled.candidate.id} is not a sample map.`);
  let regions = compiled.candidate.mapping.regions.flatMap((region) => {
    const minMidi = Math.max(region.pitch.minMidi, input.minMidi);
    const maxMidi = Math.min(region.pitch.maxMidi, input.maxMidi);
    if (
      minMidi > maxMidi ||
      region.pitch.rootMidi < minMidi ||
      region.pitch.rootMidi > maxMidi
    )
      return [];
    return [
      {
        ...region,
        pitch: { ...region.pitch, minMidi, maxMidi },
      },
    ];
  });
  if (!regions.length) throw new Error(`${input.candidateId} has no regions.`);
  const actualMin = Math.min(...regions.map((region) => region.pitch.minMidi));
  const actualMax = Math.max(...regions.map((region) => region.pitch.maxMidi));
  if (input.extendEdges) {
    if (actualMin > input.minMidi) {
      regions = regions.map((region) =>
        region.pitch.minMidi === actualMin
          ? {
              ...region,
              pitch: { ...region.pitch, minMidi: input.minMidi },
            }
          : region,
      );
    }
    if (actualMax < input.maxMidi) {
      regions = regions.map((region) =>
        region.pitch.maxMidi === actualMax
          ? {
              ...region,
              pitch: { ...region.pitch, maxMidi: input.maxMidi },
            }
          : region,
      );
    }
  }
  const renamed = regions.map((region, index) => ({
    ...region,
    id: `${input.candidateId}-region-${String(index + 1).padStart(3, "0")}`,
  }));
  const candidate: InstrumentCandidate = {
    ...compiled.candidate,
    id: input.candidateId,
    instrumentId: input.instrumentId,
    mapping: {
      ...compiled.candidate.mapping,
      playableMin: input.minMidi,
      playableMax: input.maxMidi,
      articulationFallbacks: FULL_ARTICULATION_FALLBACKS,
      regions: renamed,
    },
  };
  assertFullCoverage(candidate);
  return {
    candidate,
    assets: exactAssetsForRegions(renamed, compiled.assets),
    evidence: {
      sourceMap: compiled.sourceMap,
      compiledCoverage: compiled.coverage,
      releasedRangeProjection: {
        minMidi: input.minMidi,
        maxMidi: input.maxMidi,
        extendedLowerEdge: actualMin > input.minMidi,
        extendedUpperEdge: actualMax < input.maxMidi,
      },
    },
  };
}

async function compileVsco(
  repository: string,
  input: {
    sfzPath: string;
    candidateId: string;
    instrumentId: string;
    midiFallbackProgram: number;
    defaults?: SfzCompilerDefaults;
  },
): Promise<CompiledSfzCandidate> {
  const sfzText = gitShow(repository, VSCO_REF, input.sfzPath).toString("utf8");
  const assetLocks = collectSfzSamplePaths(sfzText, input.sfzPath).map(
    (path) => ({
      path,
      asset: directGitWavAsset({
        bytes: gitShow(repository, VSCO_REF, path),
        candidateId: input.candidateId,
        path,
        repository: VSCO_REPOSITORY,
        ref: VSCO_REF,
        rawUrlRoot: VSCO_RAW_ROOT,
        localNamespace: "vsco2-ce",
        license: {
          expression: "CC0-1.0",
          path: "third_party/VSCO-2-CE/LICENSE.txt",
          assetScope: "Individual WAV in the pinned VSCO 2 CE SFZ branch.",
        },
        releaseStatus: "listening-candidate",
        compiler: SFZ_COMPILER_CONTRACT,
        sfzPath: input.sfzPath,
      }),
    }),
  );
  return compileSfzCandidate({
    sfzText,
    sfzPath: input.sfzPath,
    candidateId: input.candidateId,
    instrumentId: input.instrumentId,
    midiFallbackProgram: input.midiFallbackProgram,
    calibrationGainDb: 0,
    releaseStatus: "listening-candidate",
    defaults: input.defaults,
    assetLocks,
  });
}

async function compileBigcat(
  repository: string,
  input: {
    sfzPath: string;
    candidateId: string;
    instrumentId: string;
    midiFallbackProgram: number;
    defaults: SfzCompilerDefaults;
  },
): Promise<CompiledSfzCandidate> {
  const sfzText = gitShow(repository, CELLO_REF, input.sfzPath).toString(
    "utf8",
  );
  const assetLocks = await mapConcurrent(
    collectSfzSamplePaths(sfzText, input.sfzPath),
    4,
    async (path) => ({
      path,
      asset: directGitWavAsset({
        bytes: await fetchPinnedBytes(CELLO_RAW_ROOT, path),
        candidateId: input.candidateId,
        path,
        repository: CELLO_REPOSITORY,
        ref: CELLO_REF,
        rawUrlRoot: CELLO_RAW_ROOT,
        localNamespace: "bigcat-cello",
        license: {
          expression: "CC0-1.0",
          path: "third_party/Karoryfer-Bigcat-Cello/LICENSE.txt",
          assetScope: "Individual WAV in the pinned Bigcat cello repository.",
        },
        releaseStatus: "listening-candidate",
        compiler: SFZ_COMPILER_CONTRACT,
        sfzPath: input.sfzPath,
      }),
    }),
  );
  return compileSfzCandidate({
    sfzText,
    sfzPath: input.sfzPath,
    candidateId: input.candidateId,
    instrumentId: input.instrumentId,
    midiFallbackProgram: input.midiFallbackProgram,
    calibrationGainDb: 0,
    releaseStatus: "listening-candidate",
    defaults: input.defaults,
    assetLocks,
  });
}

async function compileGuitar(
  extractedRoot: string,
  archivePath: string,
): Promise<CompiledSfzCandidate> {
  const actualArchive = await readFile(archivePath);
  if (
    actualArchive.length !== GUITAR_ARCHIVE_BYTES ||
    sha256(actualArchive) !== GUITAR_ARCHIVE_SHA256
  )
    throw new Error("FreePats guitar archive does not match its exact pin.");
  const sfzPath = "SpanishClassicalGuitar-20190618.sfz";
  const sfzText = await readFile(resolve(extractedRoot, sfzPath), "utf8");
  const candidateId = "nylon-guitar-freepats-spanish-classical";
  const assetLocks = await Promise.all(
    collectSfzSamplePaths(sfzText, sfzPath).map(async (path) => {
      const memberPath = `${GUITAR_PACKAGE_ROOT}/${path}`;
      return {
        path,
        asset: containerWavAsset({
          bytes: await readFile(resolve(extractedRoot, path)),
          candidateId,
          repository: "https://github.com/freepats/spanish-classical-guitar",
          archiveUrl: GUITAR_ARCHIVE_URL,
          archiveBytes: GUITAR_ARCHIVE_BYTES,
          archiveSha256: GUITAR_ARCHIVE_SHA256,
          memberPath,
          localNamespace: "freepats-spanish-classical-guitar",
          license: {
            expression: "CC0-1.0",
            path: "third_party/FreePats-Spanish-Classical-Guitar/LICENSE.txt",
            assetScope:
              "Individual WAV member in the exact FreePats 2019-06-18 SFZ WAV archive.",
          },
          releaseStatus: "listening-candidate",
          compiler: SFZ_COMPILER_CONTRACT,
          sfzPath: `${GUITAR_PACKAGE_ROOT}/${sfzPath}`,
        }),
      };
    }),
  );
  return compileSfzCandidate({
    sfzText,
    sfzPath,
    candidateId,
    instrumentId: "nylon_guitar",
    midiFallbackProgram: 24,
    calibrationGainDb: 0,
    releaseStatus: "listening-candidate",
    defaults: {
      ampegDynamic: 1,
      attackSeconds: 0.001,
      minVelocity: 1,
      maxVelocity: 127,
    },
    assetLocks,
  });
}

function mergedChamberStrings(
  sections: Array<{
    compiled: CompiledSfzCandidate;
    minMidi: number;
    maxMidi: number;
  }>,
): BuiltCandidate {
  const id = "chamber-strings-vsco-sections-full";
  const projected = sections.map((section) =>
    rangedCandidate(section.compiled, {
      candidateId: section.compiled.candidate.id,
      instrumentId: "chamber_strings",
      minMidi: section.minMidi,
      maxMidi: section.maxMidi,
      extendEdges: true,
    }),
  );
  const regions = projected
    .flatMap((item) =>
      item.candidate.mapping.type === "sample-map"
        ? item.candidate.mapping.regions
        : [],
    )
    .map((region, index) => ({
      ...region,
      id: `${id}-region-${String(index + 1).padStart(3, "0")}`,
    }));
  const assets = new Map<string, SoundAssetDefinition>();
  for (const item of projected)
    for (const asset of item.assets) assets.set(asset.id, asset);
  const candidate: InstrumentCandidate = {
    id,
    instrumentId: "chamber_strings",
    engine: "sampler",
    mapping: {
      type: "sample-map",
      playableMin: 36,
      playableMax: 96,
      midiFallbackProgram: 48,
      articulationFallbacks: FULL_ARTICULATION_FALLBACKS,
      regions,
    },
    calibrationGainDb: -3,
    tailSeconds: Math.max(
      ...projected.map((item) => item.candidate.tailSeconds ?? 1),
    ),
    releaseStatus: "listening-candidate",
  };
  assertFullCoverage(candidate);
  return {
    candidate,
    assets: [...assets.values()],
    evidence: {
      registerSections: sections.map((section, index) => ({
        sourceMap: section.compiled.sourceMap,
        minMidi: section.minMidi,
        maxMidi: section.maxMidi,
        compiledCoverage: section.compiled.coverage,
        projectedCandidateId: projected[index]!.candidate.id,
      })),
    },
  };
}

function fullClarinetFromPilot(): BuiltCandidate {
  const source = SOUND_REGISTRY.candidates.find(
    (candidate) => candidate.id === "clarinet-vsco-suslong-sfz-pilot",
  );
  if (!source || source.mapping.type !== "sample-map")
    throw new Error("The exact E clarinet pilot is unavailable.");
  const id = "clarinet-vsco-suslong-full";
  const max = source.mapping.playableMax;
  const regions = source.mapping.regions.map((region, index) => ({
    ...structuredClone(region),
    id: `${id}-region-${String(index + 1).padStart(3, "0")}`,
    pitch: {
      ...region.pitch,
      maxMidi: region.pitch.maxMidi === max ? 94 : region.pitch.maxMidi,
    },
  }));
  const candidate: InstrumentCandidate = {
    ...structuredClone(source),
    id,
    mapping: {
      ...structuredClone(source.mapping),
      playableMax: 94,
      articulationFallbacks: FULL_ARTICULATION_FALLBACKS,
      regions,
    },
  };
  assertFullCoverage(candidate);
  const assetIds = new Set(regions.map((region) => region.assetId));
  return {
    candidate,
    assets: SOUND_REGISTRY.assets.filter((asset) => assetIds.has(asset.id)),
    evidence: {
      sourceCandidate: source.id,
      sourceCandidateRange: {
        minMidi: source.mapping.playableMin,
        maxMidi: source.mapping.playableMax,
      },
      upperEdgeProjection: { fromMidi: max, toMidi: 94 },
    },
  };
}

function fullFluteFromPilot(): BuiltCandidate {
  const source = SOUND_REGISTRY.candidates.find(
    (candidate) => candidate.id === "flute-vsco-susnv-sfz-pilot",
  );
  if (!source || source.mapping.type !== "sample-map")
    throw new Error("The exact E flute pilot is unavailable.");
  const id = "flute-vsco-susnv-full";
  const regions = source.mapping.regions.map((region, index) => ({
    ...structuredClone(region),
    id: `${id}-region-${String(index + 1).padStart(3, "0")}`,
  }));
  const candidate: InstrumentCandidate = {
    ...structuredClone(source),
    id,
    mapping: {
      ...structuredClone(source.mapping),
      articulationFallbacks: FULL_ARTICULATION_FALLBACKS,
      regions,
    },
  };
  assertFullCoverage(candidate);
  const assetIds = new Set(regions.map((region) => region.assetId));
  return {
    candidate,
    assets: SOUND_REGISTRY.assets.filter((asset) => assetIds.has(asset.id)),
    evidence: {
      sourceCandidate: source.id,
      sourceCandidateRange: {
        minMidi: source.mapping.playableMin,
        maxMidi: source.mapping.playableMax,
      },
      explicitArticulationFallbacks: FULL_ARTICULATION_FALLBACKS,
    },
  };
}

function validateBuilt(item: BuiltCandidate): void {
  const core = {
    format: "refrain-soundpack@1-experimental" as const,
    id: `${item.candidate.id}-validation`,
    status: "development-candidates" as const,
    assets: item.assets,
    candidates: [item.candidate],
  };
  const manifest: SoundpackManifest = {
    ...core,
    contentSha256: soundObjectContentSha256(core),
  };
  const errors = validateSoundpackManifest(manifest);
  if (errors.length) throw new Error(errors.join("\n"));
}

const vscoRepo = argument("--vsco-repo");
const celloRepo = argument("--cello-repo");
const guitarRoot = argument("--guitar-root");
const guitarArchive = argument("--guitar-archive");
assertCommit(vscoRepo, VSCO_REF);
assertCommit(celloRepo, CELLO_REF);

const [
  pianoRaw,
  harpRaw,
  marimbaRaw,
  celloSection,
  violaSection,
  violinSection,
] = await Promise.all([
  compileVsco(vscoRepo, {
    sfzPath: "UprightPiano.sfz",
    candidateId: "warm-piano-vsco-upright-full",
    instrumentId: "warm_piano",
    midiFallbackProgram: 0,
  }),
  compileVsco(vscoRepo, {
    sfzPath: "Harp.sfz",
    candidateId: "harp-vsco-full",
    instrumentId: "harp",
    midiFallbackProgram: 46,
  }),
  compileVsco(vscoRepo, {
    sfzPath: "Marimba.sfz",
    candidateId: "marimba-vsco-full",
    instrumentId: "marimba",
    midiFallbackProgram: 12,
  }),
  compileVsco(vscoRepo, {
    sfzPath: "CelloEnsSusVib.sfz",
    candidateId: "chamber-strings-vsco-sections-full-cello",
    instrumentId: "chamber_strings",
    midiFallbackProgram: 48,
  }),
  compileVsco(vscoRepo, {
    sfzPath: "ViolaEnsSusVib.sfz",
    candidateId: "chamber-strings-vsco-sections-full-viola",
    instrumentId: "chamber_strings",
    midiFallbackProgram: 48,
    defaults: { gainOffsetDb: -4 },
  }),
  compileVsco(vscoRepo, {
    sfzPath: "ViolinEnsSusVib.sfz",
    candidateId: "chamber-strings-vsco-sections-full-violin",
    instrumentId: "chamber_strings",
    midiFallbackProgram: 48,
  }),
]);
const [guitarRaw, soloCelloRaw] = await Promise.all([
  compileGuitar(guitarRoot, guitarArchive),
  compileBigcat(celloRepo, {
    sfzPath: "Programs/vc_arco_sus_map.sfz",
    candidateId: "solo-cello-bigcat-bowed-full",
    instrumentId: "solo_cello",
    midiFallbackProgram: 42,
    defaults: {
      ampegDynamic: 1,
      attackSeconds: 0.01,
      releaseSeconds: 0.8,
      gainDb: 0,
      minVelocity: 1,
      maxVelocity: 127,
      cc107: 0,
    },
  }),
]);

const built: BuiltCandidate[] = [
  rangedCandidate(pianoRaw, {
    candidateId: "warm-piano-vsco-upright-full",
    instrumentId: "warm_piano",
    minMidi: 21,
    maxMidi: 108,
    extendEdges: true,
  }),
  rangedCandidate(harpRaw, {
    candidateId: "harp-vsco-full",
    instrumentId: "harp",
    minMidi: 24,
    maxMidi: 103,
    extendEdges: true,
  }),
  rangedCandidate(marimbaRaw, {
    candidateId: "marimba-vsco-full",
    instrumentId: "marimba",
    minMidi: 45,
    maxMidi: 96,
    extendEdges: true,
  }),
  rangedCandidate(guitarRaw, {
    candidateId: "nylon-guitar-freepats-spanish-classical",
    instrumentId: "nylon_guitar",
    minMidi: 40,
    maxMidi: 88,
    extendEdges: true,
  }),
  rangedCandidate(soloCelloRaw, {
    candidateId: "solo-cello-bigcat-bowed-full",
    instrumentId: "solo_cello",
    minMidi: 36,
    maxMidi: 76,
    extendEdges: true,
  }),
  mergedChamberStrings([
    { compiled: celloSection, minMidi: 36, maxMidi: 55 },
    { compiled: violaSection, minMidi: 56, maxMidi: 67 },
    { compiled: violinSection, minMidi: 68, maxMidi: 96 },
  ]),
  fullFluteFromPilot(),
  fullClarinetFromPilot(),
];

const records = [];
for (const item of built) {
  validateBuilt(item);
  const shard = await writeCandidateShard(item.candidate, item.assets);
  records.push({
    ...shard,
    instrumentId: item.candidate.instrumentId,
    playableRange:
      item.candidate.mapping.type === "sample-map"
        ? {
            minMidi: item.candidate.mapping.playableMin,
            maxMidi: item.candidate.mapping.playableMax,
          }
        : undefined,
    regionCount:
      item.candidate.mapping.type === "sample-map"
        ? item.candidate.mapping.regions.length
        : 0,
    assetCount: item.assets.length,
    bytes: item.assets.reduce((sum, asset) => sum + asset.bytes, 0),
    evidence: item.evidence,
  });
}
const evidence = {
  format: "refrain-f-sample-candidate-evidence@0-experimental",
  sources: {
    vsco: { repository: VSCO_REPOSITORY, ref: VSCO_REF },
    bigcatCello: { repository: CELLO_REPOSITORY, ref: CELLO_REF },
    freepatsGuitar: {
      repository: "https://github.com/freepats/spanish-classical-guitar",
      archiveUrl: GUITAR_ARCHIVE_URL,
      archiveSha256: GUITAR_ARCHIVE_SHA256,
      archiveBytes: GUITAR_ARCHIVE_BYTES,
    },
  },
  candidates: records,
};
await writeFile(
  resolve("packages/soundpack/src/generated/f-sample-candidates.json"),
  await formatText(JSON.stringify(evidence), { parser: "json" }),
  "utf8",
);
process.stdout.write(`Built ${records.length} F sample candidate shards.\n`);
