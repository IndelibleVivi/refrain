import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { SOUND_REGISTRY } from "@refrain/soundpack";
import {
  CORE_AUTHORING_VOCABULARY,
  createPerformanceBindingV1,
  createRenderSceneV1,
  createSoundProfileV2,
  type RenderSceneV1,
} from "@refrain/soundpack/vnext";
import { createExecutionBundle } from "@refrain/audio-engine/execution";
import { createPerformancePlan } from "@refrain/audio-engine/performance";
import {
  sceneRouteForVoice,
  sceneBusChain,
} from "@refrain/audio-engine/scene-routing";
import {
  createRefrainArtifactV3,
  parseRefrainArtifact,
  stringifyRefrainArtifact,
} from "@refrain/renderer/portable";
import type { RefrainArtifactV3 } from "@refrain/renderer";
import { readMusic } from "./inspect-air.js";
import { performanceStatusForSource } from "./select-performance-binding.js";

export interface ProductionSettings {
  format: "refrain-production-settings@0-experimental";
  id: string;
  baseBinding: { id: string; sha256: string };
  sourceRevision: string;
  scene: Omit<RenderSceneV1, "format" | "contentSha256">;
}

function artifactOf(input: unknown): RefrainArtifactV3 {
  const parsed = parseRefrainArtifact(input);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  if (parsed.artifact.format !== "refrain-artifact@3-experimental")
    throw new Error(
      "Production requires an exact AIR@1 Artifact@3. Historical artifacts remain readable; author or explicitly migrate AIR@1 first.",
    );
  return parsed.artifact;
}

function bindingOf(artifact: RefrainArtifactV3, id?: string) {
  const selected = id ?? artifact.defaultBindingId;
  const binding = artifact.performanceBindings.find((b) => b.id === selected);
  if (!binding)
    throw new Error(
      "Select a carried exact binding with --binding, or seal the AIR with refrain hum --binding first.",
    );
  const status = performanceStatusForSource(binding, artifact.source);
  if (status.status !== "available") throw new Error(status.message);
  return binding;
}

function rawMaster(binding: ReturnType<typeof bindingOf>) {
  const scene = binding.renderScene;
  const master =
    scene.format === "refrain-render-scene@1-experimental"
      ? scene.master
      : {
          gainDb: scene.masterGainDb,
          peakCeiling: scene.peakCeiling,
          velocityScale: scene.velocityScale,
        };
  return master;
}

function effectiveMaster(plan: ReturnType<typeof createPerformancePlan>) {
  const profile = plan.resolvedRenderProfile;
  return {
    gainDb: profile.masterGainDb,
    peakCeiling: profile.peakCeiling,
    velocityScale: profile.velocityScale,
  };
}

export function initProduction(
  input: unknown,
  id: string,
  bindingId?: string,
): ProductionSettings {
  const artifact = artifactOf(input);
  const binding = bindingOf(artifact, bindingId);
  const existing = binding.renderScene;
  const roles = [...new Set(artifact.source.voices.map((v) => v.role))];
  const settings: ProductionSettings = {
    format: "refrain-production-settings@0-experimental",
    id,
    baseBinding: { id: binding.id, sha256: binding.contentSha256 },
    sourceRevision: artifact.receipt.sourceRevision,
    scene: {
      id:
        existing.format === "refrain-render-scene@1-experimental"
          ? existing.id
          : `${id}.scene`,
      // Production settings explicitly materialize the effective master once.
      // The derived binding has no override layer that could shadow these edits.
      master: effectiveMaster(
        createPerformancePlan(readMusic(artifact).compiled, {
          performanceBinding: binding,
        }),
      ),
      buses:
        existing.format === "refrain-render-scene@1-experimental"
          ? structuredClone(existing.buses)
          : [
              ...roles.map((role) => ({
                id: `role-${role}`,
                output: "mix",
                processors: [],
              })),
              { id: "mix", output: "master", processors: [] },
            ],
      routes:
        existing.format === "refrain-render-scene@1-experimental"
          ? structuredClone(existing.routes)
          : roles.map((role) => ({
              id: `route-${role}`,
              bus: `role-${role}`,
              match: { roles: [role] },
            })),
    },
  };
  sceneOf(settings);
  return settings;
}

