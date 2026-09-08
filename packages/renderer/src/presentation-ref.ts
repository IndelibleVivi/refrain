import { sha256Id } from "@refrain/identity";
import { parseRefrainArtifact, stringifyRefrainArtifact } from "./portable.js";
import type { RefrainArtifact } from "./types.js";
import { MAX_PRESENTATION_FRAGMENT_CHARS } from "./identity.js";

export const PRESENTATION_REF_FORMAT =
  "refrain-presentation-ref@0-experimental" as const;
export const REFRAIN_ARTIFACT_MEDIA_TYPE =
  "application/vnd.refrain+json" as const;

export type PresentationRefV0 = {
  format: typeof PRESENTATION_REF_FORMAT;
  artifactSha256: string;
  mediaType: typeof REFRAIN_ARTIFACT_MEDIA_TYPE;
  delivery:
    | { kind: "inline"; fragment: string }
    | { kind: "session"; href: string; expiresAt: string }
    | { kind: "file"; filename: string }
    | { kind: "mcp-resource"; uri: string };
};

export type InlinePresentationResult =
  | {
      ok: true;
      ref: PresentationRefV0 & {
        delivery: { kind: "inline"; fragment: string };
      };
      artifactBytes: Uint8Array;
    }
  | {
      ok: false;
      reason: "inline-too-large";
      artifactSha256: string;
      artifactBytes: Uint8Array;
      fragmentChars: number;
      maximumFragmentChars: number;
    };

function bytesToBase64Url(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array | undefined {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

export function artifactBytesOf(artifact: RefrainArtifact): {
  bytes: Uint8Array;
  artifactSha256: string;
} {
  const text = stringifyRefrainArtifact(artifact);
  return {
    bytes: new TextEncoder().encode(text),
    artifactSha256: sha256Id(text),
  };
}

export function createInlinePresentationRef(
  artifact: RefrainArtifact,
): InlinePresentationResult {
  const { bytes, artifactSha256 } = artifactBytesOf(artifact);
  const fragment = bytesToBase64Url(bytes);
  if (fragment.length > MAX_PRESENTATION_FRAGMENT_CHARS) {
    return {
      ok: false,
      reason: "inline-too-large",
      artifactSha256,
      artifactBytes: bytes,
      fragmentChars: fragment.length,
      maximumFragmentChars: MAX_PRESENTATION_FRAGMENT_CHARS,
    };
  }
  return {
    ok: true,
    artifactBytes: bytes,
    ref: {
      format: PRESENTATION_REF_FORMAT,
      artifactSha256,
      mediaType: REFRAIN_ARTIFACT_MEDIA_TYPE,
      delivery: { kind: "inline", fragment },
    },
  };
}

export function parseArtifactBytes(
  bytes: Uint8Array,
  expectedSha256: string,
): { ok: true; artifact: RefrainArtifact } | { ok: false; message: string } {
  const text = new TextDecoder().decode(bytes);
  if (sha256Id(text) !== expectedSha256)
    return {
      ok: false,
      message:
        "The delivered artifact bytes do not match their expected identity.",
    };
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, message: "The delivered artifact is not JSON." };
  }
  const parsed = parseRefrainArtifact(value);
  return parsed.ok
    ? { ok: true, artifact: parsed.artifact }
    : { ok: false, message: parsed.errors.join(" ") };
}

export function decodeInlinePresentationRef(
  ref: PresentationRefV0,
): { ok: true; artifact: RefrainArtifact } | { ok: false; message: string } {
  if (ref.delivery.kind !== "inline")
    return { ok: false, message: "This presentation reference is not inline." };
  if (ref.delivery.fragment.length > MAX_PRESENTATION_FRAGMENT_CHARS)
    return { ok: false, message: "The inline presentation is too large." };
  const bytes = base64UrlToBytes(ref.delivery.fragment);
  if (!bytes)
    return { ok: false, message: "The inline presentation is malformed." };
  return parseArtifactBytes(bytes, ref.artifactSha256);
}
