import { describe, expect, it } from "vitest";
import type { AirSource } from "@refrain/air-schema";
import { hum } from "./hum.js";

const parentSource: AirSource = {
  format: "air@0-experimental",
  title: "Return seed",
  tempo: 72,
  meter: "4/4",
  motifs: { return: "A4/4 B4/4 D5/4 E5/4" },
  voices: [
    {
      id: "lead",
      instrument: "warm_piano",
      role: "lead",
      part: "@return",
    },
  ],
};

const link = {
  parent: "return",
  child: "return_low",
  parentAnchor: "lead:part:1:return",
  childAnchor: "lead:part:1:return_low",
  transform: {
    transpose: -12,
    stretch: 1,
    invert: false,
    retrograde: false,
  },
} as const;

function parent() {
  const result = hum({ air: parentSource });
  if (!result.ok) throw new Error("Parent fixture did not hum.");
  return result;
}

describe("verified musical relationships", () => {
  it("verifies a deterministic motif variation and binds evidence into the receipt", () => {
    const root = parent();
    const child = hum({
      air: {
        ...parentSource,
        title: "Return lowered",
        motifs: { return_low: "A3/4 B3/4 D4/4 E4/4" },
        voices: [{ ...parentSource.voices[0], part: "@return_low" }],
      },
      from: {
        air: root.source,
        receipt: root.receipt,
        relation: "variation",
        motifLinks: [link],
      },
    });
    expect(child.ok).toBe(true);
    if (!child.ok) return;
    expect(child.receipt.verification).toMatchObject({
      contract: "musical-relation@0-experimental",
      status: "verified",
      motifLinks: [
        {
          parent: "return",
          child: "return_low",
          transform: link.transform,
        },
      ],
    });
    expect(child.receipt.verification.evidenceId).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
  });

  it("verifies exact quotation and exact schedule extension", () => {
    const root = parent();
    const quote = hum({
      air: {
        ...parentSource,
        title: "Return quoted",
        motifs: { quoted: parentSource.motifs.return! },
        voices: [{ ...parentSource.voices[0], part: "@quoted" }],
      },
      from: {
        air: root.source,
        receipt: root.receipt,
        relation: "quote",
        motifLinks: [
          {
            parent: "return",
            child: "quoted",
            parentAnchor: "lead:part:1:return",
            childAnchor: "lead:part:1:quoted",
            transform: {
              transpose: 0,
              stretch: 1,
              invert: false,
              retrograde: false,
            },
          },
        ],
      },
    });
    expect(quote.ok && quote.receipt.verification.status === "verified").toBe(
      true,
    );

    const extension = hum({
      air: {
        ...parentSource,
        title: "Return extended",
        voices: [{ ...parentSource.voices[0], part: "@return | r/1" }],
      },
      from: {
        air: root.source,
        receipt: root.receipt,
        relation: "extend",
      },
    });
    expect(extension.ok).toBe(true);
    if (!extension.ok) return;
    expect(extension.receipt.verification).toMatchObject({
      status: "verified",
      prefix: { parentEventCount: 4, childEventCount: 4 },
    });
  });

  it("fails closed for missing, false, or non-transform variation evidence", () => {
    const root = parent();
    const childSource = {
      ...parentSource,
      title: "False return",
      motifs: { return_low: "A3/4 B3/4 D4/4 E4/4" },
      voices: [{ ...parentSource.voices[0], part: "@return_low" }],
    };
    const missing = hum({
      air: childSource,
      from: {
        air: root.source,
        receipt: root.receipt,
        relation: "variation",
      },
    });
    expect(missing).toMatchObject({
      ok: false,
      diagnostics: [{ code: "missing_relation_evidence" }],
    });

    const falseLink = hum({
      air: childSource,
      from: {
        air: root.source,
        receipt: root.receipt,
        relation: "variation",
        motifLinks: [
          { ...link, transform: { ...link.transform, transpose: -11 } },
        ],
      },
    });
    expect(falseLink).toMatchObject({
      ok: false,
      diagnostics: [{ code: "motif_evidence_mismatch" }],
    });

    const wrongAnchor = hum({
      air: childSource,
      from: {
        air: root.source,
        receipt: root.receipt,
        relation: "variation",
        motifLinks: [{ ...link, parentAnchor: "lead:part:99:return" }],
      },
    });
    expect(wrongAnchor).toMatchObject({
      ok: false,
      diagnostics: [{ code: "motif_anchor_not_found" }],
    });

    const identityVariation = hum({
      air: {
        ...childSource,
        motifs: { return_low: parentSource.motifs.return! },
      },
      from: {
        air: root.source,
        receipt: root.receipt,
        relation: "variation",
        motifLinks: [
          {
            ...link,
            transform: {
              transpose: 0,
              stretch: 1,
              invert: false,
              retrograde: false,
            },
          },
        ],
      },
    });
    expect(identityVariation).toMatchObject({
      ok: false,
      diagnostics: [{ code: "variation_requires_transform" }],
    });
  });

  it("rejects an extension that changes the prior compiled prefix", () => {
    const root = parent();
    const result = hum({
      air: {
        ...parentSource,
        title: "Not an extension",
        voices: [
          { ...parentSource.voices[0], part: "G4/4 B4/4 D5/4 E5/4 | r/1" },
        ],
      },
      from: {
        air: root.source,
        receipt: root.receipt,
        relation: "extend",
      },
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "extension_prefix_mismatch" }],
    });
  });

  it("selects the exact anchored occurrence when one motif has different transforms", () => {
    const sourceWithTwoReturns: AirSource = {
      ...parentSource,
      title: "Two registers",
      voices: [
        {
          id: "lead",
          instrument: "warm_piano",
          role: "lead",
          realize: [
            { id: "low", kind: "motif", motif: "return" },
            {
              id: "high",
              kind: "motif",
              motif: "return",
              transform: {
                transpose: 12,
                stretch: 1,
                inversion: false,
                retrograde: false,
              },
            },
          ],
        },
      ],
    };
    const root = hum({ air: sourceWithTwoReturns });
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    expect(root.summary.motifOccurrences[0]?.anchors).toContain(
      "lead:high:2:return",
    );

    const quoted = hum({
      air: {
        ...parentSource,
        title: "The high return",
        motifs: { quoted: parentSource.motifs.return! },
        voices: [
          {
            id: "lead",
            instrument: "warm_piano",
            role: "lead",
            realize: [
              {
                id: "quoted-high",
                kind: "motif",
                motif: "quoted",
                transform: {
                  transpose: 12,
                  stretch: 1,
                  inversion: false,
                  retrograde: false,
                },
              },
              { id: "tail", kind: "rest", beats: 4 },
            ],
          },
        ],
      },
      from: {
        air: root.source,
        receipt: root.receipt,
        relation: "quote",
        motifLinks: [
          {
            parent: "return",
            child: "quoted",
            parentAnchor: "lead:high:2:return",
            childAnchor: "lead:quoted-high:1:quoted",
            transform: {
              transpose: 0,
              stretch: 1,
              invert: false,
              retrograde: false,
            },
          },
        ],
      },
    });
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    expect(quoted.receipt.verification.motifLinks[0]).toMatchObject({
      parentAnchor: "lead:high:2:return",
      childAnchor: "lead:quoted-high:1:quoted",
    });
  });

  it("verifies chord-first inversion and rest-preserving retrograde from compiler material", () => {
    const source: AirSource = {
      format: "air@0-experimental",
      title: "Ordered material",
      tempo: 72,
      meter: "4/4",
      motifs: { shape: "[E4,C4,G4]/4 r/8 D4/8" },
      voices: [
        {
          id: "lead",
          instrument: "warm_piano",
          role: "lead",
          part: "@shape r/2",
        },
      ],
    };
    const root = hum({ air: source });
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const child = hum({
      air: {
        ...source,
        title: "Ordered material reversed",
        voices: [
          {
            id: "lead",
            instrument: "warm_piano",
            role: "lead",
            realize: [
              {
                id: "turned",
                kind: "motif",
                motif: "shape",
                transform: { inversion: true, retrograde: true },
              },
              { id: "tail", kind: "rest", beats: 2 },
            ],
          },
        ],
      },
      from: {
        air: root.source,
        receipt: root.receipt,
        relation: "variation",
        motifLinks: [
          {
            parent: "shape",
            child: "shape",
            parentAnchor: "lead:part:1:shape",
            childAnchor: "lead:turned:1:shape",
            transform: {
              transpose: 0,
              stretch: 1,
              invert: true,
              retrograde: true,
            },
          },
        ],
      },
    });
    expect(child.ok).toBe(true);
  });

  it("rejects a rests-retrograde lookalike with the same audible notes", () => {
    const source: AirSource = {
      format: "air@0-experimental",
      title: "Rest evidence",
      tempo: 72,
      meter: "4/4",
      motifs: { phrase: "C4/4 r/8 D4/8" },
      voices: [
        {
          id: "lead",
          instrument: "warm_piano",
          role: "lead",
          part: "@phrase r/2",
        },
      ],
    };
    const root = hum({ air: source });
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const child = hum({
      air: {
        ...source,
        title: "False rest retrograde",
        motifs: { false_back: "D4/8 r/8 C4/4 r/8" },
        voices: [
          {
            id: "lead",
            instrument: "warm_piano",
            role: "lead",
            part: "@false_back r/4.",
          },
        ],
      },
      from: {
        air: root.source,
        receipt: root.receipt,
        relation: "variation",
        motifLinks: [
          {
            parent: "phrase",
            child: "false_back",
            parentAnchor: "lead:part:1:phrase",
            childAnchor: "lead:part:1:false_back",
            transform: {
              transpose: 0,
              stretch: 1,
              invert: false,
              retrograde: true,
            },
          },
        ],
      },
    });
    expect(child).toMatchObject({
      ok: false,
      diagnostics: [{ code: "motif_evidence_mismatch" }],
    });
  });
});