function sceneOf(input: unknown) {
  const settings = input as ProductionSettings;
  const keys = (v: unknown, expected: string[]) =>
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    JSON.stringify(Object.keys(v).sort()) === JSON.stringify(expected.sort());
  if (
    !keys(settings, [
      "format",
      "id",
      "baseBinding",
      "sourceRevision",
      "scene",
    ]) ||
    settings.format !== "refrain-production-settings@0-experimental" ||
    typeof settings.id !== "string" ||
    !/^[a-z0-9][a-z0-9_.@-]*$/.test(settings.id) ||
    !keys(settings.baseBinding, ["id", "sha256"]) ||
    typeof settings.baseBinding.id !== "string" ||
    typeof settings.baseBinding.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(settings.baseBinding.sha256) ||
    typeof settings.sourceRevision !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(settings.sourceRevision) ||
    !keys(settings.scene, ["id", "master", "buses", "routes"])
  )
    throw new Error(
      "Expected exact production settings from refrain produce init; edit id and scene, preserve baseBinding.",
    );
  const scene = createRenderSceneV1(settings.scene);
  for (const bus of scene.buses)
    if (new Set(bus.processors.map((p) => p.id)).size !== bus.processors.length)
      throw new Error(
        `Production bus ${bus.id} has duplicate processor IDs; each processor needs independent state.`,
      );
  return scene;
}

export function applyProduction(
  input: unknown,
  rawSettings: unknown,
  bindingId?: string,
): RefrainArtifactV3 {
  const artifact = artifactOf(input);
  const base = bindingOf(artifact, bindingId);
  const scene = sceneOf(rawSettings);
  const settings = rawSettings as ProductionSettings;
  if (settings.sourceRevision !== artifact.receipt.sourceRevision)
    throw new Error(
      "Production settings target a different musical source. Re-initialize so the routes and sound coverage can be checked for this work.",
    );
  if (
    settings.baseBinding.id !== base.id ||
    settings.baseBinding.sha256 !== base.contentSha256
  )
    throw new Error(
      "Production settings target a different exact binding. Re-initialize from this artifact or explicitly select the carried base with --binding.",
    );
  if (settings.id === base.id)
    throw new Error(
      "Use a new production id; the base binding remains exact and is retained.",
    );
  const compiled = readMusic(artifact).compiled;
  const requiredInstrumentIds = [
    ...new Set(compiled.events.map((event) => event.instrument)),
  ];
  if (requiredInstrumentIds.length === 0)
    throw new Error(
      "Author at least one sounding note before applying production; Binding@1 requires a non-empty executed instrument closure.",
    );
  const profile =
    base.format === "refrain-performance-binding@1-experimental"
      ? base.soundProfile
      : createSoundProfileV2({
          id: `${base.soundProfile.id}.production`,
          vocabulary: CORE_AUTHORING_VOCABULARY,
          selections: base.soundProfile.selections,
          manifest: SOUND_REGISTRY,
        });
  const binding = createPerformanceBindingV1({
    id: settings.id,
    soundProfile: profile,
    renderScene: scene,
    requiredInstrumentIds,
    manifest: SOUND_REGISTRY,
  });
  // The old palette still describes its old exact scene. It stays on the old
  // binding, alongside its valid render evidence, rather than naming this mix.
  const result = createRefrainArtifactV3({
    ...artifact,
    performanceBinding: binding,
    defaultBindingId: binding.id,
  });
  // Resolve the actual execution contract before publishing a usable artifact.
  createExecutionBundle(compiled, {
    performanceBinding: binding,
    sourceRevision: result.receipt.sourceRevision,
  });
  return result;
}

