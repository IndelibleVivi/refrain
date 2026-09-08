import { canonicalAirJson, type AirSource } from "@refrain/air-schema";
import { sha256Id } from "@refrain/identity";
import type {
  AirReceipt,
  ContinuationRelation,
  MusicalRelationVerification,
} from "./types.js";

export const SHA256_ID = /^sha256:[0-9a-f]{64}$/;
export const MAX_PRESENTATION_FRAGMENT_CHARS = 49_152;
const CONTINUATION_RELATIONS = new Set<ContinuationRelation>([
  "revise",
  "extend",
  "reply",
  "variation",
  "quote",
]);

export function receiptIdentityJson(
  receipt: Omit<AirReceipt, "receiptId">,
): string {
  return JSON.stringify({
    format: "refrain-receipt-identity@0-experimental",
    sourceRevision: receipt.sourceRevision,
    airId: receipt.airId,
    sourceFormat: receipt.sourceFormat,
    verification: receipt.verification,
    lineage: receipt.lineage
      ? {
          relation: receipt.lineage.relation,
          parentSourceRevision: receipt.lineage.parentSourceRevision,
          parentReceiptId: receipt.lineage.parentReceiptId,
          parentAirId: receipt.lineage.parentAirId,
        }
      : null,
  });
}

export function sourceRevisionOf(source: AirSource): string {
  return sha256Id(canonicalAirJson(source));
}

export function evidenceIdOf(
  verification: Omit<MusicalRelationVerification, "evidenceId">,
): string {
  return sha256Id(JSON.stringify(verification));
}

export function receiptIdOf(receipt: Omit<AirReceipt, "receiptId">): string {
  return sha256Id(receiptIdentityJson(receipt));
}

export function receiptShapeIsValid(receipt: unknown): receipt is AirReceipt {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt))
    return false;
  const value = receipt as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    "airId",
    "format",
    "receiptId",
    "sourceFormat",
    "sourceRevision",
    "verification",
    ...(value.lineage === undefined ? [] : ["lineage"]),
  ].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) return false;
  if (
    value.format !== "refrain-receipt@0-experimental" ||
    value.sourceFormat !== "air@0-experimental" ||
    typeof value.sourceRevision !== "string" ||
    !SHA256_ID.test(value.sourceRevision) ||
    typeof value.airId !== "string" ||
    !SHA256_ID.test(value.airId) ||
    typeof value.receiptId !== "string" ||
    !SHA256_ID.test(value.receiptId)
  ) {
    return false;
  }
  if (
    !value.verification ||
    typeof value.verification !== "object" ||
    Array.isArray(value.verification)
  ) {
    return false;
  }
  const verification = value.verification as Record<string, unknown>;
  const verificationKeys = [
    "contract",
    "motifLinks",
    "status",
    ...(verification.prefix === undefined ? [] : ["prefix"]),
    ...(verification.evidenceId === undefined ? [] : ["evidenceId"]),
  ].sort();
  if (
    JSON.stringify(Object.keys(verification).sort()) !==
      JSON.stringify(verificationKeys) ||
    verification.contract !== "musical-relation@0-experimental" ||
    !["not_applicable", "declared", "verified"].includes(
      String(verification.status),
    ) ||
    !Array.isArray(verification.motifLinks)
  ) {
    return false;
  }
  for (const link of verification.motifLinks) {
    if (!link || typeof link !== "object" || Array.isArray(link)) return false;
    const item = link as Record<string, unknown>;
    if (
      JSON.stringify(Object.keys(item).sort()) !==
        JSON.stringify(
          [
            "child",
            "childAnchor",
            "parent",
            "parentAnchor",
            "transform",
          ].sort(),
        ) ||
      typeof item.parent !== "string" ||
      typeof item.child !== "string" ||
      typeof item.parentAnchor !== "string" ||
      typeof item.childAnchor !== "string" ||
      !item.transform ||
      typeof item.transform !== "object" ||
      Array.isArray(item.transform)
    ) {
      return false;
    }
    const transform = item.transform as Record<string, unknown>;
    if (
      JSON.stringify(Object.keys(transform).sort()) !==
        JSON.stringify(
          ["invert", "retrograde", "stretch", "transpose"].sort(),
        ) ||
      typeof transform.transpose !== "number" ||
      !Number.isInteger(transform.transpose) ||
      typeof transform.stretch !== "number" ||
      !Number.isFinite(transform.stretch) ||
      typeof transform.invert !== "boolean" ||
      typeof transform.retrograde !== "boolean"
    ) {
      return false;
    }
  }
  if (
    verification.evidenceId !== undefined &&
    (typeof verification.evidenceId !== "string" ||
      !SHA256_ID.test(verification.evidenceId))
  ) {
    return false;
  }
  if (verification.prefix !== undefined) {
    if (
      !verification.prefix ||
      typeof verification.prefix !== "object" ||
      Array.isArray(verification.prefix)
    )
      return false;
    const prefix = verification.prefix as Record<string, unknown>;
    if (
      JSON.stringify(Object.keys(prefix).sort()) !==
        JSON.stringify(
          [
            "childDurationBeats",
            "childEventCount",
            "parentDurationBeats",
            "parentEventCount",
          ].sort(),
        ) ||
      Object.values(prefix).some(
        (item) => typeof item !== "number" || !Number.isFinite(item),
      )
    )
      return false;
  }
  if (
    verification.status === "verified" &&
    (typeof verification.evidenceId !== "string" ||
      !SHA256_ID.test(verification.evidenceId))
  )
    return false;
  if (
    verification.status !== "verified" &&
    (verification.evidenceId !== undefined ||
      verification.motifLinks.length > 0 ||
      verification.prefix !== undefined)
  )
    return false;
  if (value.lineage !== undefined) {
    if (
      !value.lineage ||
      typeof value.lineage !== "object" ||
      Array.isArray(value.lineage)
    ) {
      return false;
    }
    const lineage = value.lineage as Record<string, unknown>;
    if (
      JSON.stringify(Object.keys(lineage).sort()) !==
        JSON.stringify(
          [
            "parentAirId",
            "parentReceiptId",
            "parentSourceRevision",
            "relation",
          ].sort(),
        ) ||
      typeof lineage.relation !== "string" ||
      !CONTINUATION_RELATIONS.has(lineage.relation as ContinuationRelation) ||
      typeof lineage.parentSourceRevision !== "string" ||
      !SHA256_ID.test(lineage.parentSourceRevision) ||
      typeof lineage.parentReceiptId !== "string" ||
      !SHA256_ID.test(lineage.parentReceiptId) ||
      typeof lineage.parentAirId !== "string" ||
      !SHA256_ID.test(lineage.parentAirId)
    ) {
      return false;
    }
  }
  return true;
}

