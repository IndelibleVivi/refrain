import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AirSource } from "@refrain/air-schema";
import type { AirSourceV1 } from "@refrain/air-schema/v1";
import {
  createPerformancePlan,
  createRenderReceipt,
} from "@refrain/audio-engine";
import { compileAir } from "@refrain/compiler";
import { compileAirV1 } from "@refrain/compiler/v1";
import {
  LEGACY_REFRAIN_ARTIFACT_FORMAT,
  REFRAIN_ARTIFACT_FORMAT,
  createRefrainArtifact,
  createRefrainArtifactV3,
  parseRefrainArtifact,
  receiptIdentityJson,
  refrainArtifactShapeIsValid,
  stringifyRefrainArtifact,
  type AirReceipt,
  type ContinuationRelation,
  type MotifLinkEvidence,
  type RefrainArtifact,
  type RefrainArtifactV3,
} from "@refrain/renderer";
import type { RelationEvidenceAssertionsV1 } from "@refrain/renderer/v1";
import {
  DEFAULT_RENDER_SCENE,
  G3A_AUDITION_SOUND_PROFILE,
  G3B_VCSL_LISTENING_PERFORMANCE_BINDING,
  SOUND_REGISTRY,
  candidateContentSha256,
  createPerformanceBinding,
  createSoundPalette,
  resolvePerformanceBindingAgainstRuntime,
  soundObjectContentSha256,
  validatePerformanceBinding,
  type PerformanceBinding,
  type SoundProfile,
  type SoundpackManifest,
} from "@refrain/soundpack";
import { describe, expect, it } from "vitest";
import { hum } from "./hum.js";
import { humV1 } from "./hum-v1.js";

const fixture = JSON.parse(
  readFileSync(resolve("fixtures/valid/returning-home.air.json"), "utf8"),
) as AirSource;
const v1Fixture = JSON.parse(
  readFileSync(resolve("fixtures/air-v1/paper-waltz.air.json"), "utf8"),
) as AirSourceV1;
const extended = (source: AirSource, title: string): AirSource => ({
  ...source,
  title,
  voices: source.voices.map((voice) =>
    "part" in voice && typeof voice.part === "string"
      ? { ...voice, part: `${voice.part} | r/1` }
      : voice,
  ),
});

async function continueInFreshServer(
  parent: RefrainArtifact,
  child: AirSource,
  relation: ContinuationRelation,
  motifLinks?: MotifLinkEvidence[],
) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      resolve("node_modules/tsx/dist/cli.mjs"),
      resolve("packages/mcp-server/src/stdio.ts"),
    ],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({
    name: "refrain-portable-roundtrip",
    version: "0.0.0-experimental",
  });
  try {
    await client.connect(transport);
    return await client.callTool({
      name: "hum",
      arguments: {
        air: child,
        from: {
          air: parent.source,
          receipt: parent.receipt,
          relation,
          expectedSourceRevision: parent.receipt.sourceRevision,
          ...(motifLinks ? { motifLinks } : {}),
        },
      },
    });
  } finally {
    await client.close();
  }
}

async function continueV1InFreshServer(
  parent: RefrainArtifactV3,
  child: AirSourceV1,
  evidence: RelationEvidenceAssertionsV1,
) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      resolve("node_modules/tsx/dist/cli.mjs"),
      resolve("packages/mcp-server/src/stdio.ts"),
    ],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({
    name: "refrain-v1-portable-roundtrip",
    version: "0.0.0-experimental",
  });
  try {
    await client.connect(transport);
    return await client.callTool({
      name: "hum",
      arguments: {
        air: child,
        from: {
          parentArtifact: parent,
          relation: "variation",
          expectedSourceRevision: parent.receipt.sourceRevision,
          evidence,
        },
      },
    });
  } finally {
    await client.close();
  }
}

function exportAndReopen(
  result: Extract<ReturnType<typeof hum>, { ok: true }>,
): RefrainArtifact {
  const reopened = JSON.parse(
    stringifyRefrainArtifact(createRefrainArtifact(result)),
  ) as unknown;
  expect(refrainArtifactShapeIsValid(reopened)).toBe(true);
  if (!refrainArtifactShapeIsValid(reopened)) {
    throw new Error("The exported artifact did not reopen.");
  }
  expect(reopened.format).toBe("refrain-artifact@1-experimental");
  if (reopened.format === "refrain-artifact@1-experimental") {
    expect(reopened.defaultBindingId).toBe(result.performanceBinding.id);
    expect(reopened.performanceBindings).toContainEqual(
      result.performanceBinding,
    );
  }
  return reopened;
}

