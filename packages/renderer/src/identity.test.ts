import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalAirJson, type AirSource } from "@refrain/air-schema";
import { describe, expect, it } from "vitest";
import {
  evidenceIdOf,
  receiptIdOf,
  receiptIdentityJson,
  receiptIntegrityIsValid,
  receiptShapeIsValid,
  sourceRevisionOf,
} from "./identity.js";
import type { AirReceipt, MusicalRelationVerification } from "./types.js";

const fixture = JSON.parse(
  readFileSync(resolve("fixtures/valid/returning-home.air.json"), "utf8"),
) as AirSource;

const rootReceiptCore: Omit<AirReceipt, "receiptId"> = {
  format: "refrain-receipt@0-experimental",
  sourceRevision:
    "sha256:abbe97076697e2ff0b86de17bc285030e33803359d6a00e4052278a0e30c8520",
  airId:
    "sha256:abbe97076697e2ff0b86de17bc285030e33803359d6a00e4052278a0e30c8520",
  sourceFormat: "air@0-experimental",
  verification: {
    contract: "musical-relation@0-experimental",
    status: "not_applicable",
    motifLinks: [],
  },
};

const verificationCore: Omit<MusicalRelationVerification, "evidenceId"> = {
  contract: "musical-relation@0-experimental",
  status: "verified",
  motifLinks: [
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
  ],
};

function nodeSha256Id(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

describe("musical receipt identity", () => {
  it("preserves the fixed source, evidence, and receipt identities", () => {
    expect(sourceRevisionOf(fixture)).toBe(
      "sha256:abbe97076697e2ff0b86de17bc285030e33803359d6a00e4052278a0e30c8520",
    );
    expect(evidenceIdOf(verificationCore)).toBe(
      "sha256:a19ab8787df8bf05176608aaaedd32ab52e4fc51e43e5e77690b478eb4a97d3d",
    );
    expect(receiptIdOf(rootReceiptCore)).toBe(
      "sha256:fdbe276e6ae2c5ae09172a0f13624d5aec1094d711ae8d539172c1b4d826949d",
    );
  });

  it("matches Node SHA-256 at every preserved identity byte boundary", () => {
    expect(sourceRevisionOf(fixture)).toBe(
      nodeSha256Id(canonicalAirJson(fixture)),
    );
    expect(evidenceIdOf(verificationCore)).toBe(
      nodeSha256Id(JSON.stringify(verificationCore)),
    );
    expect(receiptIdOf(rootReceiptCore)).toBe(
      nodeSha256Id(receiptIdentityJson(rootReceiptCore)),
    );
  });

  it("keeps shape validation separate from higher-level integrity", () => {
    const shapedButInvalid: AirReceipt = {
      ...rootReceiptCore,
      airId: `sha256:${"f".repeat(64)}`,
      receiptId: receiptIdOf({
        ...rootReceiptCore,
        airId: `sha256:${"f".repeat(64)}`,
      }),
    };
    expect(receiptShapeIsValid(shapedButInvalid)).toBe(true);
    expect(receiptIntegrityIsValid(shapedButInvalid)).toBe(false);
  });
});
