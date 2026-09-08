import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AIR_V1_FORMAT,
  createAirVocabularyClosure,
  type AirSourceV1,
} from "@refrain/air-schema/v1";
import { compileAirV1 } from "@refrain/compiler/v1";
import { TEST_VOCABULARY, VALID_AIR_V1 } from "../../air-schema/src/v1.test.js";
import {
  embodimentEvidenceId,
  createEmbodimentLineage,
  createRootReceiptV1,
  musicalEvidenceIdV1,
  receiptIdentityJsonV1,
  receiptIdOfV1,
  receiptIntegrityErrorsV1,
  sourceReceiptIntegrityErrorsV1,
  verifyMusicalRelationV1,
  type AirReceiptV1,
  type EmbodimentLineage,
  type MusicalRelationVerificationV1,
} from "./v1.js";

const RELATION_VOCABULARY = createAirVocabularyClosure({
  id: "relation-language@0",
  instruments: [
    TEST_VOCABULARY.instruments[0]!,
    {
      ...TEST_VOCABULARY.instruments[0]!,
      id: "pack_voice",
      label: "Pack voice",
    },
  ],
  techniques: [],
});

function reorderObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderObjectKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, reorderObjectKeys(item)]),
  );
}

function nodeSha256Id(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function relationAir(kind: "parent" | "recurrence" | "absence"): AirSourceV1 {
  return {
    format: AIR_V1_FORMAT,
    title: kind,
    conductor: { tempo: 72, meters: [{ bar: 1, meter: "4/4" }] },
    vocabulary: RELATION_VOCABULARY,
    motifs: { seed: kind === "parent" ? "C3/2" : "C5/4 D5/4" },
    voices: [
      {
        id: "lead",
        instrument: kind === "parent" ? "warm_piano" : "pack_voice",
        role: "lead",
        realize:
          kind === "parent"
            ? [
                { id: "seed-block", kind: "motif", motif: "seed" },
                {
                  id: "rest",
                  kind: "rest",
                  duration: { numerator: 2, denominator: 1 },
                },
              ]
            : kind === "recurrence"
              ? [
                  {
                    id: "seed-block",
                    kind: "motif",
                    motif: "seed",
                    repeat: 2,
                  },
                ]
              : [
                  {
                    id: "rest",
                    kind: "rest",
                    duration: { numerator: 4, denominator: 1 },
                  },
                ],
      },
    ],
    sections: [
      { id: kind === "parent" ? "room" : "answer", startBar: 1, bars: 1 },
    ],
  };
}

describe("AIR@1 receipt identity", () => {
  it("binds the canonical source to a strict root receipt", () => {
    const receipt = createRootReceiptV1(VALID_AIR_V1);
    expect(receiptIntegrityErrorsV1(receipt)).toEqual([]);
    expect(sourceReceiptIntegrityErrorsV1(VALID_AIR_V1, receipt)).toEqual([]);
    expect(receipt.receiptId).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("reproduces a root receipt after a host reorders JSON object keys", () => {
    const receipt = createRootReceiptV1(VALID_AIR_V1);
    const transported = reorderObjectKeys(receipt);

    expect(receiptIntegrityErrorsV1(transported)).toEqual([]);
    expect(sourceReceiptIntegrityErrorsV1(VALID_AIR_V1, transported)).toEqual(
      [],
    );
  });

  it("preserves a fully populated continuation identity across host key reordering", () => {
    const verificationCore: Omit<MusicalRelationVerificationV1, "evidenceId"> =
      {
        contract: "musical-relation@1-experimental",
        status: "verified",
        motifLinks: [
          {
            parent: "seed",
            child: "seed_answer",
            parentAnchor: "lead:seed-block:1:seed",
            childAnchor: "lead:answer-block:1:seed_answer",
            transform: {
              transpose: 7,
              stretch: 2,
              invert: true,
              retrograde: false,
            },
          },
        ],
        orchestrationLinks: [
          {
            parentAnchor: "lead:seed-block:1:seed",
            childAnchor: "lead:answer-block:1:seed_answer",
            parentVoiceId: "lead",
            childVoiceId: "lead",
            parentInstrument: "warm_piano",
            childInstrument: "pack_voice",
          },
        ],
        recurrences: [{ motif: "seed", parentCount: 1, childCount: 3 }],
        contrasts: [
          {
            parentSection: "room",
            childSection: "answer",
            dimensions: ["density", "instrumentation", "register"],
          },
        ],
        absences: [
          {
            motif: "counterline",
            parentAnchor: "lead:counterline-block:1:counterline",
            childSection: "answer",
          },
        ],
        prefix: {
          parentEventCount: 8,
          childEventCount: 13,
          parentDurationBeats: 16,
          childDurationBeats: 24,
        },
      };
    const verification = {
      ...verificationCore,
      evidenceId: musicalEvidenceIdV1(verificationCore),
    };
    const embodiment = createEmbodimentLineage({
      parentPerformanceBindingDigest: `sha256:${"1".repeat(64)}`,
      childPerformanceBindingDigest: `sha256:${"2".repeat(64)}`,
      instrumentMap: [
        { parentInstrument: "warm_piano", childInstrument: "pack_voice" },
      ],
    });
    const receiptCore: Omit<AirReceiptV1, "receiptId"> = {
      format: "refrain-receipt@1-experimental",
      sourceRevision: `sha256:${"3".repeat(64)}`,
      airId: `sha256:${"4".repeat(64)}`,
      sourceFormat: AIR_V1_FORMAT,
      verification,
      lineage: {
        relation: "extend",
        parentSourceRevision: `sha256:${"5".repeat(64)}`,
        parentReceiptId: `sha256:${"6".repeat(64)}`,
        parentAirId: `sha256:${"4".repeat(64)}`,
      },
      embodiment,
    };
    const receipt: AirReceiptV1 = {
      ...receiptCore,
      receiptId: receiptIdOfV1(receiptCore),
    };

    expect(verification.evidenceId).toBe(
      "sha256:fcd62cf5ac3281437a0ad85cc77fd3a7f8b255f2e3c3e42617871e0c41a83c49",
    );
    expect(verification.evidenceId).toBe(
      nodeSha256Id(JSON.stringify(verificationCore)),
    );
    const { evidenceId: _embodimentId, ...embodimentCore } = embodiment;
    expect(embodiment.evidenceId).toBe(
      "sha256:0505db5e1955137328dc341286dcd04c172bb1e4d577cbb2cf4b70e50963241a",
    );
    expect(embodiment.evidenceId).toBe(
      nodeSha256Id(JSON.stringify(embodimentCore)),
    );
    expect(receipt.receiptId).toBe(
      "sha256:45f7c4e2c8e117a29034de5f5daae59398e61f597c18f737bed1bb9370f2fa5e",
    );
    expect(receipt.receiptId).toBe(
      nodeSha256Id(receiptIdentityJsonV1(receiptCore)),
    );
    expect(receiptIntegrityErrorsV1(reorderObjectKeys(receipt))).toEqual([]);
  });

  it("keeps embodiment lineage separately identity-bound", () => {
    const embodiment = createEmbodimentLineage({
      parentPerformanceBindingDigest: `sha256:${"1".repeat(64)}`,
      childPerformanceBindingDigest: `sha256:${"2".repeat(64)}`,
      instrumentMap: [
        { parentInstrument: "warm_piano", childInstrument: "pack_voice" },
      ],
    });
    expect(embodiment.evidenceId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(embodiment.contract).not.toBe("musical-relation@1-experimental");

    const transported = reorderObjectKeys(embodiment) as EmbodimentLineage;
    const { evidenceId, ...core } = transported;
    expect(embodimentEvidenceId(core)).toBe(evidenceId);
  });

  it("fails closed when receipt identity is edited", () => {
    const receipt = createRootReceiptV1(VALID_AIR_V1);
    receipt.airId = `sha256:${"0".repeat(64)}`;
    expect(receiptIntegrityErrorsV1(receipt)).toEqual(
      expect.arrayContaining(["air-id", "receipt-id"]),
    );
  });

  it("rejects extra receipt and nested evidence keys instead of ignoring them", () => {
    const receipt = createRootReceiptV1(VALID_AIR_V1);
    expect(receiptIntegrityErrorsV1({ ...receipt, extra: true })).toContain(
      "shape",
    );
    expect(
      receiptIntegrityErrorsV1({
        ...receipt,
        verification: { ...receipt.verification, extra: true },
      }),
    ).toContain("shape");
  });

  it("verifies orchestration, recurrence, register, density, and instrumentation as compiled evidence", () => {
    const parent = compileAirV1(relationAir("parent")).compiled!;
    const child = compileAirV1(relationAir("recurrence")).compiled!;
    expect(
      verifyMusicalRelationV1(parent, child, "reply", {
        orchestrationLinks: [
          {
            parentAnchor: "lead:seed-block:1:seed",
            childAnchor: "lead:seed-block:1:seed",
            parentVoiceId: "lead",
            childVoiceId: "lead",
            parentInstrument: "warm_piano",
            childInstrument: "pack_voice",
          },
        ],
        recurrences: [{ motif: "seed", minimumChildCount: 2 }],
        contrasts: [
          {
            parentSection: "room",
            childSection: "answer",
            dimensions: ["register", "density", "instrumentation"],
          },
        ],
      }),
    ).toMatchObject({
      verification: {
        status: "verified",
        recurrences: [{ motif: "seed", parentCount: 1, childCount: 2 }],
      },
    });
  });

  it("canonicalizes evidence ordering and duplicate contrast dimensions before hashing", () => {
    const parent = compileAirV1(relationAir("parent")).compiled!;
    const child = compileAirV1(relationAir("recurrence")).compiled!;
    const first = verifyMusicalRelationV1(parent, child, "reply", {
      contrasts: [
        {
          parentSection: "room",
          childSection: "answer",
          dimensions: ["register", "density", "register", "instrumentation"],
        },
      ],
    });
    const second = verifyMusicalRelationV1(parent, child, "reply", {
      contrasts: [
        {
          parentSection: "room",
          childSection: "answer",
          dimensions: ["instrumentation", "register", "density"],
        },
      ],
    });
    expect(first.verification?.contrasts[0]?.dimensions).toEqual([
      "density",
      "instrumentation",
      "register",
    ]);
    expect(first.verification?.evidenceId).toBe(
      second.verification?.evidenceId,
    );

    const transported = reorderObjectKeys(
      first.verification,
    ) as MusicalRelationVerificationV1;
    const { evidenceId, ...core } = transported;
    expect(musicalEvidenceIdV1(core)).toBe(evidenceId);
  });

  it("verifies meaningful absence only when the child section omits the motif", () => {
    const parent = compileAirV1(relationAir("parent")).compiled!;
    const child = compileAirV1(relationAir("absence")).compiled!;
    expect(
      verifyMusicalRelationV1(parent, child, "reply", {
        absences: [
          {
            motif: "seed",
            parentAnchor: "lead:seed-block:1:seed",
            childSection: "answer",
          },
        ],
      }),
    ).toMatchObject({ verification: { status: "verified" } });
  });
});
