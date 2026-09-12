import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  sealResponse,
  type AuditionTarget,
  type MusicalResponse,
  type ShareManifest,
} from "@refrain/correspondence";
import {
  createShare,
  jsonFile,
  prepareAudition,
  receiveShare,
  verifyAuditionDirectory,
  writeJson,
  type PrepareInput,
} from "@refrain/correspondence/node";

export async function runCorrespondenceCli(args: string[], cwd: string) {
  const [command, ...rest] = args;
  const definitions: Record<
    string,
    { type: "string" | "boolean"; multiple?: boolean }
  > = { json: { type: "boolean" } };
  const fields =
    command === "audition"
      ? [
          "out",
          "binding",
          "section",
          "selection",
          "start",
          "end",
          "context",
          "compare",
          "compare-binding",
          "compare-section",
          "compare-selection",
          "compare-start",
          "compare-end",
          "asset-root",
        ]
      : command === "respond"
        ? [
            "out",
            "entry",
            "observer",
            "basis",
            "message",
            "start",
            "end",
            "hypothesis",
            "experiment",
          ]
        : command === "share"
          ? ["out", "attribution", "rights", "invitation", "message"]
          : command === "receive"
            ? ["out"]
            : undefined;
  if (!fields) throw new Error(`Unknown correspondence command ${command}.`);
  for (const field of fields) definitions[field] = { type: "string" };
  if (command === "share") {
    definitions["include-artifact"] = { type: "boolean" };
    definitions.response = { type: "string", multiple: true };
  }
  const { values, positionals } = parseArgs({
    args: rest,
    options: definitions,
    allowPositionals: true,
  });
  if (positionals.length !== 1)
    throw new Error(
      `${command} requires one input artifact or packet directory.`,
    );
  const value = (key: string) => values[key] as string | undefined;
  const required = (key: string) => {
    const v = value(key);
    if (!v) throw new Error(`--${key} is required.`);
    return v;
  };
  const path = (p: string) => resolve(cwd, p);
  const inputPath = path(positionals[0]!);
  if (command === "audition") {
    const target = async (prefix = ""): Promise<AuditionTarget> => ({
      ...(value(`${prefix}section`)
        ? { section: value(`${prefix}section`) }
        : {}),
      ...(value(`${prefix}selection`)
        ? {
            selection: (await jsonFile(
              path(value(`${prefix}selection`)!),
            )) as NonNullable<AuditionTarget["selection"]>,
          }
        : {}),
      ...(value(`${prefix}start`) !== undefined
        ? { startSeconds: Number(value(`${prefix}start`)) }
        : {}),
      ...(value(`${prefix}end`) !== undefined
        ? { endSeconds: Number(value(`${prefix}end`)) }
        : {}),
      contextSeconds: Number(value("context") ?? 2),
    });
    const a = await target();
    const hasTarget = (t: AuditionTarget) =>
      t.section !== undefined ||
      t.selection !== undefined ||
      t.startSeconds !== undefined ||
      t.endSeconds !== undefined;
    const b = await target("compare-");
    if (!value("compare") && (hasTarget(b) || value("compare-binding")))
      throw new Error("Comparison options require --compare <artifact>.");
    if (value("compare") && hasTarget(a) !== hasTarget(b))
      throw new Error(
        "A/B excerpt comparison requires an explicit target for each version; clock time is not musical alignment.",
      );
    const inputs: PrepareInput[] = [
      {
        artifact: await jsonFile(inputPath),
        bindingId: value("binding"),
        target: a,
      },
    ];
    if (value("compare"))
      inputs.push({
        artifact: await jsonFile(path(value("compare")!)),
        bindingId: value("compare-binding"),
        target: b,
      });
    const output = path(required("out"));
    const assetRoot = value("asset-root")
      ? path(value("asset-root")!)
      : fileURLToPath(new URL("../../soundbench/public/", import.meta.url));
    const packet = await prepareAudition(inputs, output, { assetRoot });
    return {
      ok: true,
      path: output,
      auditionId: packet.auditionId,
      status: "audio-prepared",
      modelAudioInput: "unknown",
      entries: packet.entries.map((e) => ({
        entry: e.key,
        wav: resolve(output, e.media.filename),
        sha256: e.media.sha256,
        durationSeconds: e.media.frames / e.media.sampleRate,
        range: e.range,
        selection: e.selection,
        measurements: e.measurements,
      })),
      next: "Read audition.json for exact source/sound/time mapping. Use the host's audio input when available; otherwise inspect rendered measurements and state that basis. respond is optional; no score or revision is required.",
    };
  }
  if (command === "respond") {
    const packet = await verifyAuditionDirectory(inputPath);
    if ((value("start") === undefined) !== (value("end") === undefined))
      throw new Error(
        "Response focus requires both --start and --end, relative to the delivered clip.",
      );
    const response = sealResponse(packet, {
      entry: (value("entry") ?? "a") as "a" | "b",
      observer: required("observer"),
      basis: required("basis").split(",") as MusicalResponse["basis"],
      message: required("message"),
      ...(value("start") !== undefined
        ? {
            focus: {
              startSeconds: Number(value("start")),
              endSeconds: Number(value("end")),
            },
          }
        : {}),
      ...(value("hypothesis") ? { hypothesis: value("hypothesis") } : {}),
      ...(value("experiment") ? { experiment: value("experiment") } : {}),
    });
    const output = path(required("out"));
    await writeJson(output, response);
    return {
      ok: true,
      path: output,
      responseId: response.responseId,
      auditionId: response.auditionId,
      access: response.access,
    };
  }
  if (command === "share") {
    const output = path(required("out"));
    const manifest = await createShare(inputPath, output, {
      includeArtifact: values["include-artifact"] === true,
      attribution: required("attribution"),
      rights: required("rights"),
      invitation: {
        response: (value("invitation") ??
          "welcome") as ShareManifest["invitation"]["response"],
        ...(value("message") ? { message: value("message") } : {}),
      },
      responses: ((values.response ?? []) as string[]).map(path),
    });
    return {
      ok: true,
      path: output,
      shareId: manifest.shareId,
      status: "local-package-created",
      published: false,
      included: manifest.files.map((f) => f.filename),
      next: "Review share.json and every selected artifact/caption/response before explicit delivery. This command did not upload or send anything. The receiver can run refrain receive <directory>.",
    };
  }
  return receiveShare(
    inputPath,
    value("out") ? path(value("out")!) : undefined,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    console.log(
      JSON.stringify(
        await runCorrespondenceCli(
          process.argv.slice(2),
          process.env.INIT_CWD ?? process.cwd(),
        ),
        null,
        process.argv.includes("--json") ? undefined : 2,
      ),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      }),
    );
    process.exitCode = 1;
  }
}
