import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { format as formatText } from "prettier";
import { soundObjectContentSha256 } from "@refrain/soundpack";
import {
  collectSfzSamplePaths,
  compileSfzCandidate,
  type SfzAssetLock,
} from "@refrain/soundpack/sfz";
import {
  directGitWavAsset,
  gitShow,
  writeCandidateShard,
} from "./lib/sound-build.js";

const REF = "6dd651d55dde97fd4028699be9d4481f26917891";
const REPOSITORY = "https://github.com/sgossner/VSCO-2-CE";
const RAW_ROOT = `https://raw.githubusercontent.com/sgossner/VSCO-2-CE/${REF}`;
const LICENSE = {
  expression: "CC0-1.0",
  path: "third_party/VSCO-2-CE/LICENSE.txt",
  assetScope: "Individual WAV in the pinned VSCO 2 CE SFZ branch.",
};

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function buildPilot(
  sourceRepo: string,
  spec: {
    sfzPath: string;
    candidateId: string;
    instrumentId: "flute" | "clarinet";
    midiFallbackProgram: number;
  },
) {
  const sfzText = gitShow(sourceRepo, REF, spec.sfzPath).toString("utf8");
  const locks: SfzAssetLock[] = collectSfzSamplePaths(sfzText).map((path) => {
    const bytes = gitShow(sourceRepo, REF, path);
    return {
      path,
      asset: directGitWavAsset({
        bytes,
        candidateId: spec.candidateId,
        path,
        repository: REPOSITORY,
        ref: REF,
        rawUrlRoot: RAW_ROOT,
        localNamespace: "vsco2-ce",
        license: LICENSE,
        releaseStatus: "listening-candidate",
        compiler: "refrain-sfz-compiler@0-experimental",
        sfzPath: spec.sfzPath,
      }),
    };
  });
  const compiled = compileSfzCandidate({
    sfzText,
    sfzPath: spec.sfzPath,
    candidateId: spec.candidateId,
    instrumentId: spec.instrumentId,
    midiFallbackProgram: spec.midiFallbackProgram,
    calibrationGainDb: 0,
    releaseStatus: "listening-candidate",
    assetLocks: locks.map(({ path, asset }) => ({
      path,
      id: asset.id,
      bytes: asset.bytes,
      sha256: asset.sha256,
      audio: asset.audio,
    })),
  });
  const shard = await writeCandidateShard(compiled.candidate, compiled.assets);
  return {
    candidateId: spec.candidateId,
    candidateContentSha256: shard.candidateContentSha256,
    shardSha256: shard.shardSha256,
    sourceMap: compiled.sourceMap,
    coverage: compiled.coverage,
    assetLocks: locks,
  };
}

const sourceRepo = resolve(argument("--source-repo"));
const actualRef = execFileSync(
  "git",
  ["-C", sourceRepo, "rev-parse", `${REF}^{commit}`],
  { encoding: "utf8" },
).trim();
if (actualRef !== REF)
  throw new Error(`Pinned SFZ commit ${REF} is unavailable.`);

const pilots = [];
for (const spec of [
  {
    sfzPath: "FluteSusNV.sfz",
    candidateId: "flute-vsco-susnv-sfz-pilot",
    instrumentId: "flute" as const,
    midiFallbackProgram: 73,
  },
  {
    sfzPath: "ClarinetSus.sfz",
    candidateId: "clarinet-vsco-suslong-sfz-pilot",
    instrumentId: "clarinet" as const,
    midiFallbackProgram: 71,
  },
]) {
  pilots.push(await buildPilot(sourceRepo, spec));
}
const evidence = {
  format: "refrain-sfz-pilot-evidence@0-experimental",
  source: { repository: REPOSITORY, ref: REF },
  pilots,
};
const evidenceRoot = resolve("packages/soundpack/src/generated");
await mkdir(evidenceRoot, { recursive: true });
await writeFile(
  resolve(evidenceRoot, "vsco-wind-pilots.json"),
  await formatText(JSON.stringify(evidence), { parser: "json" }),
  "utf8",
);
const profilePath = resolve("packages/soundpack/src/sound-profiles.json");
const profileSet = JSON.parse(await readFile(profilePath, "utf8"));
const baseProfile = profileSet.profiles.find(
  (profile: { id: string }) => profile.id === "g3b-vcsl-listening@1",
);
if (!baseProfile) throw new Error("The G3B profile is unavailable.");
const pilotById = new Map(pilots.map((pilot) => [pilot.candidateId, pilot]));
const profileCore = {
  format: "refrain-sound-profile@1-experimental",
  id: "e-vsco-wind-pilots@1",
  vocabulary: baseProfile.vocabulary,
  selections: {
    ...baseProfile.selections,
    flute: {
      candidateChain: [
        {
          id: "flute-vsco-susnv-sfz-pilot",
          sha256: pilotById.get("flute-vsco-susnv-sfz-pilot")!
            .candidateContentSha256,
        },
        ...baseProfile.selections.flute.candidateChain,
      ],
      fallbackPolicy: "whole-identity-audition",
    },
    clarinet: {
      candidateChain: [
        {
          id: "clarinet-vsco-suslong-sfz-pilot",
          sha256: pilotById.get("clarinet-vsco-suslong-sfz-pilot")!
            .candidateContentSha256,
        },
        ...baseProfile.selections.clarinet.candidateChain,
      ],
      fallbackPolicy: "whole-identity-audition",
    },
  },
};
const pilotProfile = {
  ...profileCore,
  contentSha256: soundObjectContentSha256(profileCore),
};
profileSet.profiles = [
  ...profileSet.profiles.filter(
    (profile: { id: string }) => profile.id !== pilotProfile.id,
  ),
  pilotProfile,
];
await writeFile(
  profilePath,
  `${JSON.stringify(profileSet, null, 2)}\n`,
  "utf8",
);
process.stdout.write(
  `Built ${pilots.length} VSCO wind pilot shards from ${REF}.\n`,
);
