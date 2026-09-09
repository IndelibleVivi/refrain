import { compileAnyAir } from "@refrain/compiler/any";
import type { CompiledAir } from "@refrain/compiler";
import type { CompiledAirV1 } from "@refrain/compiler/v1";
import {
  performanceStatusForSource,
  type ExactPerformanceBinding,
} from "@refrain/soundpack/binding-status";
import {
  createRefrainArtifact,
  createRefrainArtifactV2,
  createRefrainArtifactV3,
  parseRefrainArtifact,
} from "./portable.js";
import type { AnyAirArtifact, RefrainArtifact } from "./types.js";

export type ArtifactPresentationResult =
  { ok: true; artifact: AnyAirArtifact } | { ok: false; message: string };

export function carriedBindings(document: RefrainArtifact) {
  return "performanceBindings" in document ? document.performanceBindings : [];
}

/** Never reconstruct a loaded document from its selected playback projection. */
export function portableArtifactForView(view: AnyAirArtifact): RefrainArtifact {
  if (view.portableArtifact) return view.portableArtifact;
  if (view.source.format === "air@1-experimental")
    return createRefrainArtifactV3({
      source: view.source,
      receipt: view.receipt as import("./v1.js").AirReceiptV1,
      ...(view.performanceBinding
        ? { performanceBinding: view.performanceBinding }
        : {}),
      ...(view.caption === undefined ? {} : { caption: view.caption }),
    });
  const input = {
    source: view.source,
    receipt: view.receipt as import("./types.js").AirReceipt,
    ...(view.caption === undefined ? {} : { caption: view.caption }),
  };
  return view.performanceBinding?.format ===
    "refrain-performance-binding@1-experimental"
    ? createRefrainArtifactV2({
        ...input,
        performanceBinding: view.performanceBinding,
      })
    : createRefrainArtifact({
        ...input,
        performanceBinding: view.performanceBinding,
      });
}

/** Choose a carried or explicitly supplied preview sound without changing the document. */
export function withAuditionBinding(
  view: AnyAirArtifact,
  bindingId?: string,
  previewBindings: readonly ExactPerformanceBinding[] = [],
): AnyAirArtifact {
  const document = portableArtifactForView(view);
  const binding =
    carriedBindings(document).find((candidate) => candidate.id === bindingId) ??
    previewBindings.find((candidate) => candidate.id === bindingId);
  if (bindingId !== undefined && !binding)
    throw new Error(
      `PerformanceBinding ${bindingId} is unavailable to this presentation.`,
    );
  const {
    performanceBinding: _binding,
    performanceStatus: _status,
    ...music
  } = view;
  return {
    ...music,
    portableArtifact: document,
    ...(binding
      ? {
          performanceBinding: binding,
          performanceStatus: performanceStatusForSource(binding, view.source),
        }
      : {}),
  };
}

/** One verified document-to-view boundary, shared by ordinary browser and MCP. */
export function presentPortableArtifact(
  value: unknown,
  requestedBindingId?: string,
  previewBindings: readonly ExactPerformanceBinding[] = [],
): ArtifactPresentationResult {
  const parsed = parseRefrainArtifact(value);
  if (!parsed.ok) return { ok: false, message: parsed.errors.join(" ") };
  const document = parsed.artifact;
  const compilation = compileAnyAir(document.source);
  if (!compilation.compiled)
    return {
      ok: false,
      message: "The canonical AIR in this artifact does not compile.",
    };
  const bindings = carriedBindings(document);
  const bindingId =
    requestedBindingId ??
    ("defaultBindingId" in document ? document.defaultBindingId : undefined) ??
    (bindings.length === 1 ? bindings[0]!.id : undefined);
  const common = {
    portableArtifact: document,
    diagnostics: compilation.diagnostics,
    ...(document.caption === undefined ? {} : { caption: document.caption }),
  };
  const view: AnyAirArtifact =
    document.format === "refrain-artifact@3-experimental"
      ? {
          ...common,
          source: document.source,
          receipt: document.receipt,
          compiled: compilation.compiled as CompiledAirV1,
        }
      : {
          ...common,
          source: document.source,
          receipt: document.receipt,
          compiled: compilation.compiled as CompiledAir,
        };
  try {
    return {
      ok: true,
      artifact: withAuditionBinding(view, bindingId, previewBindings),
    };
  } catch (cause) {
    return {
      ok: false,
      message:
        cause instanceof Error ? cause.message : "Invalid sound selection.",
    };
  }
}
