import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  AIR_V1_FORMAT,
  createAirVocabularyClosure,
  rationalFromNumber,
  type AirSourceV1,
} from "@refrain/air-schema/v1";
import { humV1, type HumInputV1 } from "@refrain/mcp-server/hum-v1";
import {
  createRefrainArtifactV3,
  parseRefrainArtifact,
  stringifyRefrainArtifact,
} from "@refrain/renderer/portable";
import {
  BUILT_IN_PERFORMANCE_BINDINGS,
  validateHistoricalPerformanceBinding,
  type PerformanceBinding,
} from "@refrain/soundpack";
import {
  CORE_AUTHORING_VOCABULARY,
  validateHistoricalPerformanceBindingV1,
  type PerformanceBindingV1,
} from "@refrain/soundpack/vnext";
import { performanceStatusForSource } from "./select-performance-binding.js";
import { inspectMusic, readMusic } from "./inspect-air.js";

export function draftAir(options: {
  title: string;
  instruments: string[];
  tempo: number;
  meter: string;
  bars: number;
}): AirSourceV1 {
  if (!Number.isInteger(options.bars) || options.bars < 1)
    throw new Error("bars must be a positive integer.");
  if (
    !options.instruments.length ||
    new Set(options.instruments).size !== options.instruments.length
  )
    throw new Error("Choose at least one instrument, without duplicates.");
  const instruments = options.instruments.map((id) => {
    const instrument = CORE_AUTHORING_VOCABULARY.instruments.find(
      (i) => i.id === id,
    );
    if (!instrument)
      throw new Error(
        `Unknown instrument ${id}. Use refrain bindings list --json for sound coverage.`,
      );
    const { supportedNotes, ...definition } = instrument;
    return {
      ...definition,
      ...(supportedNotes ? { supportedNotes: [...supportedNotes] } : {}),
    };
  });
  const [numerator, denominator] = options.meter.split("/").map(Number);
  const source: AirSourceV1 = {
    format: AIR_V1_FORMAT,
    title: options.title,
    conductor: {
      tempo: options.tempo,
      meters: [{ bar: 1, meter: options.meter }],
    },
    vocabulary: createAirVocabularyClosure({
      id: "refrain-draft-language@1",
      instruments,
      techniques: [],
    }),
    motifs: {},
    sections: [{ id: "opening", startBar: 1, bars: options.bars }],
    voices: instruments.map((i) => ({
      id: i.id,
      instrument: i.id,
      role: "lead",
      realize: [
        {
          id: "unwritten",
          kind: "rest",
          duration: rationalFromNumber(
            (options.bars * numerator! * 4) / denominator!,
          ),
        },
      ],
    })),
  };
  readMusic(source);
  return source;
}

type Binding = PerformanceBinding | PerformanceBindingV1;
async function readBinding(value: string, cwd: string): Promise<Binding> {
  const builtin = BUILT_IN_PERFORMANCE_BINDINGS.find((b) => b.id === value);
  if (builtin) return builtin;
  const input = JSON.parse(
    await readFile(resolve(cwd, value), "utf8"),
  ) as Binding;
  const errors =
    input.format === "refrain-performance-binding@1-experimental"
      ? validateHistoricalPerformanceBindingV1(input)
      : validateHistoricalPerformanceBinding(input);
  if (errors.length) throw new Error(errors.join("\n"));
  return input;
}

