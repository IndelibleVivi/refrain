import { parseAir } from "@refrain/air-schema";
import { parseAnyAir } from "@refrain/air-schema/any";
import { parseAirV1 } from "@refrain/air-schema/v1";
import { compileAnyAir } from "@refrain/compiler/any";
import { compileAir } from "@refrain/compiler";
import { compileAirV1 } from "@refrain/compiler/v1";
import {
  MAX_PRESENTATION_FRAGMENT_CHARS,
  parseRefrainArtifact,
  sourceReceiptIntegrityErrors,
} from "@refrain/renderer";
import type {
  AirArtifact,
  AirArtifactV1,
  AnyAirArtifact,
  LegacyPresentationEnvelope,
  PresentationEnvelope,
  PresentationEnvelopeV2,
  RefrainArtifact,
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
import { resolvePerformanceBindingV1AgainstRuntime } from "@refrain/soundpack/vnext";
import { SOUND_REGISTRY } from "@refrain/soundpack";

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
    if (!value.performanceBinding)
      return {
        ok: false,
        message:
          "Canonical AIR@1 and receipt verified. Exact performance is unavailable because this envelope carries no PerformanceBinding.",
      };
    const artifact: AirArtifactV1 = {
      source: parsedV1.source,
      compiled: compiledV1.compiled,
      diagnostics: compiledV1.diagnostics,
      receipt: value.receipt as AirReceiptV1,
      performanceBinding: value.performanceBinding,
      performanceStatus: resolvePerformanceBindingAgainstRuntime(
        value.performanceBinding,
      ),
      ...(value.caption ? { caption: value.caption } : {}),
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
      ...(value.caption ? { caption: value.caption } : {}),
    },
  };
}

export function verifyArtifactForPresentation(
  value: unknown,
  requestedBindingId?: string,
): PresentationVerification {
  const parsedArtifact = parseRefrainArtifact(value);
  if (!parsedArtifact.ok)
    return { ok: false, message: parsedArtifact.errors.join(" ") };
  const artifact: RefrainArtifact = parsedArtifact.artifact;
  const parsed = parseAnyAir(artifact.source);
  const compiled = parsed.source ? compileAnyAir(parsed.source) : undefined;
  if (!parsed.source || !compiled?.compiled)
    return {
      ok: false,
      message: "The canonical AIR in this artifact does not compile.",
    };
  if (artifact.format === "refrain-artifact@0-experimental")
    return {
      ok: false,
      message:
        "This legacy artifact is continuity-valid but audibly unbound. Choose and attach an installed PerformanceBinding before playback.",
    };
  const bindingId = requestedBindingId ?? artifact.defaultBindingId;
  const performanceBinding = bindingId
    ? artifact.performanceBindings.find((binding) => binding.id === bindingId)
    : artifact.performanceBindings.length === 1
      ? artifact.performanceBindings[0]
      : undefined;
  if (!performanceBinding)
    return {
      ok: false,
      message:
        artifact.performanceBindings.length === 0
          ? "The artifact is continuity-valid but has no audible PerformanceBinding."
          : "Choose one of the artifact's PerformanceBindings before playback.",
    };
  if (artifact.format === "refrain-artifact@3-experimental") {
    const source = parseAirV1(artifact.source).source;
    const v1Compiled = source ? compileAirV1(source) : undefined;
    if (!source || !v1Compiled?.compiled)
      return { ok: false, message: "The canonical AIR@1 does not compile." };
    return {
      ok: true,
      artifact: {
        source,
        compiled: v1Compiled.compiled,
        diagnostics: v1Compiled.diagnostics,
        receipt: artifact.receipt,
        performanceBinding,
        performanceStatus:
          performanceBinding.format ===
          "refrain-performance-binding@1-experimental"
            ? resolvePerformanceBindingV1AgainstRuntime(
                performanceBinding,
                SOUND_REGISTRY,
              )
            : resolvePerformanceBindingAgainstRuntime(performanceBinding),
        ...(artifact.caption ? { caption: artifact.caption } : {}),
      },
    };
  }
  return {
    ok: true,
    artifact: {
      source: parsed.source as import("@refrain/air-schema").AirSource,
      compiled: compiled.compiled as import("@refrain/compiler").CompiledAir,
      diagnostics: compiled.diagnostics,
      receipt: artifact.receipt as import("@refrain/renderer").AirReceipt,
      performanceBinding,
      performanceStatus:
        performanceBinding.format ===
        "refrain-performance-binding@1-experimental"
          ? resolvePerformanceBindingV1AgainstRuntime(
              performanceBinding,
              SOUND_REGISTRY,
            )
          : resolvePerformanceBindingAgainstRuntime(performanceBinding),
      ...(artifact.caption ? { caption: artifact.caption } : {}),
    },
  };
}