function planFor(source: AirSource, binding: PerformanceBinding) {
  const compiled = compileAir(source).compiled;
  if (!compiled) throw new Error("Expected the portable fixture to compile.");
  return createPerformancePlan(compiled, { performanceBinding: binding });
}

function verifiedAssets(plan: ReturnType<typeof planFor>) {
  return plan.requiredAssets.map(({ assetId, bytes, sha256 }) => ({
    assetId,
    bytes,
    sha256,
  }));
}

function unavailablePerformanceFixture(): PerformanceBinding {
  const registry = structuredClone(SOUND_REGISTRY) as SoundpackManifest;
  const candidate = registry.candidates.find(
    (item) => item.id === "warm-piano-generaluser",
  )!;
  candidate.id = "historical-warm-piano-generaluser";
  registry.contentSha256 = soundObjectContentSha256(registry);
  const profileCore = {
    format: G3A_AUDITION_SOUND_PROFILE.format,
    id: "historical-audition@1",
    vocabulary: G3A_AUDITION_SOUND_PROFILE.vocabulary,
    selections: {
      ...G3A_AUDITION_SOUND_PROFILE.selections,
      warm_piano: {
        candidateChain: [
          {
            id: candidate.id,
            sha256: candidateContentSha256(candidate, registry),
          },
        ],
        fallbackPolicy: "strict" as const,
      },
    },
  };
  const profile: SoundProfile = {
    ...profileCore,
    contentSha256: soundObjectContentSha256(profileCore),
  };
  const palette = createSoundPalette({
    id: "historical-transparent@1",
    status: "engineering",
    soundProfile: profile,
    renderScene: DEFAULT_RENDER_SCENE,
    authoringGuide: "Unavailable exact-candidate fixture.",
  });
  return createPerformanceBinding(
    {
      id: "historical-transparent@1",
      soundProfile: profile,
      renderScene: DEFAULT_RENDER_SCENE,
      soundPalette: palette,
    },
    registry,
  );
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalValue(record[key])]),
  );
}

function reidentifyRenderReceipt(receipt: Record<string, unknown>) {
  const { renderReceiptId: _renderReceiptId, ...core } = receipt;
  return {
    ...core,
    renderReceiptId: `sha256:${createHash("sha256")
      .update(JSON.stringify(canonicalValue(core)))
      .digest("hex")}`,
  };
}

function reidentifyMusicalReceipt(receipt: AirReceipt): AirReceipt {
  const { receiptId: _receiptId, ...core } = receipt;
  return {
    ...core,
    receiptId: `sha256:${createHash("sha256")
      .update(receiptIdentityJson(core))
      .digest("hex")}`,
  };
}

function artifactsForBothVersions(
  source: AirSource,
  receipt: AirReceipt,
  binding: PerformanceBinding,
): RefrainArtifact[] {
  return [
    {
      format: LEGACY_REFRAIN_ARTIFACT_FORMAT,
      source,
      receipt,
    },
    {
      format: REFRAIN_ARTIFACT_FORMAT,
      source,
      receipt,
      performanceBindings: [binding],
      defaultBindingId: binding.id,
    },
  ];
}