export type ReceiptIntegrityError =
  | "shape"
  | "evidence-id"
  | "root-status"
  | "lineage-status"
  | "required-verification-status"
  | "air-id"
  | "receipt-id"
  | "source-revision";

export function receiptIntegrityErrors(
  receipt: unknown,
): ReceiptIntegrityError[] {
  if (!receiptShapeIsValid(receipt)) return ["shape"];
  const errors: ReceiptIntegrityError[] = [];
  const { evidenceId, ...verificationCore } = receipt.verification;
  if (
    receipt.verification.status === "verified" &&
    evidenceId !== evidenceIdOf(verificationCore)
  )
    errors.push("evidence-id");

  if (!receipt.lineage) {
    if (receipt.verification.status !== "not_applicable")
      errors.push("root-status");
    if (receipt.airId !== receipt.sourceRevision) errors.push("air-id");
  } else {
    if (receipt.verification.status === "not_applicable")
      errors.push("lineage-status");
    if (
      ["quote", "variation", "extend"].includes(receipt.lineage.relation) &&
      receipt.verification.status !== "verified"
    )
      errors.push("required-verification-status");
    const inheritsAir =
      receipt.lineage.relation === "revise" ||
      receipt.lineage.relation === "extend";
    const expectedAirId = inheritsAir
      ? receipt.lineage.parentAirId
      : receipt.sourceRevision;
    if (receipt.airId !== expectedAirId) errors.push("air-id");
  }

  const { receiptId: _receiptId, ...receiptCore } = receipt;
  if (receipt.receiptId !== receiptIdOf(receiptCore)) errors.push("receipt-id");
  return errors;
}

export function receiptIntegrityIsValid(
  receipt: unknown,
): receipt is AirReceipt {
  return receiptIntegrityErrors(receipt).length === 0;
}

export function sourceReceiptIntegrityErrors(
  source: AirSource,
  receipt: unknown,
): ReceiptIntegrityError[] {
  const errors = receiptIntegrityErrors(receipt);
  if (
    receiptShapeIsValid(receipt) &&
    receipt.sourceRevision !== sourceRevisionOf(source)
  )
    errors.push("source-revision");
  return errors;
}
