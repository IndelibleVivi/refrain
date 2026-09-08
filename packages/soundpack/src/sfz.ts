import {
  sha256Hex,
  soundObjectContentSha256,
  validateSoundpackManifest,
  type InstrumentCandidate,
  type SoundAssetDefinition,
  type SoundpackManifest,
} from "./index.js";

export const SFZ_COMPILER_CONTRACT =
  "refrain-sfz-compiler@0-experimental" as const;

const ALLOWED_OPCODES = new Set([
  "ampeg_attack",
  "ampeg_dynamic",
  "ampeg_release",
  "default_path",
  "group_label",
  "hicc107",
  "hikey",
  "hivel",
  "key",
  "lokey",
  "lovel",
  "pitch_keycenter",
  "sample",
  "seq_length",
  "seq_position",
  "loop_mode",
  "volume",
]);
const SHA256 = /^[0-9a-f]{64}$/;

type SfzScope = "control" | "global" | "group" | "region";
type OpcodeMap = Record<string, { value: string; line: number }>;

interface ParsedRegion {
  line: number;
  values: OpcodeMap;
}

interface ParsedSfz {
  control: OpcodeMap;
  global: OpcodeMap;
  regions: Array<{
    line: number;
    values: OpcodeMap;
    group: OpcodeMap;
  }>;
}

export interface SfzAssetLock {
  path: string;
  asset: SoundAssetDefinition;
}

export interface SfzCompilerDefaults {
  ampegDynamic?: 1;
  attackSeconds?: number;
  releaseSeconds?: number;
  gainDb?: number;
  gainOffsetDb?: number;
  minVelocity?: number;
  maxVelocity?: number;
  cc107?: number;
}

export interface CompileSfzCandidateInput {
  sfzText: string;
  sfzPath: string;
  candidateId: string;
  instrumentId: string;
  midiFallbackProgram: number;
  calibrationGainDb: number;
  releaseStatus: "listening-candidate" | "release-candidate";
  defaults?: SfzCompilerDefaults;
  assetLocks: readonly SfzAssetLock[];
}

export interface SfzSourceMap {
  format: "refrain-sfz-source-map@0-experimental";
  compiler: typeof SFZ_COMPILER_CONTRACT;
  source: { path: string; sha256: string };
  normalization: SfzCompilerDefaults;
  regions: Array<{
    regionId: string;
    sourceLine: number;
    samplePath: string;
    assetId: string;
    inheritedOpcodes: Record<string, string>;
  }>;
}

export interface SfzCoverage {
  playableMin: number;
  playableMax: number;
  regionCount: number;
  assetCount: number;
  velocityBreaks: number[];
}

export interface CompiledSfzCandidate {
  candidate: InstrumentCandidate;
  assets: SoundAssetDefinition[];
  sourceMap: SfzSourceMap;
  coverage: SfzCoverage;
}

function normalizeRelativePath(path: string): string {
  const normalized = path
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split("/").some((part) => part === ".." || part === "")
  )
    throw new Error(`SFZ path must be a normalized relative path: ${path}`);
  return normalized;
}

function resolveRelativePath(...parts: string[]): string {
  const stack: string[] = [];
  for (const raw of parts) {
    const normalized = raw.replaceAll("\\", "/");
    if (normalized.startsWith("/") || /^[a-z]:\//i.test(normalized))
      throw new Error(`SFZ path must remain relative: ${raw}`);
    for (const part of normalized.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!stack.length)
          throw new Error(`SFZ path escapes its source root: ${raw}`);
        stack.pop();
      } else stack.push(part);
    }
  }
  return normalizeRelativePath(stack.join("/"));
}

function sfzDirectory(sfzPath: string): string {
  const normalized = normalizeRelativePath(sfzPath);
  const separator = normalized.lastIndexOf("/");
  return separator < 0 ? "." : normalized.slice(0, separator);
}

