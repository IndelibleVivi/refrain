import {
  humSuccessOutputSchemaV1,
  humAnySuccessOutputSchema,
} from "./contract.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createRefrainArtifactV3,
  parseRefrainArtifact,
} from "@refrain/renderer/portable";
import { createRootReceiptV1 } from "@refrain/renderer/v1";
import type { AirSourceV1 } from "@refrain/air-schema/v1";
import {
  F_SYNTHETIC_BEAT_PERFORMANCE_BINDING as base,
  SOUND_REGISTRY,
  soundObjectContentSha256,
} from "@refrain/soundpack";
import {
  CORE_AUTHORING_VOCABULARY,
  createSoundProfileV2,
  createRenderSceneV1,
  createPerformanceBindingV1,
} from "@refrain/soundpack/vnext";
import { humV1 } from "./hum-v1.js";

const source = JSON.parse(
  readFileSync("fixtures/air-v1/synthetic-counterpulse.air.json", "utf8"),
) as AirSourceV1;
const custom = createPerformanceBindingV1({
  id: "continuation-close-room@1",
  manifest: SOUND_REGISTRY,
  soundProfile: createSoundProfileV2({
    id: "continuation-profile@1",
    vocabulary: CORE_AUTHORING_VOCABULARY,
    selections: base.soundProfile.selections,
  }),
  renderScene: createRenderSceneV1({
    id: "continuation-room@1",
    master: { gainDb: -18, peakCeiling: 0.7, velocityScale: 1 },
    buses: [{ id: "mix", output: "master", processors: [] }],
    routes: [{ id: "all", bus: "mix", match: {} }],
  }),
  requiredInstrumentIds: [...new Set(source.voices.map((v) => v.instrument))],
});
const defaults = { defaultPerformanceBindingId: base.id, playbackAssets: {} };
function parent(binding = true) {
  return createRefrainArtifactV3({
    source,
    receipt: createRootReceiptV1(source),
    ...(binding ? { performanceBinding: custom } : {}),
  });
}

describe("exact continuation sound", () => {
  it("inherits the complete custom Binding@1 rather than the MCP root default", () => {
    const previous = parent();
    const bytes = JSON.stringify(previous);
    const result = humV1(
      {
        air: { ...source, title: "A revised answer" },
        from: { parentArtifact: previous, relation: "revise" },
      },
      defaults,
    );
    expect(result).toMatchObject({
      ok: true,
      performanceBinding: custom,
      performanceStatus: { status: "available" },
    });
    expect(JSON.stringify(previous)).toBe(bytes);
    if (!result.ok) return;
    expect(humSuccessOutputSchemaV1.safeParse(result).success).toBe(true);
    expect(humAnySuccessOutputSchema.safeParse(result).success).toBe(true);
    expect(
      parseRefrainArtifact(
        createRefrainArtifactV3({
          source: result.source,
          receipt: result.receipt,
          performanceBinding: result.performanceBinding,
        }),
      ).ok,
    ).toBe(true);
  });
  it("keeps an unbound parent unbound instead of inventing a sound", () => {
    const result = humV1(
      {
        air: { ...source, title: "Unbound revision" },
        from: { parentArtifact: parent(false), relation: "revise" },
      },
      defaults,
    );
    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty("performanceBinding");
    expect(result).toMatchObject({
      performanceStatus: { status: "unavailable" },
    });
  });
  it("can explicitly select an exact carried custom binding", () => {
    const result = humV1(
      {
        air: { ...source, title: "Selected answer" },
        performance: { bindingId: custom.id },
        from: { parentArtifact: parent(), relation: "reply" },
      },
      defaults,
    );
    expect(result).toMatchObject({ ok: true, performanceBinding: custom });
  });
  it("still honors an explicit built-in override and defaults new roots", () => {
    const result = humV1(
      {
        air: { ...source, title: "Different sound" },
        performance: { bindingId: base.id },
        from: { parentArtifact: parent(), relation: "revise" },
      },
      defaults,
    );
    expect(result).toMatchObject({ ok: true, performanceBinding: base });
    expect(humV1({ air: source }, defaults)).toMatchObject({
      ok: true,
      performanceBinding: base,
    });
  });
});

