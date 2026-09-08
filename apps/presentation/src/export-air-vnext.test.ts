import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseAir } from "@refrain/air-schema";
import {
  AIR_V1_FORMAT,
  createAirVocabularyClosure,
  type AirSourceV1,
} from "@refrain/air-schema/v1";
import {
  createRefrainArtifactV2,
  parseRefrainArtifact,
  receiptIdOf,
  sourceRevisionOf,
  stringifyRefrainArtifact,
  type AirReceipt,
} from "@refrain/renderer";
import { SOUND_REGISTRY } from "@refrain/soundpack";
import { CORE_AUTHORING_VOCABULARY } from "@refrain/soundpack/vnext";
import {
  SYNTHETIC_SPICES_PROFILE,
  SYNTHETIC_SPICES_SCENE,
} from "@refrain/soundpack/proof-packs";
import { createPerformanceBindingV1 } from "@refrain/soundpack/vnext";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("vnext presentation export", () => {
  it("preserves Binding@1 through plan@4, receipt@3, and artifact@2", async () => {
    const source = parseAir({
      format: "air@0-experimental",
      title: "Vnext export proof",
      tempo: 120,
      meter: "4/4",
      motifs: {},
      voices: [
        {
          id: "air",
          instrument: "air_pad",
          role: "harmony",
          part: "C4/1",
        },
        {
          id: "pulse",
          instrument: "rhythm_pulse",
          role: "percussion",
          part: "C2/4 r/4 C2/4 r/4",
        },
      ],
    }).source;
    if (!source) throw new Error("The vnext export proof AIR is invalid.");
    const sourceRevision = sourceRevisionOf(source);
    const receiptCore = {
      format: "refrain-receipt@0-experimental" as const,
      sourceRevision,
      airId: sourceRevision,
      sourceFormat: source.format,
      verification: {
        contract: "musical-relation@0-experimental" as const,
        status: "not_applicable" as const,
        motifLinks: [],
      },
    };
    const receipt: AirReceipt = {
      ...receiptCore,
      receiptId: receiptIdOf(receiptCore),
    };
    const binding = createPerformanceBindingV1({
      id: "vnext-export-proof@1",
      requiredInstrumentIds: ["air_pad", "rhythm_pulse"],
      soundProfile: SYNTHETIC_SPICES_PROFILE,
      renderScene: SYNTHETIC_SPICES_SCENE,
      manifest: SOUND_REGISTRY,
    });
    const inputArtifact = createRefrainArtifactV2({
      source,
      receipt,
      performanceBinding: binding,
    });
    const temporaryRoot = await mkdtemp(join(tmpdir(), "vnext-export-test-"));
    temporaryRoots.push(temporaryRoot);
    const inputPath = resolve(temporaryRoot, "input.refrain.json");
    const outputPath = resolve(temporaryRoot, "output");
    await writeFile(inputPath, stringifyRefrainArtifact(inputArtifact));

    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(
      command,
      ["run", "export:air", "--", inputPath, `--out=${outputPath}`],
      { cwd: resolve("."), stdio: "pipe" },
    );
    let stderr = "";
    child.stderr.on("data", (bytes) => {
      stderr += String(bytes);
    });
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", resolveExit);
    });
    expect(exitCode, stderr).toBe(0);

    const files = (await readdir(outputPath)).sort();
    expect(files).toHaveLength(10);
    const artifactName = files.find((name) => name.endsWith(".refrain.json"));
    const receiptsName = files.find((name) =>
      name.endsWith(".render-receipts.json"),
    );
    if (!artifactName || !receiptsName)
      throw new Error("The vnext export omitted exact evidence files.");
    const parsed = parseRefrainArtifact(
      JSON.parse(await readFile(resolve(outputPath, artifactName), "utf8")),
    );
    expect(parsed).toMatchObject({
      ok: true,
      artifact: {
        format: "refrain-artifact@2-experimental",
        performanceBindings: [
          { format: "refrain-performance-binding@1-experimental" },
        ],
        renderReceipts: [
          { format: "refrain-render-receipt@3-experimental" },
          { format: "refrain-render-receipt@3-experimental" },
        ],
      },
    });
    const receiptSet = JSON.parse(
      await readFile(resolve(outputPath, receiptsName), "utf8"),
    ) as { format?: unknown };
    expect(receiptSet.format).toBe("refrain-render-receipts@2-experimental");
  }, 30_000);

  it("exports mixed-meter AIR@1 through compiled-air@1, RenderReceipt@3, and Artifact@3", async () => {
    const source: AirSourceV1 = {
      format: AIR_V1_FORMAT,
      title: "Five then seven",
      conductor: {
        tempo: 90,
        meters: [
          { bar: 1, meter: "5/8" },
          { bar: 2, meter: "7/8" },
        ],
      },
      vocabulary: createAirVocabularyClosure({
        id: "export-core-language@0",
        instruments: CORE_AUTHORING_VOCABULARY.instruments.map(
          (instrument) => ({
            id: instrument.id,
            label: instrument.label,
            family: instrument.family,
            midiMin: instrument.midiMin,
            midiMax: instrument.midiMax,
            status: instrument.status,
            authoringMeaning: instrument.authoringMeaning,
            ...(instrument.supportedNotes === undefined
              ? {}
              : { supportedNotes: Array.from(instrument.supportedNotes) }),
          }),
        ),
        techniques: [],
      }),
      motifs: {},
      voices: [
        {
          id: "piano",
          instrument: "prism_lead",
          role: "lead",
          part: "C4/4 D4/4 E4/8 | F4/4 G4/4 A4/4 B4/8",
        },
      ],
      sections: [
        { id: "five", startBar: 1, bars: 1 },
        { id: "seven", startBar: 2, bars: 1 },
      ],
    };
    const temporaryRoot = await mkdtemp(join(tmpdir(), "air-v1-export-test-"));
    temporaryRoots.push(temporaryRoot);
    const inputPath = resolve(temporaryRoot, "input.air.json");
    const outputPath = resolve(temporaryRoot, "output");
    await writeFile(inputPath, `${JSON.stringify(source, null, 2)}\n`);

    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(
      command,
      [
        "run",
        "export:air",
        "--",
        inputPath,
        "--binding=f-synthetic-beat@0",
        `--out=${outputPath}`,
      ],
      { cwd: resolve("."), stdio: "pipe" },
    );
    let stderr = "";
    child.stderr.on("data", (bytes) => {
      stderr += String(bytes);
    });
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", resolveExit);
    });
    expect(exitCode, stderr).toBe(0);

    const files = (await readdir(outputPath)).sort();
    const artifactName = files.find((name) => name.endsWith(".refrain.json"));
    const manifestName = files.find((name) =>
      name.endsWith(".provenance.json"),
    );
    const midiName = files.find((name) => name.endsWith(".mid"));
    if (!artifactName || !manifestName || !midiName)
      throw new Error("AIR@1 export omitted a canonical projection.");
    expect(
      parseRefrainArtifact(
        JSON.parse(await readFile(resolve(outputPath, artifactName), "utf8")),
      ),
    ).toMatchObject({
      ok: true,
      artifact: {
        format: "refrain-artifact@3-experimental",
        source: { format: AIR_V1_FORMAT },
        receipt: { format: "refrain-receipt@1-experimental" },
        renderReceipts: [
          { format: "refrain-render-receipt@3-experimental" },
          { format: "refrain-render-receipt@3-experimental" },
        ],
      },
    });
    const manifest = JSON.parse(
      await readFile(resolve(outputPath, manifestName), "utf8"),
    ) as { format?: unknown; compilerFormat?: unknown };
    expect(manifest).toMatchObject({
      format: "refrain-export-manifest@4-experimental",
      compilerFormat: "compiled-air@1-experimental",
    });
    const midi = Array.from(await readFile(resolve(outputPath, midiName)));
    const signatures: number[][] = [];
    for (let index = 0; index < midi.length - 6; index += 1)
      if (midi[index] === 0xff && midi[index + 1] === 0x58)
        signatures.push(midi.slice(index, index + 7));
    expect(signatures).toEqual([
      [0xff, 0x58, 0x04, 5, 3, 24, 8],
      [0xff, 0x58, 0x04, 7, 3, 24, 8],
    ]);
  }, 30_000);
});