function assignOpcode(
  target: OpcodeMap,
  opcode: string,
  value: string,
  line: number,
) {
  if (
    !ALLOWED_OPCODES.has(opcode) &&
    !/^amp_velcurve_(?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-7])$/.test(opcode)
  )
    throw new Error(
      `Unsupported sound-affecting SFZ opcode ${opcode} at line ${line}.`,
    );
  if (target[opcode])
    throw new Error(`Duplicate SFZ opcode ${opcode} at line ${line}.`);
  target[opcode] = { value, line };
}

function parseSfz(text: string): ParsedSfz {
  const control: OpcodeMap = {};
  const global: OpcodeMap = {};
  let group: OpcodeMap = {};
  let scope: SfzScope | undefined;
  let region: ParsedRegion | undefined;
  const regions: ParsedSfz["regions"] = [];
  const flushRegion = () => {
    if (!region) return;
    regions.push({ ...region, group: { ...group } });
    region = undefined;
  };

  for (const [index, original] of text.split(/\r?\n/).entries()) {
    const line = index + 1;
    let content = original.replace(/\/\/.*$/, "").trim();
    while (content) {
      const tag = /^<(control|global|group|region)>\s*/.exec(content);
      if (tag) {
        flushRegion();
        scope = tag[1] as SfzScope;
        if (scope === "group") group = {};
        if (scope === "region") region = { line, values: {} };
        content = content.slice(tag[0].length);
        continue;
      }
      if (content.startsWith("<") || content.startsWith("#") || !scope)
        throw new Error(`Unsupported SFZ syntax at line ${line}.`);
      const assignment =
        /^([a-z][a-z0-9_]*)\s*=\s*(.+?)(?=\s+[a-z][a-z0-9_]*\s*=|$)/.exec(
          content,
        );
      if (!assignment)
        throw new Error(`Unsupported SFZ assignment syntax at line ${line}.`);
      const [, opcode, value] = assignment;
      const target =
        scope === "control"
          ? control
          : scope === "global"
            ? global
            : scope === "group"
              ? group
              : region!.values;
      assignOpcode(target, opcode!, value!.trim(), line);
      content = content.slice(assignment[0].length).trimStart();
    }
  }
  flushRegion();
  if (!regions.length) throw new Error("SFZ source contains no regions.");
  return { control, global, regions };
}

function valueOf(values: OpcodeMap, key: string): string | undefined {
  return values[key]?.value;
}