export async function runAuthoringCli(args: string[], cwd: string) {
  const [command, ...rest] = args;
  const definitions =
    command === "draft"
      ? {
          out: "string",
          title: "string",
          instruments: "string",
          tempo: "string",
          meter: "string",
          bars: "string",
        }
      : command === "hum"
        ? {
            out: "string",
            parent: "string",
            relation: "string",
            evidence: "string",
            binding: "string",
            caption: "string",
          }
        : command === "inspect"
          ? { section: "string", voice: "string", compare: "string" }
          : undefined;
  if (!definitions) throw new Error(`Unknown authoring command ${command}.`);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      ...Object.fromEntries(
        Object.keys(definitions).map((k) => [k, { type: "string" as const }]),
      ),
      json: { type: "boolean" },
    },
  });
  const string = (key: string) =>
    (values as Record<string, string | boolean | undefined>)[key] as
      string | undefined;
  const required = (key: string) => {
    const v = string(key);
    if (!v) throw new Error(`--${key} is required.`);
    return v;
  };
  const read = async (path: string) =>
    JSON.parse(await readFile(resolve(cwd, path), "utf8")) as unknown;
  const output = async (value: string) => {
    const path = resolve(cwd, required("out"));
    await writeFile(path, value, { flag: "wx" });
    return path;
  };
  if (command === "draft") {
    if (positionals.length)
      throw new Error("draft takes options, not an input file.");
    const source = draftAir({
      title: required("title"),
      instruments: required("instruments").split(","),
      tempo: Number(string("tempo") ?? 96),
      meter: string("meter") ?? "4/4",
      bars: Number(string("bars") ?? 8),
    });
    const path = await output(`${JSON.stringify(source, null, 2)}\n`);
    return {
      ok: true,
      path,
      status: "silent-draft",
      instruments: source.voices.map((v) => v.instrument),
      next: "Author motifs, sections, roles and notes in this AIR file. The draft contains only rests; then run refrain inspect and refrain hum.",
    };
  }
  if (positionals.length !== 1)
    throw new Error(`${command} requires one input file.`);
  const input = await read(positionals[0]!);
  if (command === "inspect")
    return inspectMusic(
      input,
      { section: string("section"), voice: string("voice") },
      string("compare") ? await read(string("compare")!) : undefined,
    );
  required("out");
  const parentPath = string("parent");
  const relation = string("relation");
  if (Boolean(parentPath) !== Boolean(relation))
    throw new Error("--parent and --relation must be supplied together.");
  if (string("evidence") && !parentPath)
    throw new Error("--evidence requires --parent and --relation.");
  if (
    relation &&
    !["revise", "extend", "reply", "variation", "quote"].includes(relation)
  )
    throw new Error(`Unknown relation ${relation}.`);
  const parent = parentPath
    ? parseRefrainArtifact(await read(parentPath))
    : undefined;
  if (
    parent &&
    (!parent.ok || parent.artifact.format !== "refrain-artifact@3-experimental")
  )
    throw new Error("--parent requires a valid exact AIR@1 Artifact@3.");
  const parentArtifact =
    parent?.ok && parent.artifact.format === "refrain-artifact@3-experimental"
      ? parent.artifact
      : undefined;
  const inherited = parentArtifact?.performanceBindings.find(
    (b) => b.id === parentArtifact.defaultBindingId,
  );
  const binding = string("binding")
    ? await readBinding(string("binding")!, cwd)
    : parentArtifact
      ? inherited
      : await readBinding("f-synthetic-beat@0", cwd);
  const result = humV1({
    air: input,
    ...(string("caption") === undefined ? {} : { caption: string("caption")! }),
    ...(parentArtifact
      ? {
          from: {
            parentArtifact,
            relation: relation as NonNullable<HumInputV1["from"]>["relation"],
            ...(string("evidence")
              ? {
                  evidence: (await read(string("evidence")!)) as NonNullable<
                    HumInputV1["from"]
                  >["evidence"],
                }
              : {}),
          },
        }
      : {}),
  });
  if (!result.ok)
    throw new Error(
      result.diagnostics.map((d) => `${d.path}: ${d.message}`).join("\n"),
    );
  const artifact = createRefrainArtifactV3({
    source: result.source,
    receipt: result.receipt,
    ...(binding ? { performanceBinding: binding } : {}),
    ...(result.caption === undefined ? {} : { caption: result.caption }),
  });
  const path = await output(stringifyRefrainArtifact(artifact));
  return {
    ok: true,
    path,
    sourceRevision: artifact.receipt.sourceRevision,
    receiptId: artifact.receipt.receiptId,
    relation: artifact.receipt.lineage?.relation ?? null,
    binding: artifact.defaultBindingId ?? null,
    performance: binding
      ? performanceStatusForSource(binding, result.source)
      : {
          status: "unavailable",
          message: "No exact binding was selected on the parent.",
        },
    durationSeconds: result.summary.durationSeconds,
    eventCount: result.summary.eventCount,
    diagnostics: result.diagnostics,
    next: "refrain open <artifact-path> --no-open --json; playback requires a user gesture. Use refrain export for native WAV and MIDI.",
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    console.log(
      JSON.stringify(
        await runAuthoringCli(
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
