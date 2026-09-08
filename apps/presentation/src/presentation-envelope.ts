import { parseAir } from "@refrain/air-schema";
import { parseAirV1 } from "@refrain/air-schema/v1";
import { compileAir } from "@refrain/compiler";
import { compileAirV1 } from "@refrain/compiler/v1";
import {
  MAX_PRESENTATION_FRAGMENT_CHARS,
  sourceReceiptIntegrityErrors,
} from "@refrain/renderer";
import type {
  AirArtifact,
  AirArtifactV1,
  AnyAirArtifact,
  LegacyPresentationEnvelope,
  PresentationEnvelope,
  PresentationEnvelopeV2,
} from "@refrain/renderer";
import {
  sourceReceiptIntegrityErrorsV1,
  type AirReceiptV1,
} from "@refrain/renderer/v1";
import {
  DEFAULT_PERFORMANCE_BINDING,
  performanceBindingShapeIsValid,
  resolvePerformanceBindingAgainstRuntime,
} from "@refrain/soundpack";

export type PresentationVerification =
  { ok: true; artifact: AnyAirArtifact } | { ok: false; message: string };

function exactEnvelope(
  value: unknown,
): value is
  PresentationEnvelope | PresentationEnvelopeV2 | LegacyPresentationEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  const current = envelope.format === "refrain-presentation@1-experimental";
  const legacy = envelope.format === "refrain-presentation@0-experimental";
  const v2 = envelope.format === "refrain-presentation@2-experimental";
  if (!current && !legacy && !v2) return false;
  const keys = Object.keys(envelope).sort();
  const expected = [
    "format",
    "receipt",
    "source",
    ...(current ? ["performanceBinding"] : []),
    ...(v2 && envelope.performanceBinding !== undefined
      ? ["performanceBinding"]
      : []),
    ...(v2 ? ["performanceStatus"] : []),
    ...(envelope.caption === undefined ? [] : ["caption"]),
  ].sort();
  return (
    JSON.stringify(keys) === JSON.stringify(expected) &&
    ((!current && !v2) ||
      envelope.performanceBinding === undefined ||
      performanceBindingShapeIsValid(envelope.performanceBinding)) &&
    (envelope.caption === undefined ||
      (typeof envelope.caption === "string" && envelope.caption.length <= 1000))
  );
}

export function decodePresentationHash(hash: string): unknown | undefined {
  const encoded = hash.startsWith("#air=") ? hash.slice(5) : undefined;
  if (!encoded || encoded.length > MAX_PRESENTATION_FRAGMENT_CHARS)
    return undefined;
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

export async function verifyPresentationEnvelope(
  value: unknown,
): Promise<PresentationVerification> {
  if (!exactEnvelope(value)) {
    return { ok: false, message: "The presentation envelope is malformed." };
  }
  if (value.format === "refrain-presentation@2-experimental") {
    const parsedV1 = parseAirV1(value.source);
    if (!parsedV1.source)
      return {
        ok: false,
        message: "The canonical AIR@1 in this URL is invalid.",
      };
    const compiledV1 = compileAirV1(parsedV1.source);
    if (!compiledV1.compiled)
      return { ok: false, message: "The AIR@1 in this URL does not compile." };
    const receiptErrors = sourceReceiptIntegrityErrorsV1(
      parsedV1.source,
      value.receipt,
    );
    if (receiptErrors.length > 0)
      return {
        ok: false,
        message: `The AIR@1 presentation receipt integrity does not verify (${receiptErrors.join(", ")}).`,
      };
    const artifact: AirArtifactV1 = {
      source: parsedV1.source,
      compiled: compiledV1.compiled,
      diagnostics: compiledV1.diagnostics,
      receipt: value.receipt as AirReceiptV1,
      ...(value.performanceBinding
        ? {
            performanceBinding: value.performanceBinding,
            performanceStatus: resolvePerformanceBindingAgainstRuntime(
              value.performanceBinding,
            ),
          }
        : {}),
      ...(value.caption === undefined ? {} : { caption: value.caption }),
    };
    return { ok: true, artifact };
  }
  const parsed = parseAir(value.source);
  if (!parsed.source) {
    return { ok: false, message: "The canonical air in this URL is invalid." };
  }
  const compiled = compileAir(parsed.source);
  if (!compiled.compiled) {
    return { ok: false, message: "The air in this URL does not compile." };
  }
  const receiptErrors = sourceReceiptIntegrityErrors(
    parsed.source,
    value.receipt,
  );
  if (receiptErrors.includes("shape")) {
    return { ok: false, message: "The presentation receipt is malformed." };
  }
  if (receiptErrors.includes("source-revision")) {
    return {
      ok: false,
      message: "The presentation source does not match its source revision.",
    };
  }
  if (receiptErrors.length > 0) {
    return {
      ok: false,
      message: `The presentation receipt integrity does not verify (${receiptErrors.join(", ")}).`,
    };
  }
  const performanceBinding =
    value.format === "refrain-presentation@1-experimental"
      ? value.performanceBinding
      : DEFAULT_PERFORMANCE_BINDING;
  return {
    ok: true,
    artifact: {
      source: parsed.source,
      compiled: compiled.compiled,
      diagnostics: compiled.diagnostics,
      receipt: value.receipt,
      performanceBinding,
      performanceStatus:
        resolvePerformanceBindingAgainstRuntime(performanceBinding),
      ...(value.caption === undefined ? {} : { caption: value.caption }),
    },
  };
}

export { presentPortableArtifact as verifyArtifactForPresentation } from "@refrain/renderer/artifact-document";
