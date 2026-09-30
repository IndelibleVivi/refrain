import {
  sha256Hex,
  soundObjectContentSha256,
  validateSoundpackManifest,
  type InstrumentCandidate,
  type InstrumentVocabulary,
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

/**
 * Deliberately-handled SFZ opcodes whose sound-affecting behavior this closed
 * compiler fixes at one exact value. A region carrying one of these opcodes at
 * any other value fails closed. Each entry records what the opcode means, the
 * exact value accepted, and the fixed interpretation this first Shinyguitar
 * candidate applies, so the choice is inspectable rather than silently dropped.
 *
 * For the standalone `Programs/acoustic.sfz`, the samples are microphone
 * recordings. The safe fixed controller state is CC100=0: at CC100=0 the
 * `amplitude_oncc100=100` blend selects the base region amplitude, so the
 * microphone take plays at unity. CC100=127 would be excluded by `hicc100=126`.
 * CC106=0 keeps `ampeg_release=0.250` at 0.250 because the
 * `ampeg_releasecc106=-0.200` offset then contributes zero.
 */
export const FIXED_SFZ_OPCODES: Readonly<
  Record<
    string,
    { exactValue: string; meaning: string; fixedInterpretation: string }
  >
> = Object.freeze({
  amplitude: {
    exactValue: "100",
    meaning:
      "Static amplitude percentage applied to the region when no controller overrides it.",
    fixedInterpretation:
      "Fixed at unity (100). The candidate calibration holds the single gain authority; per-region volume/calibration stay the only level controls.",
  },
  amplitude_oncc100: {
    meaning:
      "Amplitude blended by CC100 between the magnetic pickup signal (0) and the microphone signal (127).",
    exactValue: "100",
    fixedInterpretation:
      "Evaluated at the fixed controller state CC100=0, where the blend selects the base region amplitude. The microphone take plays at unity; CC100 is not a runtime control.",
  },
  hicc100: {
    exactValue: "126",
    meaning: "Upper CC100 bound above which the region stops responding.",
    fixedInterpretation:
      "Satisfied at the fixed controller state CC100=0 (0 <= 126), so the region is included. It does not select among RR variants.",
  },
  ampeg_releasecc106: {
    exactValue: "-0.200",
    meaning: "Release-time offset applied by CC106 (release-noise volume).",
    fixedInterpretation:
      "Evaluated at the fixed controller state CC106=0, where the offset contributes zero; the declared ampeg_release is unchanged.",
  },
});

/** Fixed controller state this candidate compiler assumes, per the program readme. */
export const FIXED_SFZ_CONTROLLERS: Readonly<Record<string, number>> =
  Object.freeze({ 100: 0, 106: 0 });

/** Random-interval opcodes lowered to deterministic candidate-scoped RR. */
const RANDOM_INTERVAL_OPCODES = new Set(["hirand", "lorand"]);

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
  /**
   * Exact authoring vocabulary this candidate belongs to. Core SFZ candidates
   * omit it and validate against the core instrument vocabulary. A pack-carried
   * instrument (for example `archtop_guitar`) must pass its explicit closure so
   * the candidate validates against the carried vocabulary instead of the core
   * list. This never mutates the global vocabulary.
   */
  vocabulary?: InstrumentVocabulary;
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
  randomization: {
    policy: "candidate-scoped-explicit-round-robin";
    groups: Array<{
      key: string;
      sourceLine: number;
      count: number;
      variants: Array<{ index: number; samplePath: string }>;
    }>;
    fixedOpcodes: Array<{
      opcode: string;
      exactValue: string;
      meaning: string;
      fixedInterpretation: string;
    }>;
    /** Fixed MIDI controller state this compilation assumes. */
    controllerState: Record<string, number>;
  };
  /**
   * How declared sample paths became exact asset-lock paths. Recorded because
   * the pinned Shinyguitar program writes `sample=acoustic\...` while the
   * repository stores the WAVs alongside a missing `default_path`, so the
   * compiler must normalize the root explicitly rather than pretend the path
   * exists verbatim.
   */
  pathNormalization: {
    declaredExample: string;
    resolvedExample: string;
    note: string;
  };
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
  const fixable =
    opcode in FIXED_SFZ_OPCODES ||
    RANDOM_INTERVAL_OPCODES.has(opcode) ||
    /^amp_velcurve_(?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-7])$/.test(opcode);
  if (!ALLOWED_OPCODES.has(opcode) && !fixable)
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