describe("portable Refrain artifacts", () => {
  it("keeps strict artifact v0 import compatibility while exporting v1", () => {
    const root = hum({ air: fixture });
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const legacy = {
      format: LEGACY_REFRAIN_ARTIFACT_FORMAT,
      source: root.source,
      receipt: root.receipt,
    };
    expect(refrainArtifactShapeIsValid(legacy)).toBe(true);
    expect(createRefrainArtifact(root).format).toBe(
      "refrain-artifact@1-experimental",
    );
  });

  it("rejects tampered binding content and dangling projection evidence", () => {
    const root = hum({ air: fixture });
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const artifact = createRefrainArtifact(root);
    const tampered = structuredClone(artifact);
    tampered.performanceBindings[0]!.renderScene.masterGainDb = -12;
    expect(refrainArtifactShapeIsValid(tampered)).toBe(false);

    const dangling = {
      ...artifact,
      projections: [
        {
          format: "refrain-projection-reference@0-experimental",
          kind: "native-wav",
          filename: "unverified.native.wav",
          renderReceiptId: `sha256:${"0".repeat(64)}`,
        },
      ],
    };
    expect(refrainArtifactShapeIsValid(dangling)).toBe(false);
  });

  it("rejects crossed and internally inconsistent musical receipts in artifact v0 and v1", () => {
    const root = hum({ air: fixture });
    const independent = hum({
      air: { ...fixture, title: "Independent identity pair" },
    });
    expect(root.ok && independent.ok).toBe(true);
    if (!root.ok || !independent.ok) return;
    expect(root.receipt.sourceRevision).not.toBe(
      independent.receipt.sourceRevision,
    );
    expect(root.receipt.receiptId).not.toBe(independent.receipt.receiptId);

    const verified = hum({
      air: extended(root.source, "Verified evidence child"),
      from: {
        air: root.source,
        receipt: root.receipt,
        relation: "extend",
      },
    });
    const lineaged = hum({
      air: { ...fixture, title: "Declared lineage child" },
      from: {
        air: root.source,
        receipt: root.receipt,
        relation: "reply",
      },
    });
    expect(verified.ok && lineaged.ok).toBe(true);
    if (!verified.ok || !lineaged.ok) return;

    const staleEvidence = reidentifyMusicalReceipt({
      ...verified.receipt,
      verification: {
        ...verified.receipt.verification,
        evidenceId: `sha256:${"0".repeat(64)}`,
      },
    });
    const invalidRootStatus = reidentifyMusicalReceipt({
      ...root.receipt,
      verification: {
        ...root.receipt.verification,
        status: "declared",
      },
    });
    const invalidLineageStatus = reidentifyMusicalReceipt({
      ...lineaged.receipt,
      verification: {
        ...lineaged.receipt.verification,
        status: "not_applicable",
      },
    });
    const invalidCases = [
      {
        name: "crossed source and receipt",
        source: root.source,
        receipt: independent.receipt,
      },
      {
        name: "stale receiptId",
        source: root.source,
        receipt: {
          ...root.receipt,
          receiptId: `sha256:${"0".repeat(64)}`,
        },
      },
      {
        name: "stale evidenceId",
        source: verified.source,
        receipt: staleEvidence,
      },
      {
        name: "invalid root status",
        source: root.source,
        receipt: invalidRootStatus,
      },
      {
        name: "invalid lineage status",
        source: lineaged.source,
        receipt: invalidLineageStatus,
      },
    ] as const;

    for (const invalid of invalidCases) {
      const artifacts = artifactsForBothVersions(
        invalid.source,
        invalid.receipt,
        root.performanceBinding,
      );
      expect(artifacts.map((artifact) => artifact.format)).toEqual([
        LEGACY_REFRAIN_ARTIFACT_FORMAT,
        REFRAIN_ARTIFACT_FORMAT,
      ]);
      for (const artifact of artifacts) {
        expect(parseRefrainArtifact(artifact), invalid.name).toMatchObject({
          ok: false,
        });
      }
      expect(
        () =>
          createRefrainArtifact({
            source: invalid.source,
            receipt: invalid.receipt,
            performanceBinding: root.performanceBinding,
          }),
        invalid.name,
      ).toThrow();
    }
  });

  it("preserves canonical continuity when a historical soundpack is not installed", () => {
    const root = hum({ air: fixture });
    expect(root.ok).toBe(true);
    if (!root.ok) return;

    const historicalBinding = unavailablePerformanceFixture();
    expect(
      validatePerformanceBinding(historicalBinding).length,
    ).toBeGreaterThan(0);

    const historicalArtifact = {
      format: "refrain-artifact@1-experimental",
      source: root.source,
      receipt: root.receipt,
      performanceBindings: [historicalBinding],
      defaultBindingId: historicalBinding.id,
    } as const;
    expect(parseRefrainArtifact(historicalArtifact)).toMatchObject({
      ok: true,
      continuity: "valid",
    });
    expect(refrainArtifactShapeIsValid(historicalArtifact)).toBe(true);
    expect(
      resolvePerformanceBindingAgainstRuntime(historicalBinding),
    ).toMatchObject({
      status: "unavailable",
      reason: "candidate-not-installed",
    });

    const continued = hum({
      air: { ...fixture, title: "Continued from historical sound" },
      from: {
        air: historicalArtifact.source,
        receipt: historicalArtifact.receipt,
        relation: "revise",
      },
    });
    expect(continued.ok).toBe(true);
  });

  it("rejects receipts whose exact binding is absent from the artifact", () => {
    const root = hum({ air: fixture });
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const foreignPlan = planFor(
      root.source,
      G3B_VCSL_LISTENING_PERFORMANCE_BINDING,
    );
    const foreignReceipt = createRenderReceipt(foreignPlan, {
      sourceRevision: root.receipt.sourceRevision,
      adapter: "wav",
      sampleRate: 44_100,
      outputSha256: `sha256:${"d".repeat(64)}`,
      outputAmplitude: { mode: "native-gain" },
      verifiedAssets: verifiedAssets(foreignPlan),
    });
    expect(() =>
      createRefrainArtifact({
        ...root,
        renderReceipts: [foreignReceipt],
      }),
    ).toThrow(/PerformanceBinding/);
  });

  it("rejects re-identified candidate selections outside the bound profile chain", () => {
    const root = hum({ air: fixture });
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const plan = planFor(root.source, root.performanceBinding);
    const receipt = createRenderReceipt(plan, {
      sourceRevision: root.receipt.sourceRevision,
      adapter: "wav",
      sampleRate: 44_100,
      outputSha256: `sha256:${"c".repeat(64)}`,
      outputAmplitude: { mode: "native-gain" },
      verifiedAssets: verifiedAssets(plan),
    });
    const forged = reidentifyRenderReceipt({
      ...receipt,
      selectedCandidates: receipt.selectedCandidates.map((candidate, index) =>
        index === 0
          ? { ...candidate, instrumentId: "unbound_instrument" }
          : candidate,
      ),
    });
    expect(() =>
      createRefrainArtifact({
        ...root,
        renderReceipts: [forged as typeof receipt],
      }),
    ).toThrow(/outside the .* SoundProfile chain/);
  });

  it("rejects projection kinds that contradict their render receipt", () => {
    const root = hum({ air: fixture });
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const plan = planFor(root.source, root.performanceBinding);
    const native = createRenderReceipt(plan, {
      sourceRevision: root.receipt.sourceRevision,
      adapter: "wav",
      sampleRate: 44_100,
      outputSha256: `sha256:${"e".repeat(64)}`,
      outputAmplitude: { mode: "native-gain" },
      verifiedAssets: verifiedAssets(plan),
    });
    const matched = createRenderReceipt(plan, {
      sourceRevision: root.receipt.sourceRevision,
      adapter: "wav",
      sampleRate: 44_100,
      outputSha256: `sha256:${"a".repeat(64)}`,
      outputAmplitude: {
        mode: "audition-peak-matched",
        targetPeak: 1,
        contract: "refrain-audition-peak-match@0-experimental",
      },
      verifiedAssets: verifiedAssets(plan),
    });
    const midi = createRenderReceipt(plan, {
      sourceRevision: root.receipt.sourceRevision,
      adapter: "midi",
      outputSha256: `sha256:${"b".repeat(64)}`,
    });
    const midiWithoutOutput = createRenderReceipt(plan, {
      sourceRevision: root.receipt.sourceRevision,
      adapter: "midi",
    });
    const projection = (
      kind: "midi" | "native-wav" | "audition-matched-wav",
      receipt: typeof native,
    ) => ({
      format: "refrain-projection-reference@0-experimental" as const,
      kind,
      filename: `${kind}.bin`,
      renderReceiptId: receipt.renderReceiptId,
    });

    for (const [receipt, kind] of [
      [midi, "native-wav"],
      [native, "audition-matched-wav"],
      [matched, "native-wav"],
      [midiWithoutOutput, "midi"],
    ] as const) {
      expect(() =>
        createRefrainArtifact({
          ...root,
          renderReceipts: [receipt],
          projections: [projection(kind, receipt)],
        }),
      ).toThrow(/projection/i);
    }
  });

  it("continues an exported root in a fresh MCP server process", async () => {
    const root = hum({ air: fixture, caption: "Keep this one." });
    expect(root.ok).toBe(true);
    if (!root.ok) return;

    const artifact = exportAndReopen(root);
    const response = await continueInFreshServer(
      artifact,
      { ...fixture, title: "A portable revision" },
      "revise",
    );
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      ok: true,
      receipt: {
        airId: root.receipt.airId,
        lineage: {
          relation: "revise",
          parentReceiptId: root.receipt.receiptId,
        },
      },
    });
  });

  it("reconstructs two generations without process-local history", async () => {
    const root = hum({ air: fixture });
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const child = hum({
      air: { ...fixture, title: "Second generation" },
      from: {
        air: root.source,
        receipt: root.receipt,
        relation: "revise",
      },
    });
    expect(child.ok).toBe(true);
    if (!child.ok) return;

    const artifact = exportAndReopen(child);
    const response = await continueInFreshServer(
      artifact,
      extended(child.source, "Third generation"),
      "extend",
    );
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      ok: true,
      receipt: {
        airId: root.receipt.airId,
        lineage: {
          relation: "extend",
          parentReceiptId: child.receipt.receiptId,
          parentAirId: root.receipt.airId,
        },
        verification: { status: "verified" },
      },
    });
  });

  it("re-verifies motif evidence in a fresh MCP server process", async () => {
    const root = hum({ air: fixture });
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const artifact = exportAndReopen(root);
    const child: AirSource = {
      ...fixture,
      title: "Portable verified variation",
      motifs: { return_low: "F#4/8 G#4/8 B4/4 r/2" },
      voices: fixture.voices.map((voice) =>
        voice.id === "lead" && "part" in voice && typeof voice.part === "string"
          ? { ...voice, part: "@return_low | r/1 | @return_low | @return_low" }
          : voice,
      ),
    };
    const response = await continueInFreshServer(artifact, child, "variation", [
      {
        parent: "return",
        child: "return_low",
        parentAnchor: "lead:part:1:return",
        childAnchor: "lead:part:1:return_low",
        transform: {
          transpose: -3,
          stretch: 1,
          invert: false,
          retrograde: false,
        },
      },
    ]);
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      ok: true,
      receipt: {
        verification: {
          status: "verified",
          motifLinks: [{ parent: "return", child: "return_low" }],
        },
      },
    });
  });

  it("re-verifies AIR@1 relational evidence in a fresh MCP server process", async () => {
    const root = humV1({ air: v1Fixture, caption: "Keep its empty chair." });
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const reopened = JSON.parse(
      stringifyRefrainArtifact(createRefrainArtifactV3(root)),
    ) as unknown;
    expect(refrainArtifactShapeIsValid(reopened)).toBe(true);
    if (
      !refrainArtifactShapeIsValid(reopened) ||
      reopened.format !== "refrain-artifact@3-experimental"
    )
      throw new Error(
        "The AIR@1 parent artifact did not reopen as Artifact@3.",
      );

    const child = structuredClone(v1Fixture);
    child.title = "The place answers in another key";
    child.motifs!.turn = "B4/4 D5/4 F#5/4";
    const parentCompiled = compileAirV1(v1Fixture).compiled;
    const childCompiled = compileAirV1(child).compiled;
    if (!parentCompiled || !childCompiled)
      throw new Error("Expected both AIR@1 generations to compile.");
    const parentOccurrence = parentCompiled.motifOccurrences.find(
      (occurrence) => occurrence.motif === "turn",
    );
    const childOccurrence = childCompiled.motifOccurrences.find(
      (occurrence) => occurrence.motif === "turn",
    );
    if (!parentOccurrence || !childOccurrence)
      throw new Error("Expected portable motif anchors in both generations.");

    const response = await continueV1InFreshServer(reopened, child, {
      motifLinks: [
        {
          parent: "turn",
          child: "turn",
          parentAnchor: parentOccurrence.anchor,
          childAnchor: childOccurrence.anchor,
          transform: {
            transpose: 2,
            stretch: 1,
            invert: false,
            retrograde: false,
          },
        },
      ],
    });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      ok: true,
      artifact: {
        format: "refrain-artifact@3-experimental",
        source: { format: "air@1-experimental" },
        receipt: {
          format: "refrain-receipt@1-experimental",
          lineage: {
            relation: "variation",
            parentReceiptId: root.receipt.receiptId,
            parentAirId: root.receipt.airId,
          },
          verification: {
            contract: "musical-relation@1-experimental",
            status: "verified",
            motifLinks: [{ parent: "turn", child: "turn" }],
          },
        },
      },
    });
    expect(
      (
        response.structuredContent as {
          artifact: { receipt: { airId: string } };
        }
      ).artifact.receipt.airId,
    ).not.toBe(root.receipt.airId);
  });
});