it("does not default an ambiguous parent and keeps a missing candidate attached", () => {
  const ambiguous = createRefrainArtifactV3({
    source,
    receipt: createRootReceiptV1(source),
    performanceBindings: [base, custom],
  });
  const result = humV1(
    {
      air: { ...source, title: "Choose later" },
      from: { parentArtifact: ambiguous, relation: "revise" },
    },
    defaults,
  );
  expect(result.ok).toBe(true);
  expect(result).not.toHaveProperty("performanceBinding");
  const unavailable = structuredClone(custom);
  // A new, internally coherent vocabulary reference is historically valid but not installed.
  unavailable.soundProfile.vocabulary.id = "historical-language@0";
  unavailable.soundProfile.contentSha256 = soundObjectContentSha256(
    unavailable.soundProfile,
  );
  unavailable.soundProfileSha256 = unavailable.soundProfile.contentSha256;
  unavailable.contentSha256 = soundObjectContentSha256(unavailable);
  const previous = createRefrainArtifactV3({
    source,
    receipt: createRootReceiptV1(source),
    performanceBinding: unavailable,
  });
  expect(
    humV1(
      {
        air: { ...source, title: "Still exact" },
        from: { parentArtifact: previous, relation: "revise" },
      },
      defaults,
    ),
  ).toMatchObject({
    ok: true,
    performanceBinding: unavailable,
    performanceStatus: { status: "unavailable" },
  });
});

it("continues a custom binding through two fresh MCP processes and explicit carried selection", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } =
    await import("@modelcontextprotocol/sdk/client/stdio.js");
  const { resolve } = await import("node:path");
  let previous = parent();
  for (const revision of [1, 2]) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        "--import",
        resolve("node_modules/tsx/dist/loader.mjs"),
        resolve("packages/mcp-server/src/stdio.ts"),
      ],
      cwd: process.cwd(),
      stderr: "pipe",
    });
    const client = new Client({ name: "exact-sound-regression", version: "1" });
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "hum",
        arguments: {
          air: { ...source, title: `Fresh session ${revision}` },
          ...(revision === 2 ? { performance: { bindingId: custom.id } } : {}),
          from: { parentArtifact: previous, relation: "revise" },
        },
      });
      expect(result.isError).not.toBe(true);
      const parsed = parseRefrainArtifact(
        (result.structuredContent as { artifact: unknown }).artifact,
      );
      expect(parsed.ok).toBe(true);
      if (
        !parsed.ok ||
        parsed.artifact.format !== "refrain-artifact@3-experimental"
      )
        throw new Error("Missing exact current artifact");
      previous = parsed.artifact;
      expect(previous.performanceBindings).toEqual([custom]);
      expect(previous.defaultBindingId).toBe(custom.id);
    } finally {
      await client.close();
    }
  }
}, 15_000);

it("delivers Binding@1 via the exact portable URL contract, without widening old envelopes", async () => {
  const { vi } = await import("vitest");
  const {
    decodeInlinePresentationRef,
    PRESENTATION_REF_FORMAT,
    REFRAIN_ARTIFACT_MEDIA_TYPE,
  } = await import("@refrain/renderer/presentation-ref");
  vi.stubEnv(
    "REFRAIN_PRESENTATION_BASE_URL",
    "https://example.invalid/refrain/",
  );
  try {
    const result = humV1(
      {
        air: { ...source, title: "Portable URL" },
        from: { parentArtifact: parent(), relation: "revise" },
      },
      defaults,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(humSuccessOutputSchemaV1.safeParse(result).success).toBe(true);
    expect(humAnySuccessOutputSchema.safeParse(result).success).toBe(true);
    expect(result.presentation).toBeDefined();
    const hash = new URLSearchParams(
      new URL(result.presentation!.url).hash.slice(1),
    );
    const decoded = decodeInlinePresentationRef({
      format: PRESENTATION_REF_FORMAT,
      mediaType: REFRAIN_ARTIFACT_MEDIA_TYPE,
      artifactSha256: hash.get("artifact")!,
      delivery: { kind: "inline", fragment: hash.get("bytes")! },
    });
    expect(decoded).toMatchObject({
      ok: true,
      artifact: { performanceBindings: [custom] },
    });
  } finally {
    vi.unstubAllEnvs();
  }
});
