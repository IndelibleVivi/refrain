import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AirSource } from "@refrain/air-schema";
import {
  receiptIdentityJson,
  type AirReceipt,
  type ContinuationRelation,
} from "@refrain/renderer";
import {
  DEFAULT_PERFORMANCE_BINDING,
  G3B_VCSL_LISTENING_PERFORMANCE_BINDING,
} from "@refrain/soundpack";
import { hum } from "./hum.js";

const fixture = JSON.parse(
  readFileSync(resolve("fixtures/valid/returning-home.air.json"), "utf8"),
) as AirSource;
const changed = (title: string): AirSource => ({ ...fixture, title });
const extended = (source: AirSource, title: string): AirSource => ({
  ...source,
  title,
  voices: source.voices.map((voice) =>
    "part" in voice && typeof voice.part === "string"
      ? { ...voice, part: `${voice.part} | r/1` }
      : voice,
  ),
});

function continueFrom(
  air: AirSource,
  parent: { source: AirSource; receipt: AirReceipt },
  relation: ContinuationRelation,
) {
  return hum({
    air,
    from: {
      air: parent.source,
      receipt: parent.receipt,
      relation,
      expectedSourceRevision: parent.receipt.sourceRevision,
    },
  });
}

function reidentifyReceipt(receipt: AirReceipt): AirReceipt {
  const { receiptId: _receiptId, ...core } = receipt;
  return {
    ...core,
    receiptId: `sha256:${createHash("sha256")
      .update(receiptIdentityJson(core))
      .digest("hex")}`,
  };
}