interface LoweredRandomGroups {
  /** Deterministic RR index (1-based) per top-level region index, if member. */
  indexByRegion: Map<number, { index: number; count: number }>;
  /** Source-line origin of each lowered group, for the source map. */
  groupByRegion: Map<number, number>;
  /** Canonical selection-identity key of each lowered group. */
  keyByRegion: Map<number, string>;
}

/**
 * Canonical identity shared by every region of one random-selection group.
 *
 * The identity is the effective region state with random-selection and sample
 * opcodes removed: two regions in the same group differ only by their sample
 * and their `lorand`/`hirand` interval. Global values are folded in so an
 * unrelated change cannot merge two distinct zones.
 */
function randomSelectionIdentity(
  global: OpcodeMap,
  region: ParsedSfz["regions"][number],
): string {
  const effective: Record<string, string> = {};
  for (const scope of [global, region.group, region.values]) {
    for (const [opcode, item] of Object.entries(scope)) {
      if (opcode === "sample" || opcode === "lorand" || opcode === "hirand")
        continue;
      effective[opcode] = item.value;
    }
  }
  return Object.entries(effective)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([opcode, value]) => `${opcode}=${value}`)
    .join("\u0000");
}

/**
 * Lowers regions that partition the [0,1] random draw.
 *
 * Groups are formed by exact selection identity, not by adjacency: the pinned
 * Shinyguitar program writes its 68 four-way groups back to back with no
 * non-random separator, so adjacency cannot separate them. Every group must be
 * exactly one complete, non-overlapping partition of [0,1]; the compiler turns
 * it into explicit deterministic round robins and never adds runtime randomness.
 */
function lowerRandomIntervals(
  global: OpcodeMap,
  regions: ParsedSfz["regions"],
): LoweredRandomGroups {
  const indexByRegion: LoweredRandomGroups["indexByRegion"] = new Map();
  const groupByRegion: LoweredRandomGroups["groupByRegion"] = new Map();
  const keyByRegion: LoweredRandomGroups["keyByRegion"] = new Map();
  const groups = new Map<
    string,
    Array<{ regionIndex: number; line: number; low: number; high: number }>
  >();
  regions.forEach((region, regionIndex) => {
    const { line, values } = region;
    const hasRandom =
      values.lorand !== undefined || values.hirand !== undefined;
    if (!hasRandom) return;
    const low = values.lorand === undefined ? 0 : Number(values.lorand.value);
    const high = values.hirand === undefined ? 1 : Number(values.hirand.value);
    if (
      !Number.isFinite(low) ||
      !Number.isFinite(high) ||
      low < 0 ||
      high > 1 ||
      low >= high
    )
      throw new Error(
        `SFZ region at line ${line} has an invalid random interval.`,
      );
    const key = randomSelectionIdentity(global, region);
    const group = groups.get(key) ?? [];
    group.push({ regionIndex, line, low, high });
    groups.set(key, group);
  });
  for (const [key, members] of groups) {
    const intervals = [...members].sort((left, right) => left.low - right.low);
    let cursor = 0;
    for (const interval of intervals) {
      if (interval.low !== cursor)
        throw new Error(
          "SFZ random intervals must form a complete non-overlapping partition of [0,1].",
        );
      cursor = interval.high;
    }
    if (cursor !== 1)
      throw new Error(
        "SFZ random intervals must form a complete non-overlapping partition of [0,1].",
      );
    if (intervals.length < 2)
      throw new Error(
        "SFZ random intervals need at least two variants forming a complete non-overlapping partition of [0,1].",
      );
    const groupLine = intervals[0]!.line;
    intervals.forEach((interval, position) => {
      indexByRegion.set(interval.regionIndex, {
        index: position + 1,
        count: intervals.length,
      });
      groupByRegion.set(interval.regionIndex, groupLine);
      keyByRegion.set(interval.regionIndex, key);
    });
  }
  return { indexByRegion, groupByRegion, keyByRegion };
}

