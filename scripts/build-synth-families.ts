import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256Hex } from "@refrain/identity";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => key !== "contentSha256")
      .sort()
      .map((key) => [key, canonicalValue(record[key])]),
  );
}

function digest(value: unknown): string {
  return sha256Hex(JSON.stringify(canonicalValue(value)));
}

const candidates = [
  {
    id: "air-pad-subtractive-original",
    instrumentId: "air_pad",
    engine: "synth",
    mapping: { type: "midi-fallback", program: 89 },
    calibrationGainDb: -18,
    releaseStatus: "development-identity",
    patch: {
      format: "refrain-synth-subtractive@0-experimental",
      oscillators: [
        { type: "sine", ratio: 1, gain: 0.72 },
        { type: "triangle", ratio: 2, gain: 0.18, detune: 3 },
      ],
      attack: 0.8,
      decay: 0.7,
      sustain: 0.62,
      release: 1.4,
      filterHz: 1800,
      filterQ: 0.7,
    },
  },
  {
    id: "glass-bell-modal-original",
    instrumentId: "glass_bell",
    engine: "synth",
    mapping: { type: "midi-fallback", program: 98 },
    calibrationGainDb: -14,
    releaseStatus: "development-identity",
    patch: {
      format: "refrain-synth-modal@0-experimental",
      modes: [
        { ratio: 1, gain: 0.72, decaySeconds: 2.4 },
        { ratio: 2.01, gain: 0.2, decaySeconds: 1.5 },
        { ratio: 3.99, gain: 0.08, decaySeconds: 0.9 },
      ],
      attack: 0.004,
      release: 1.6,
    },
  },
  {
    id: "clean-bass-subtractive-original",
    instrumentId: "clean_bass",
    engine: "synth",
    mapping: { type: "midi-fallback", program: 33 },
    calibrationGainDb: -14,
    releaseStatus: "development-identity",
    patch: {
      format: "refrain-synth-subtractive@0-experimental",
      oscillators: [
        { type: "sine", ratio: 1, gain: 0.86 },
        { type: "triangle", ratio: 2, gain: 0.12, detune: -2 },
      ],
      attack: 0.008,
      decay: 0.32,
      sustain: 0.7,
      release: 0.28,
      filterHz: 720,
      filterQ: 0.8,
    },
  },
  {
    id: "sub-bass-subtractive-original",
    instrumentId: "sub_bass",
    engine: "synth",
    mapping: { type: "midi-fallback", program: 38 },
    calibrationGainDb: -17,
    releaseStatus: "development-identity",
    patch: {
      format: "refrain-synth-subtractive@0-experimental",
      oscillators: [
        { type: "sine", ratio: 1, gain: 0.92 },
        { type: "square", ratio: 0.5, gain: 0.06 },
      ],
      attack: 0.035,
      decay: 0.45,
      sustain: 0.78,
      release: 0.65,
      filterHz: 430,
      filterQ: 0.65,
    },
  },
  {
    id: "lattice-pluck-subtractive-original",
    instrumentId: "lattice_pluck",
    engine: "synth",
    mapping: { type: "midi-fallback", program: 84 },
    calibrationGainDb: -16,
    releaseStatus: "development-identity",
    patch: {
      format: "refrain-synth-subtractive@0-experimental",
      oscillators: [
        { type: "triangle", ratio: 1, gain: 0.62 },
        { type: "square", ratio: 2, gain: 0.19, detune: 4 },
        { type: "sine", ratio: 3, gain: 0.08, detune: -3 },
      ],
      attack: 0.003,
      decay: 0.19,
      sustain: 0.08,
      release: 0.34,
      filterHz: 4200,
      filterQ: 1.1,
    },
  },
  {
    id: "prism-lead-subtractive-original",
    instrumentId: "prism_lead",
    engine: "synth",
    mapping: { type: "midi-fallback", program: 81 },
    calibrationGainDb: -18,
    releaseStatus: "development-identity",
    patch: {
      format: "refrain-synth-subtractive@0-experimental",
      oscillators: [
        { type: "sawtooth", ratio: 1, gain: 0.42 },
        { type: "triangle", ratio: 1, gain: 0.34, detune: 7 },
        { type: "sine", ratio: 2, gain: 0.12, detune: -5 },
      ],
      attack: 0.025,
      decay: 0.28,
      sustain: 0.54,
      release: 0.46,
      filterHz: 3400,
      filterQ: 1.35,
    },
  },
  {
    id: "dust-texture-subtractive-original",
    instrumentId: "dust_texture",
    engine: "synth",
    mapping: { type: "midi-fallback", program: 96 },
    calibrationGainDb: -22,
    releaseStatus: "development-identity",
    patch: {
      format: "refrain-synth-subtractive@0-experimental",
      oscillators: [
        { type: "triangle", ratio: 1, gain: 0.38, detune: -11 },
        { type: "square", ratio: 1.5, gain: 0.12, detune: 13 },
        { type: "sine", ratio: 4.03, gain: 0.08, detune: -7 },
      ],
      attack: 0.42,
      decay: 0.85,
      sustain: 0.46,
      release: 1.8,
      filterHz: 1350,
      filterQ: 1.8,
    },
  },
  {
    id: "rhythm-pulse-modal-original",
    instrumentId: "rhythm_pulse",
    engine: "synth",
    mapping: { type: "midi-fallback", program: 118 },
    calibrationGainDb: -15,
    releaseStatus: "development-identity",
    patch: {
      format: "refrain-synth-modal@0-experimental",
      modes: [
        { ratio: 1, gain: 0.8, decaySeconds: 0.24 },
        { ratio: 1.51, gain: 0.16, decaySeconds: 0.11, detune: -6 },
        { ratio: 3.97, gain: 0.05, decaySeconds: 0.07, detune: 8 },
      ],
      attack: 0.002,
      release: 0.18,
    },
  },
] as const;

