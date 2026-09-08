import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256Hex } from "@refrain/identity";

interface CatalogEntry {
  candidateId: string;
  instrumentId: string;
  candidateContentSha256: string;
}

interface SelectionSpec {
  candidateId: string;
  profileGainDb?: number;
}

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

const profilePath = resolve("packages/soundpack/src/sound-profiles.json");
const catalogPath = resolve("packages/soundpack/src/sound-catalog.json");
const vocabularyPath = resolve(
  "packages/soundpack/src/instrument-vocabulary.json",
);
const [profileSet, catalog, vocabulary] = await Promise.all(
  [profilePath, catalogPath, vocabularyPath].map(async (path) =>
    JSON.parse(await readFile(path, "utf8")),
  ),
);
const entries = new Map<string, CatalogEntry>(
  catalog.candidates.map((entry: CatalogEntry) => [entry.candidateId, entry]),
);
const base: Record<string, SelectionSpec> = {
  warm_piano: { candidateId: "warm-piano-vsco-upright-full" },
  nylon_guitar: {
    candidateId: "nylon-guitar-freepats-spanish-classical",
  },
  harp: { candidateId: "harp-vsco-full" },
  clean_bass: { candidateId: "clean-bass-subtractive-original" },
  chamber_strings: { candidateId: "chamber-strings-vsco-sections-full" },
  solo_cello: { candidateId: "solo-cello-bigcat-bowed-full" },
  flute: { candidateId: "flute-vsco-susnv-full" },
  clarinet: { candidateId: "clarinet-vsco-suslong-full" },
  marimba: { candidateId: "marimba-vsco-full" },
  soft_percussion: { candidateId: "soft-percussion-vcsl-acoustic-kit" },
  air_pad: { candidateId: "air-pad-subtractive-original" },
  glass_bell: { candidateId: "glass-bell-modal-original" },
  sub_bass: { candidateId: "sub-bass-subtractive-original" },
  lattice_pluck: { candidateId: "lattice-pluck-subtractive-original" },
  prism_lead: { candidateId: "prism-lead-subtractive-original" },
  dust_texture: { candidateId: "dust-texture-subtractive-original" },
  rhythm_pulse: { candidateId: "rhythm-pulse-modal-original" },
};

function createProfile(id: string, gains: Readonly<Record<string, number>>) {
  const active = vocabulary.instruments
    .filter((instrument: { status: string }) => instrument.status === "active")
    .map((instrument: { id: string }) => instrument.id)
    .sort();
  if (active.join("|") !== Object.keys(base).sort().join("|"))
    throw new Error(`${id} does not cover the exact active vocabulary.`);
  const selections = Object.fromEntries(
    Object.entries(base).map(([instrumentId, spec]) => {
      const entry = entries.get(spec.candidateId);
      if (!entry || entry.instrumentId !== instrumentId)
        throw new Error(
          `${id} cannot resolve ${instrumentId} to ${spec.candidateId}.`,
        );
      return [
        instrumentId,
        {
          candidateChain: [
            {
              id: entry.candidateId,
              sha256: entry.candidateContentSha256,
            },
          ],
          fallbackPolicy: "strict",
          ...(gains[instrumentId] === undefined
            ? {}
            : { profileGainDb: gains[instrumentId] }),
        },
      ];
    }),
  );
  const core = {
    format: "refrain-sound-profile@1-experimental",
    id,
    vocabulary: {
      id: vocabulary.id,
      sha256: vocabulary.contentSha256,
    },
    selections,
  };
  return { ...core, contentSha256: digest(core) };
}

const profiles = [
  createProfile("f-acoustic-chamber@1", {
    air_pad: -4,
    glass_bell: -3,
    sub_bass: -4,
    lattice_pluck: -3,
    prism_lead: -5,
    dust_texture: -6,
    rhythm_pulse: -5,
  }),
  createProfile("f-luminous-hybrid@1", {
    chamber_strings: -1,
    air_pad: 1,
    glass_bell: 1,
    lattice_pluck: 1,
    prism_lead: -1,
    dust_texture: -3,
  }),
  createProfile("f-lofi-degraded@1", {
    warm_piano: -2,
    nylon_guitar: -1,
    harp: -4,
    chamber_strings: -3,
    flute: -3,
    clarinet: -2,
    air_pad: -2,
    glass_bell: -4,
    dust_texture: 2,
    rhythm_pulse: -1,
  }),
  createProfile("f-synthetic-beat@1", {
    warm_piano: -5,
    nylon_guitar: -5,
    harp: -5,
    chamber_strings: -5,
    solo_cello: -5,
    flute: -5,
    clarinet: -5,
    marimba: -3,
    sub_bass: 1,
    lattice_pluck: 1,
    prism_lead: 1,
    dust_texture: -2,
    rhythm_pulse: 2,
  }),
];
const ids = new Set(profiles.map((profile) => profile.id));
profileSet.profiles = [
  ...profileSet.profiles.filter(
    (profile: { id: string }) => !ids.has(profile.id),
  ),
  ...profiles,
];
await writeFile(
  profilePath,
  `${JSON.stringify(profileSet, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`Built ${profiles.length} F palette profiles.\n`);