export function compileSfzCandidate(
  input: CompileSfzCandidateInput,
): CompiledSfzCandidate {
  const parsed = parseSfz(input.sfzText);
  const base = sfzDirectory(input.sfzPath);
  const defaultPath = valueOf(parsed.control, "default_path") ?? ".";
  const randomGroups = lowerRandomIntervals(parsed.global, parsed.regions);
  const locks = new Map(
    input.assetLocks.map((lock) => [normalizeRelativePath(lock.path), lock]),
  );
  if (locks.size !== input.assetLocks.length)
    throw new Error("SFZ asset lock contains duplicate paths.");
  const sourceMapRegions: SfzSourceMap["regions"] = [];
  const loweredRandomGroups: SfzSourceMap["randomization"]["groups"] = [];
  const usedFixedOpcodes = new Set<string>();
  let firstDeclaredSample: string | undefined;
  let firstResolvedSample: string | undefined;
  const assetById = new Map<string, SoundAssetDefinition>();
  const regions = parsed.regions.flatMap(({ line, values, group }, index) => {
    const effective = { ...parsed.global, ...group, ...values };
    for (const opcode of Object.keys(effective)) {
      const fixed = FIXED_SFZ_OPCODES[opcode];
      if (!fixed) continue;
      if (effective[opcode]!.value !== fixed.exactValue)
        throw new Error(
          `SFZ opcode ${opcode} must be exactly ${fixed.exactValue} at line ${line}; other values are unsupported.`,
        );
      usedFixedOpcodes.add(opcode);
    }
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
    const random = randomGroups.indexByRegion.get(index);
    if (random && seqLength !== 1)
      throw new Error(
        "SFZ region cannot combine sequence and random-interval selection.",
      );
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
    firstDeclaredSample ??= sample.replace(/\\/g, "/");
    firstResolvedSample ??= samplePath;
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
    // Existing seq_length semantics keep their original stable group string;
    // lowered random intervals use a distinct deterministic group so no
    // existing candidate identity changes.
    const seqKey = `sfz-${minMidi}-${rootMidi}-${maxMidi}-${minVelocity}-${maxVelocity}`;
    const randomIdentity = randomGroups.keyByRegion.get(index);
    const randomKey = `sfz-rr-${sha256Hex(randomIdentity ?? "")}`;
    const roundRobin =
      random !== undefined
        ? { group: randomKey, index: random.index - 1, count: random.count }
        : seqLength === 1
          ? undefined
          : { group: seqKey, index: seqPosition - 1, count: seqLength };
    if (
      random !== undefined &&
      !loweredRandomGroups.some((group) => group.key === randomKey)
    )
      loweredRandomGroups.push({
        key: randomKey,
        sourceLine: randomGroups.groupByRegion.get(index) ?? line,
        count: random.count,
        variants: [],
      });
    if (random !== undefined) {
      const group = loweredRandomGroups.find((item) => item.key === randomKey)!;
      group.variants[random.index - 1] = { index: random.index, samplePath };
    }
    return [
      {
        id: regionId,
        trigger: "attack" as const,
        assetId: asset.id,
        articulation: "none" as const,
        pitch: { minMidi, rootMidi, maxMidi },
        velocity: { min: minVelocity, max: maxVelocity },
        ...(velocityGainCurve === undefined ? {} : { velocityGainCurve }),
        ...(roundRobin === undefined ? {} : { roundRobin }),
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
  const errors = validateSoundpackManifest(
    validationManifest,
    input.vocabulary,
  );
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
      randomization: {
        policy: "candidate-scoped-explicit-round-robin",
        groups: loweredRandomGroups
          .map((group) => ({
            key: group.key,
            sourceLine: group.sourceLine,
            count: group.count,
            variants: group.variants.filter(
              (variant): variant is { index: number; samplePath: string } =>
                variant !== undefined,
            ),
          }))
          .sort((left, right) => left.sourceLine - right.sourceLine),
        fixedOpcodes: [...usedFixedOpcodes]
          .sort((left, right) => left.localeCompare(right))
          .map((opcode) => ({
            opcode,
            exactValue: FIXED_SFZ_OPCODES[opcode]!.exactValue,
            meaning: FIXED_SFZ_OPCODES[opcode]!.meaning,
            fixedInterpretation: FIXED_SFZ_OPCODES[opcode]!.fixedInterpretation,
          })),
        controllerState: { ...FIXED_SFZ_CONTROLLERS },
      },
      pathNormalization: {
        declaredExample: firstDeclaredSample ?? "",
        resolvedExample: firstResolvedSample ?? "",
        note: "Backslashes are normalized before the declared sample is resolved against the SFZ directory and default_path. Asset locks bind that logical path to an exact source asset; source-specific disk mapping remains in the asset processing history.",
      },
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