function finiteNumber(
  values: OpcodeMap,
  key: string,
  fallback?: number,
): number {
  const raw = valueOf(values, key);
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`SFZ region is missing required opcode ${key}.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new Error(`Invalid numeric SFZ opcode ${key}.`);
  return value;
}

function midi(values: OpcodeMap, key: string, fallback?: number): number {
  const value = finiteNumber(values, key, fallback);
  if (!Number.isInteger(value) || value < 0 || value > 127)
    throw new Error(`SFZ opcode ${key} must be an integer from 0 to 127.`);
  return value;
}

export function collectSfzSamplePaths(
  sfzText: string,
  sfzPath = "source.sfz",
): string[] {
  const parsed = parseSfz(sfzText);
  const base = sfzDirectory(sfzPath);
  const defaultPath = valueOf(parsed.control, "default_path") ?? ".";
  return [
    ...new Set(
      parsed.regions.map(({ values }) =>
        resolveRelativePath(base, defaultPath, valueOf(values, "sample") ?? ""),
      ),
    ),
  ];
}

export function compileSfzCandidate(
  input: CompileSfzCandidateInput,
): CompiledSfzCandidate {
  const parsed = parseSfz(input.sfzText);
  const base = sfzDirectory(input.sfzPath);
  const defaultPath = valueOf(parsed.control, "default_path") ?? ".";
  const locks = new Map(
    input.assetLocks.map((lock) => [normalizeRelativePath(lock.path), lock]),
  );
  if (locks.size !== input.assetLocks.length)
    throw new Error("SFZ asset lock contains duplicate paths.");
  const sourceMapRegions: SfzSourceMap["regions"] = [];
  const assetById = new Map<string, SoundAssetDefinition>();
  const regions = parsed.regions.flatMap(({ line, values, group }, index) => {
    const effective = { ...parsed.global, ...group, ...values };
    const dynamic = finiteNumber(
      effective,
      "ampeg_dynamic",
      input.defaults?.ampegDynamic,
    );
    if (dynamic !== 1) throw new Error("SFZ v0 requires ampeg_dynamic=1.");
    const seqLength = finiteNumber(effective, "seq_length", 1);
    const seqPosition = finiteNumber(effective, "seq_position", 1);
    if (
      !Number.isInteger(seqLength) ||
      seqLength < 1 ||
      seqLength > 2 ||
      !Number.isInteger(seqPosition) ||
      seqPosition < 1 ||
      seqPosition > seqLength
    )
      throw new Error("SFZ v0 supports deterministic sequence lengths 1 or 2.");
    const highCc107 = finiteNumber(effective, "hicc107", 127);
    const cc107 = input.defaults?.cc107 ?? 0;
    if (
      !Number.isInteger(highCc107) ||
      highCc107 < 0 ||
      highCc107 > 127 ||
      !Number.isInteger(cc107) ||
      cc107 < 0 ||
      cc107 > 127
    )
      throw new Error("SFZ CC107 defaults must be integers from 0 to 127.");
    if (cc107 > highCc107) return [];
    const sample = valueOf(values, "sample");
    if (!sample) throw new Error(`SFZ region at line ${line} has no sample.`);
    const samplePath = resolveRelativePath(base, defaultPath, sample);
    const lock = locks.get(samplePath);
    if (!lock)
      throw new Error(`SFZ sample ${samplePath} has no exact asset lock.`);
    const asset = lock.asset;
    if (
      asset.kind !== "wav" ||
      !SHA256.test(asset.sha256) ||
      !Number.isInteger(asset.bytes) ||
      asset.bytes <= 0 ||
      !asset.audio ||
      !Number.isInteger(asset.audio.sampleRate) ||
      !Number.isInteger(asset.audio.frameCount) ||
      ![1, 2].includes(asset.audio.channels)
    )
      throw new Error(`SFZ sample ${samplePath} has an invalid asset lock.`);
    const existing = assetById.get(asset.id);
    if (
      existing &&
      (existing.sha256 !== asset.sha256 || existing.bytes !== asset.bytes)
    )
      throw new Error(`SFZ asset ID collision for ${asset.id}.`);
    assetById.set(asset.id, asset);
    const key = valueOf(effective, "key");
    const keyMidi = key === undefined ? undefined : midi(effective, "key");
    const minMidi = keyMidi ?? midi(effective, "lokey");
    const maxMidi = keyMidi ?? midi(effective, "hikey");
    const rootMidi = keyMidi ?? midi(effective, "pitch_keycenter", 60);
    const minVelocity = Math.max(
      1,
      midi(effective, "lovel", input.defaults?.minVelocity),
    );
    const maxVelocity = midi(effective, "hivel", input.defaults?.maxVelocity);
    if (minMidi > rootMidi || rootMidi > maxMidi || minVelocity > maxVelocity)
      throw new Error(`SFZ region at line ${line} has inverted ranges.`);
    const attackSeconds = finiteNumber(
      effective,
      "ampeg_attack",
      input.defaults?.attackSeconds,
    );
    const releaseSeconds = finiteNumber(
      effective,
      "ampeg_release",
      input.defaults?.releaseSeconds,
    );
    const gainDb =
      finiteNumber(effective, "volume", input.defaults?.gainDb ?? 0) +
      (input.defaults?.gainOffsetDb ?? 0);
    const loopMode = valueOf(effective, "loop_mode") ?? "no_loop";
    if (loopMode !== "no_loop")
      throw new Error(`Unsupported SFZ loop_mode ${loopMode} at line ${line}.`);
    if (
      attackSeconds < 0 ||
      attackSeconds > 10 ||
      releaseSeconds <= 0 ||
      releaseSeconds > 30 ||
      gainDb < -96 ||
      gainDb > 24
    )
      throw new Error(
        `SFZ region at line ${line} has unsafe envelope or gain.`,
      );
    const regionId = `${input.candidateId}-region-${String(index + 1).padStart(3, "0")}`;
    const curvePoints = Object.entries(effective)
      .flatMap(([opcode, item]) => {
        const match = /^amp_velcurve_(\d+)$/.exec(opcode);
        if (!match) return [];
        const velocity = Number(match[1]);
        const gain = Number(item.value);
        if (!Number.isFinite(gain) || gain < 0 || gain > 1)
          throw new Error(`SFZ opcode ${opcode} must be a number from 0 to 1.`);
        return [{ velocity, gain }];
      })
      .sort((left, right) => left.velocity - right.velocity);
    const velocityGainCurve =
      curvePoints.length === 0
        ? undefined
        : [
            ...(curvePoints[0]!.velocity === 0
              ? []
              : [{ velocity: 0, gain: 0 }]),
            ...curvePoints,
            ...(curvePoints.at(-1)!.velocity === 127
              ? []
              : [{ velocity: 127, gain: 1 }]),
          ];
    sourceMapRegions.push({
      regionId,
      sourceLine: line,
      samplePath,
      assetId: asset.id,
      inheritedOpcodes: Object.fromEntries(
        Object.entries(effective)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, item.value]),
      ),
    });
    return [
      {
        id: regionId,
        trigger: "attack" as const,
        assetId: asset.id,
        articulation: "none" as const,
        pitch: { minMidi, rootMidi, maxMidi },
        velocity: { min: minVelocity, max: maxVelocity },
        ...(velocityGainCurve === undefined ? {} : { velocityGainCurve }),
        ...(seqLength === 1
          ? {}
          : {
              roundRobin: {
                group: `sfz-${minMidi}-${rootMidi}-${maxMidi}-${minVelocity}-${maxVelocity}`,
                index: seqPosition - 1,
                count: seqLength,
              },
            }),
        gainDb,
        tuneCents: 0,
        attackSeconds,
        loop: { mode: "none" as const },
        release: { mode: "envelope" as const, seconds: releaseSeconds },
      },
    ];
  });
  if (locks.size !== assetById.size)
    throw new Error(
      "SFZ asset lock contains files outside the compiled closure.",
    );
  const playableMin = Math.min(
    ...regions.map((region) => region.pitch.minMidi),
  );
  const playableMax = Math.max(
    ...regions.map((region) => region.pitch.maxMidi),
  );
  const candidate: InstrumentCandidate = {
    id: input.candidateId,
    instrumentId: input.instrumentId,
    engine: "sampler",
    mapping: {
      type: "sample-map",
      playableMin,
      playableMax,
      midiFallbackProgram: input.midiFallbackProgram,
      articulationFallbacks: {},
      regions,
    },
    calibrationGainDb: input.calibrationGainDb,
    tailSeconds: Math.max(...regions.map((region) => region.release.seconds)),
    releaseStatus: input.releaseStatus,
  };
  const assets = [...assetById.values()];
  const validationCore = {
    format: "refrain-soundpack@1-experimental" as const,
    id: `${input.candidateId}-sfz-validation`,
    status: "development-candidates" as const,
    assets,
    candidates: [candidate],
  };
  const validationManifest: SoundpackManifest = {
    ...validationCore,
    contentSha256: soundObjectContentSha256(validationCore),
  };
  const errors = validateSoundpackManifest(validationManifest);
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    candidate,
    assets,
    sourceMap: {
      format: "refrain-sfz-source-map@0-experimental",
      compiler: SFZ_COMPILER_CONTRACT,
      source: { path: input.sfzPath, sha256: sha256Hex(input.sfzText) },
      normalization: { ...input.defaults },
      regions: sourceMapRegions,
    },
    coverage: {
      playableMin,
      playableMax,
      regionCount: regions.length,
      assetCount: assets.length,
      velocityBreaks: [
        ...new Set(
          regions.flatMap((region) => [
            region.velocity.min,
            region.velocity.max,
          ]),
        ),
      ].sort((left, right) => left - right),
    },
  };
}
