import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRefrainArtifactV3 } from "@refrain/renderer/portable";
import { createRootReceiptV1 } from "@refrain/renderer/v1";
import type { AirSourceV1 } from "@refrain/air-schema/v1";
import {
  F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
  F_LUMINOUS_HYBRID_PERFORMANCE_BINDING,
} from "@refrain/soundpack";
import { verifyArtifactForPresentation } from "./presentation-envelope.js";
const source = JSON.parse(
  readFileSync("fixtures/air-v1/synthetic-counterpulse.air.json", "utf8"),
) as AirSourceV1;
function document(defaultBinding = true) {
  return createRefrainArtifactV3({
    source,
    receipt: createRootReceiptV1(source),
    performanceBindings: [
      F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
      F_LUMINOUS_HYBRID_PERFORMANCE_BINDING,
    ],
    ...(defaultBinding
      ? { defaultBindingId: F_SYNTHETIC_BEAT_PERFORMANCE_BINDING.id }
      : {}),
    caption: "",
    renderReceipts: [],
    projections: [],
  });
}
describe("complete portable document at the presentation boundary", () => {
  it("retains every carried binding, evidence field and empty caption", () => {
    const original = document();
    const result = verifyArtifactForPresentation(original);
    expect(result).toMatchObject({
      ok: true,
      artifact: { portableArtifact: original, caption: "" },
    });
  });
  it("opens an ambiguous valid document for inspection without inventing a default", () => {
    const original = document(false);
    const result = verifyArtifactForPresentation(original);
    expect(result).toMatchObject({
      ok: true,
      artifact: { portableArtifact: original },
    });
    if (result.ok) expect(result.artifact.performanceBinding).toBeUndefined();
  });
  it("opens an unbound document for inspection and saving", () => {
    const original = createRefrainArtifactV3({
      source,
      receipt: createRootReceiptV1(source),
    });
    expect(verifyArtifactForPresentation(original)).toMatchObject({
      ok: true,
      artifact: { portableArtifact: original },
    });
  });
});

it("preserves real export evidence and both production treatments through audition and handoff", async () => {
  const { mkdtemp, readFile, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { resolve, join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const { applyProduction, initProduction } = await import("./production.js");
  const { portableArtifactForView, withAuditionBinding } =
    await import("@refrain/renderer/artifact-document");
  const { createRefrainSelectionHandoff, createRefrainSelection } =
    await import("@refrain/renderer/selection");
  const { buildStructureViewModel } =
    await import("@refrain/renderer/view-model");
  const root = await mkdtemp(join(tmpdir(), "refrain-document-test-"));
  try {
    const input = join(root, "root.refrain.json");
    await writeFile(
      input,
      JSON.stringify(
        createRefrainArtifactV3({
          source,
          receipt: createRootReceiptV1(source),
          performanceBinding: F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
          caption: "",
        }),
      ),
    );
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          resolve("bin/refrain.mjs"),
          "export",
          input,
          "--out",
          join(root, "export"),
          "--json",
        ],
        { encoding: "utf8" },
      ),
    );
    const exported = JSON.parse(
      await readFile(join(result.directory, result.files.artifact), "utf8"),
    );
    const settings = initProduction(exported, "document-treatment@1");
    settings.scene.master.gainDb -= 2;
    const produced = applyProduction(exported, settings);
    expect(produced.performanceBindings).toHaveLength(2);
    expect(produced.renderReceipts!.length).toBeGreaterThan(0);
    expect(produced.projections!.length).toBeGreaterThan(0);
    const originalBytes = JSON.stringify(produced);
    const view = verifyArtifactForPresentation(produced);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    const audition = withAuditionBinding(
      view.artifact,
      F_SYNTHETIC_BEAT_PERFORMANCE_BINDING.id,
    );
    expect(portableArtifactForView(audition)).toEqual(produced);
    const structure = buildStructureViewModel(
      audition.source,
      audition.compiled,
      audition.receipt,
    );
    const section = structure.sections[0]!;
    const handoff = createRefrainSelectionHandoff(
      createRefrainSelection(structure, "section", section.anchor),
      portableArtifactForView(audition),
    );
    expect(handoff.parentArtifact).toEqual(produced);
    expect(JSON.stringify(produced)).toBe(originalBytes);
    expect(
      verifyArtifactForPresentation(portableArtifactForView(audition)),
    ).toMatchObject({
      ok: true,
      artifact: { performanceBinding: { id: settings.id } },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

it("preserves a legacy unbound generation and rejects invalid or unknown requests", async () => {
  const { hum } = await import("@refrain/mcp-server/hum");
  const { portableArtifactForView } =
    await import("@refrain/renderer/artifact-document");
  const oldSource = JSON.parse(
    readFileSync("fixtures/valid/returning-home.air.json", "utf8"),
  );
  const result = hum({ air: oldSource });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const legacy = {
    format: "refrain-artifact@0-experimental",
    source: result.source,
    receipt: result.receipt,
    caption: "",
  };
  const presented = verifyArtifactForPresentation(legacy);
  expect(presented.ok).toBe(true);
  if (!presented.ok) return;
  expect(portableArtifactForView(presented.artifact)).toEqual(legacy);
  expect(verifyArtifactForPresentation(legacy, "invented-sound").ok).toBe(
    false,
  );
  const previewed = verifyArtifactForPresentation(
    legacy,
    F_SYNTHETIC_BEAT_PERFORMANCE_BINDING.id,
  );
  expect(previewed).toMatchObject({
    ok: true,
    artifact: {
      performanceBinding: { id: F_SYNTHETIC_BEAT_PERFORMANCE_BINDING.id },
      portableArtifact: legacy,
    },
  });
  if (previewed.ok)
    expect(portableArtifactForView(previewed.artifact)).toEqual(legacy);
  expect(
    verifyArtifactForPresentation({
      ...legacy,
      source: { ...oldSource, title: "tampered" },
    }).ok,
  ).toBe(false);
});
