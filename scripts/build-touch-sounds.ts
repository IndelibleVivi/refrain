import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  candidateContentSha256,
  soundObjectContentSha256,
  validateSynthPatch,
  type InstrumentCandidate,
  type SoundpackManifest,
} from "@refrain/soundpack";

// Original instruments, built from declared partials rather than audio assets.
// Keep the earlier candidates immutable; Touch is an explicit new embodiment.
const candidates: InstrumentCandidate[] = [
  {
    id: "lattice-pluck-touch-original",
    instrumentId: "lattice_pluck",
    engine: "synth",
    mapping: { type: "midi-fallback", program: 84 },
    calibrationGainDb: -12,
    releaseStatus: "development-identity",
    patch: {
      format: "refrain-synth-modal@1-experimental",
      velocityExponent: 1.35,
      attack: 0.004,
      release: 1.45,
      modes: [
        { ratio: 1, gain: { soft: 0.82, hard: 0.56 }, decaySeconds: 1.9 },
        {
          ratio: 2,
          gain: { soft: 0.1, hard: 0.24 },
          decaySeconds: 0.72,
          detune: 1.4,
        },
        {
          ratio: 3,
          gain: { soft: 0.015, hard: 0.12 },
          decaySeconds: 0.38,
          detune: -1.8,
        },
        { ratio: 4.01, gain: { soft: 0.004, hard: 0.065 }, decaySeconds: 0.21 },
        { ratio: 6.02, gain: { soft: 0, hard: 0.025 }, decaySeconds: 0.09 },
      ],
    },
  },
  {
    id: "glass-bell-touch-original",
    instrumentId: "glass_bell",
    engine: "synth",
    mapping: { type: "midi-fallback", program: 98 },
    calibrationGainDb: -13,
    releaseStatus: "development-identity",
    patch: {
      format: "refrain-synth-modal@1-experimental",
      velocityExponent: 1.55,
      attack: 0.006,
      release: 2.7,
      modes: [
        { ratio: 1, gain: { soft: 0.78, hard: 0.5 }, decaySeconds: 3.1 },
        { ratio: 2.003, gain: { soft: 0.075, hard: 0.22 }, decaySeconds: 2.2 },
        { ratio: 2.756, gain: { soft: 0.009, hard: 0.13 }, decaySeconds: 0.9 },
        {
          ratio: 4.012,
          gain: { soft: 0.004, hard: 0.075 },
          decaySeconds: 0.65,
        },
        { ratio: 5.432, gain: { soft: 0, hard: 0.025 }, decaySeconds: 0.24 },
      ],
    },
  },
  {
    id: "prism-lead-touch-original",
    instrumentId: "prism_lead",
    engine: "synth",
    mapping: { type: "midi-fallback", program: 81 },
    calibrationGainDb: -14,
    releaseStatus: "development-identity",
    patch: {
      format: "refrain-synth-subtractive@1-experimental",
      velocityExponent: 1.15,
      attack: 0.018,
      decay: 0.32,
      sustain: 0.46,
      release: 0.72,
      filterHz: { soft: 600, hard: 6200 },
      filterQ: 0.72,
      oscillators: [
        { type: "triangle", ratio: 1, gain: { soft: 0.64, hard: 0.46 } },
        {
          type: "sawtooth",
          ratio: 1,
          gain: { soft: 0.025, hard: 0.22 },
          detune: 3.2,
        },
        {
          type: "sine",
          ratio: 2,
          gain: { soft: 0.12, hard: 0.18 },
          detune: -2,
        },
      ],
    },
  },
  {
    id: "air-pad-touch-original",
    instrumentId: "air_pad",
    engine: "synth",
    mapping: { type: "midi-fallback", program: 89 },
    calibrationGainDb: -20,
    releaseStatus: "development-identity",
    patch: {
      format: "refrain-synth-subtractive@1-experimental",
      velocityExponent: 1.2,
      attack: 0.42,
      decay: 1.1,
      sustain: 0.62,
      release: 2.8,
      filterHz: { soft: 480, hard: 2800 },
      filterQ: 0.6,
      oscillators: [
        { type: "sine", ratio: 1, gain: { soft: 0.72, hard: 0.55 } },
        {
          type: "triangle",
          ratio: 1,
          gain: { soft: 0.13, hard: 0.26 },
          detune: -4,
        },
        {
          type: "sine",
          ratio: 2,
          gain: { soft: 0.035, hard: 0.12 },
          detune: 4,
        },
      ],
    },
  },
];

const root = resolve("packages/soundpack/src");
const evidence = [];
const pins = new Map<string, { id: string; sha256: string }>();
for (const candidate of candidates) {
  const errors = validateSynthPatch(candidate.patch);
  if (errors.length) throw new Error(`${candidate.id}: ${errors.join("; ")}`);
  const manifest = { assets: [] } as unknown as SoundpackManifest;
  const candidateDigest = candidateContentSha256(candidate, manifest);
  const core = {
    format: "refrain-candidate-shard@0-experimental",
    id: candidate.id,
    candidateContentSha256: candidateDigest,
    candidate,
    assets: [],
  };
  const shard = { ...core, contentSha256: soundObjectContentSha256(core) };
  await writeFile(
    resolve(root, "candidates/sha256", `${shard.contentSha256}.json`),
    `${JSON.stringify(shard, null, 2)}\n`,
  );
  pins.set(candidate.instrumentId, {
    id: candidate.id,
    sha256: candidateDigest,
  });
  evidence.push({
    candidateId: candidate.id,
    candidateContentSha256: candidateDigest,
    shardSha256: shard.contentSha256,
    patchFormat: candidate.patch!.format,
  });
}
const profilePath = resolve(root, "sound-profiles.json");
const profiles = JSON.parse(await readFile(profilePath, "utf8"));
const base = profiles.profiles.find(
  (profile: { id: string }) => profile.id === "f-synthetic-beat@1",
);
if (!base)
  throw new Error(
    "Touch needs the exact existing synthetic profile as its unchanged remainder.",
  );
const { contentSha256: _digest, ...core } = structuredClone(base);
core.id = "touch@1";
for (const [id, pin] of pins)
  core.selections[id] = { candidateChain: [pin], fallbackPolicy: "strict" };
const profile = { ...core, contentSha256: soundObjectContentSha256(core) };
profiles.profiles = [
  ...profiles.profiles.filter((p: { id: string }) => p.id !== profile.id),
  profile,
];
await writeFile(profilePath, `${JSON.stringify(profiles, null, 2)}\n`);
await writeFile(
  resolve(root, "generated/touch-sounds.json"),
  `${JSON.stringify({ format: "refrain-synth-family-evidence@0-experimental", candidates: evidence }, null, 2)}\n`,
);
process.stdout.write(
  `Built ${candidates.length} Touch candidates; run soundpack:catalog next.\n`,
);