describe("hum", () => {
  it("returns deterministic source, air, and receipt identities", () => {
    const first = hum({ air: fixture, caption: "I kept the small return." });
    const second = hum({ air: fixture, caption: "A different caption." });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.receipt.sourceRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.receipt.airId).toBe(first.receipt.sourceRevision);
    expect(second.receipt.sourceRevision).toBe(first.receipt.sourceRevision);
    expect(second.receipt.receiptId).toBe(first.receipt.receiptId);
    expect(first.summary.motifOccurrences).toEqual([
      {
        motif: "return",
        count: 3,
        voiceIds: ["lead"],
        anchors: [
          "lead:part:1:return",
          "lead:part:2:return",
          "lead:part:3:return",
        ],
      },
    ]);
    expect(first.summary.eventCount).toBeGreaterThan(0);
    expect(first).not.toHaveProperty("compiled");
    expect(first.performanceBinding).toEqual(DEFAULT_PERFORMANCE_BINDING);
  });

  it("selects an exact audible binding without changing musical identity", () => {
    const fallback = hum({ air: fixture });
    const listening = hum({
      air: fixture,
      performance: {
        bindingId: G3B_VCSL_LISTENING_PERFORMANCE_BINDING.id,
      },
    });
    expect(fallback.ok && listening.ok).toBe(true);
    if (!fallback.ok || !listening.ok) return;
    expect(listening.performanceBinding).toEqual(
      G3B_VCSL_LISTENING_PERFORMANCE_BINDING,
    );
    expect(listening.receipt).toEqual(fallback.receipt);
    expect(listening.receipt.sourceRevision).toBe(
      fallback.receipt.sourceRevision,
    );
  });

  it("rejects an unknown binding instead of silently falling back", () => {
    expect(
      hum({ air: fixture, performance: { bindingId: "missing-binding@0" } }),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: "unknown_performance_binding" }],
    });
  });

  it("records unambiguous lineage from complete prior source and receipt", () => {
    const parent = hum({ air: fixture });
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    const child = continueFrom(
      changed("A small variation"),
      { source: parent.source, receipt: parent.receipt },
      "reply",
    );
    expect(child.ok).toBe(true);
    if (!child.ok) return;
    expect(child.receipt.lineage).toEqual({
      relation: "reply",
      parentSourceRevision: parent.receipt.sourceRevision,
      parentReceiptId: parent.receipt.receiptId,
      parentAirId: parent.receipt.airId,
    });
    expect(child.receipt.airId).toBe(child.receipt.sourceRevision);
  });

  it("gives the same source different receipt IDs under different lineage", () => {
    const firstParent = hum({ air: fixture });
    const secondParent = hum({ air: changed("Another parent") });
    expect(firstParent.ok && secondParent.ok).toBe(true);
    if (!firstParent.ok || !secondParent.ok) return;
    const childSource = changed("Shared child source");
    const firstChild = continueFrom(
      childSource,
      { source: firstParent.source, receipt: firstParent.receipt },
      "reply",
    );
    const secondChild = continueFrom(
      childSource,
      { source: secondParent.source, receipt: secondParent.receipt },
      "reply",
    );
    expect(firstChild.ok && secondChild.ok).toBe(true);
    if (!firstChild.ok || !secondChild.ok) return;
    expect(firstChild.receipt.sourceRevision).toBe(
      secondChild.receipt.sourceRevision,
    );
    expect(firstChild.receipt.receiptId).not.toBe(
      secondChild.receipt.receiptId,
    );
  });

  it("inherits air identity only for revise and extend", () => {
    const parent = hum({ air: fixture });
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    const revised = continueFrom(
      changed("Revised source"),
      { source: parent.source, receipt: parent.receipt },
      "revise",
    );
    const reply = continueFrom(
      changed("Reply source"),
      { source: parent.source, receipt: parent.receipt },
      "reply",
    );
    expect(revised.ok && reply.ok).toBe(true);
    if (!revised.ok || !reply.ok) return;
    expect(revised.receipt.airId).toBe(parent.receipt.airId);
    expect(reply.receipt.airId).toBe(reply.receipt.sourceRevision);
    expect(reply.receipt.airId).not.toBe(parent.receipt.airId);
  });

  it("rejects self-lineage and modified parent receipts", () => {
    const parent = hum({ air: fixture });
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    const self = continueFrom(
      fixture,
      { source: parent.source, receipt: parent.receipt },
      "variation",
    );
    expect(self).toMatchObject({
      ok: false,
      diagnostics: [{ code: "same_source_continuation" }],
    });

    const fabricated = {
      ...parent.receipt,
      airId: `sha256:${"f".repeat(64)}`,
    };
    const result = hum({
      air: changed("Child"),
      from: { air: parent.source, receipt: fabricated, relation: "extend" },
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "invalid_parent_receipt" }],
    });
  });

  it("rejects a lineage receipt mislabeled as not applicable even after re-identification", () => {
    const root = hum({ air: fixture });
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const reply = continueFrom(
      changed("Lineage status parent"),
      { source: root.source, receipt: root.receipt },
      "reply",
    );
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    const mislabeled = reidentifyReceipt({
      ...reply.receipt,
      verification: {
        ...reply.receipt.verification,
        status: "not_applicable",
      },
    });

    expect(
      hum({
        air: changed("Child of mislabeled lineage"),
        from: {
          air: reply.source,
          receipt: mislabeled,
          relation: "reply",
        },
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: "invalid_parent_receipt" }],
    });
  });

  it("reconstructs a two-generation chain from supplied sources and receipts", () => {
    const root = hum({ air: fixture });
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const child = continueFrom(
      changed("Second generation"),
      { source: root.source, receipt: root.receipt },
      "revise",
    );
    expect(child.ok).toBe(true);
    if (!child.ok) return;
    const grandchild = continueFrom(
      extended(child.source, "Third generation"),
      { source: child.source, receipt: child.receipt },
      "extend",
    );
    expect(grandchild.ok).toBe(true);
    if (!grandchild.ok) return;
    expect(grandchild.receipt.airId).toBe(root.receipt.airId);
    expect(grandchild.receipt.lineage?.parentReceiptId).toBe(
      child.receipt.receiptId,
    );
  });

  it("fails closed when the parent source expectation mismatches", () => {
    const parent = hum({ air: fixture });
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    const result = hum({
      air: changed("Mismatch child"),
      from: {
        air: parent.source,
        receipt: parent.receipt,
        relation: "extend",
        expectedSourceRevision: `sha256:${"0".repeat(64)}`,
      },
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "source_revision_mismatch",
          path: "$.from.expectedSourceRevision",
        },
      ],
    });
  });
});