export function inspectProduction(input: unknown, bindingId?: string) {
  const artifact = artifactOf(input);
  const binding = bindingOf(artifact, bindingId);
  const scene = binding.renderScene;
  const plan = createPerformancePlan(readMusic(artifact).compiled, {
    performanceBinding: binding,
  });
  const routeVoices = new Map<string, string[]>();
  const voices = artifact.source.voices.map((voice) => {
    const resolved = plan.voices.find((v) => v.voiceId === voice.id);
    const route =
      scene.format === "refrain-render-scene@1-experimental"
        ? sceneRouteForVoice(scene, voice)
        : undefined;
    if (route)
      routeVoices.set(route.id, [
        ...(routeVoices.get(route.id) ?? []),
        voice.id,
      ]);
    const chain =
      scene.format === "refrain-render-scene@1-experimental"
        ? sceneBusChain(scene, route?.bus ?? "master").map((bus) => ({
            bus: bus.id,
            processors: bus.processors,
          }))
        : [];
    return {
      id: voice.id,
      instrument: voice.instrument,
      role: voice.role,
      authoredGainDb: voice.gainDb ?? 0,
      authoredPan: voice.pan ?? 0,
      execution: resolved ? "scheduled" : "silent",
      resolvedSound: resolved
        ? {
            candidateId: resolved.candidateId,
            candidateSha256: resolved.candidateDigest,
            fallbackUsed: resolved.fallbackUsed,
            candidateGainDb: resolved.candidateGainDb,
            profileGainDb: resolved.profileGainDb,
            effectiveVoiceGainDb: resolved.effectiveGainDb,
          }
        : null,
      route: route?.id ?? null,
      inputBus: route?.bus ?? "master",
      chain,
    };
  });
  const groups = new Map<string, string[]>();
  for (const v of voices) {
    const key = `${v.instrument}/${v.role}`;
    groups.set(key, [...(groups.get(key) ?? []), v.id]);
  }
  return {
    ok: true,
    sourceRevision: artifact.receipt.sourceRevision,
    receiptId: artifact.receipt.receiptId,
    binding: {
      id: binding.id,
      sha256: binding.contentSha256,
      format: binding.format,
    },
    scene: {
      id: scene.id,
      format: scene.format,
      master: rawMaster(binding),
    },
    overrides: binding.overrides,
    effectiveMaster: effectiveMaster(plan),
    resolutionEvidence:
      "current-plan; pinned chains are retained below; a render receipt is required for historical audio evidence",
    soundProfile: {
      id: binding.soundProfile.id,
      sha256: binding.soundProfile.contentSha256,
      selections: binding.soundProfile.selections,
    },
    palette: binding.soundPalette?.id ?? null,
    durationSeconds: plan.durationSeconds,
    voices,
    routes:
      scene.format === "refrain-render-scene@1-experimental"
        ? scene.routes.map((r) => ({
            ...r,
            matchedVoices: routeVoices.get(r.id) ?? [],
          }))
        : [],
    inseparableGroups: [...groups.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([instrumentRole, ids]) => ({ instrumentRole, voices: ids })),
    limits: [
      "Routes use the first matching instrument/role predicate; they do not select voice IDs or sections.",
      "This is an execution/routing report, not measured audio, hearing or a quality score.",
      "MIDI does not carry these bus effects; native WAV and browser playback execute the scene.",
    ],
  };
}

export async function runProductionCli(args: string[], cwd: string) {
  const [command, ...rest] = args;
  if (!["init", "inspect", "apply"].includes(command ?? ""))
    throw new Error(
      "Use refrain produce init, inspect, or apply. Run refrain produce --help.",
    );
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      binding: { type: "string" },
      json: { type: "boolean" },
      ...(command === "init"
        ? { id: { type: "string" as const }, out: { type: "string" as const } }
        : {}),
      ...(command === "apply"
        ? {
            settings: { type: "string" as const },
            out: { type: "string" as const },
          }
        : {}),
      ...(command === "inspect"
        ? { settings: { type: "string" as const } }
        : {}),
    },
  });
  if (positionals.length !== 1)
    throw new Error("produce requires one artifact file.");
  const required = (key: "id" | "out" | "settings") => {
    const value = values[key];
    if (typeof value !== "string" || !value)
      throw new Error(`--${key} is required.`);
    return value;
  };
  const read = async (path: string) =>
    JSON.parse(await readFile(resolve(cwd, path), "utf8")) as unknown;
  const input = await read(positionals[0]!);
  if (command === "inspect") {
    const target = values.settings
      ? applyProduction(input, await read(required("settings")), values.binding)
      : input;
    return {
      ...inspectProduction(
        target,
        values.settings ? undefined : values.binding,
      ),
      preview: Boolean(values.settings),
    };
  }
  const value =
    command === "init"
      ? initProduction(input, required("id"), values.binding)
      : applyProduction(
          input,
          await read(required("settings")),
          values.binding,
        );
  const path = resolve(cwd, required("out"));
  await writeFile(
    path,
    command === "init"
      ? `${JSON.stringify(value, null, 2)}\n`
      : stringifyRefrainArtifact(value as RefrainArtifactV3),
    { flag: "wx" },
  );
  return command === "init"
    ? {
        ok: true,
        path,
        status: "editable-production-settings",
        targetBindingFormat: "refrain-performance-binding@1-experimental",
        masterPolicy: "materialize-effective-values-with-no-derived-overrides",
        next: "The effective master is materialized into scene.master; apply creates a Binding@1 with no overriding layer. Edit buses/processors/routes, inspect --settings, then apply. No sound is changed by init.",
      }
    : {
        ...inspectProduction(value),
        path,
        sourceUnchanged: true,
        musicalReceiptUnchanged: true,
        next: "refrain open <artifact> --no-open --json; refrain export <artifact>. Playback requires a user gesture. The original binding remains selectable with --binding.",
      };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    console.log(
      JSON.stringify(
        await runProductionCli(
          process.argv.slice(2),
          process.env.INIT_CWD ?? process.cwd(),
        ),
        null,
        process.argv.includes("--json") ? undefined : 2,
      ),
    );
  } catch (cause) {
    console.log(
      JSON.stringify({
        ok: false,
        error: {
          message: cause instanceof Error ? cause.message : String(cause),
        },
      }),
    );
    process.exitCode = 1;
  }
}