const profilePath = resolve("packages/soundpack/src/sound-profiles.json");
const vocabularyPath = resolve(
  "packages/soundpack/src/instrument-vocabulary.json",
);
const shardRoot = resolve("packages/soundpack/src/candidates/sha256");
const pins = new Map<string, { id: string; sha256: string }>();
const evidence = [];
for (const candidate of candidates) {
  const candidateContentSha256 = digest({ candidate, assets: [] });
  const shardCore = {
    format: "refrain-candidate-shard@0-experimental",
    id: candidate.id,
    candidateContentSha256,
    candidate,
    assets: [],
  };
  const shard = { ...shardCore, contentSha256: digest(shardCore) };
  await writeFile(
    resolve(shardRoot, `${shard.contentSha256}.json`),
    `${JSON.stringify(shard, null, 2)}\n`,
    "utf8",
  );
  pins.set(candidate.instrumentId, {
    id: candidate.id,
    sha256: candidateContentSha256,
  });
  evidence.push({
    candidateId: candidate.id,
    candidateContentSha256,
    shardSha256: shard.contentSha256,
    patchFormat: candidate.patch.format,
    patchSha256: digest(candidate.patch),
  });
}
const vocabulary = JSON.parse(await readFile(vocabularyPath, "utf8"));
const vocabularyCore = { ...vocabulary };
delete vocabularyCore.contentSha256;
vocabulary.contentSha256 = digest(vocabularyCore);
await writeFile(
  vocabularyPath,
  `${JSON.stringify(vocabulary, null, 2)}\n`,
  "utf8",
);
const profileSet = JSON.parse(await readFile(profilePath, "utf8"));
profileSet.profiles = profileSet.profiles.map(
  (profile: { selections: Record<string, unknown>; contentSha256: string }) => {
    const core = {
      ...profile,
      vocabulary: {
        id: vocabulary.id,
        sha256: vocabulary.contentSha256,
      },
      selections: {
        ...profile.selections,
        clean_bass: {
          candidateChain: [pins.get("clean_bass")],
          fallbackPolicy: "strict",
        },
        air_pad: {
          candidateChain: [pins.get("air_pad")],
          fallbackPolicy: "strict",
        },
        glass_bell: {
          candidateChain: [pins.get("glass_bell")],
          fallbackPolicy: "strict",
        },
        sub_bass: {
          candidateChain: [pins.get("sub_bass")],
          fallbackPolicy: "strict",
        },
        lattice_pluck: {
          candidateChain: [pins.get("lattice_pluck")],
          fallbackPolicy: "strict",
        },
        prism_lead: {
          candidateChain: [pins.get("prism_lead")],
          fallbackPolicy: "strict",
        },
        dust_texture: {
          candidateChain: [pins.get("dust_texture")],
          fallbackPolicy: "strict",
        },
        rhythm_pulse: {
          candidateChain: [pins.get("rhythm_pulse")],
          fallbackPolicy: "strict",
        },
      },
    };
    delete core.contentSha256;
    return { ...core, contentSha256: digest(core) };
  },
);
await writeFile(
  profilePath,
  `${JSON.stringify(profileSet, null, 2)}\n`,
  "utf8",
);
await writeFile(
  resolve("packages/soundpack/src/generated/synth-families.json"),
  `${JSON.stringify(
    {
      format: "refrain-synth-family-evidence@0-experimental",
      candidates: evidence,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
process.stdout.write(
  `Built ${candidates.length} versioned synth-family shards.\n`,
);
