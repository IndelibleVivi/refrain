import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  REFRAIN_ARTIFACT_MEDIA_TYPE,
  type PresentationRefV0,
} from "@refrain/renderer/presentation-ref";

export const PRESENTATION_SESSION_FORMAT =
  "refrain-presentation-session@0-experimental" as const;

export interface PresentationSessionRecordV0 {
  format: typeof PRESENTATION_SESSION_FORMAT;
  artifactSha256: string;
  tokenHash: string;
  operatorScope: string;
  createdAt: string;
  expiresAt: string;
  mediaType: typeof REFRAIN_ARTIFACT_MEDIA_TYPE;
  artifactBytes: Uint8Array;
}

export type SessionLookup =
  | { ok: true; record: PresentationSessionRecordV0 }
  | {
      ok: false;
      reason: "missing" | "expired" | "wrong-scope" | "identity-mismatch";
    };

function tokenHash(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

export class PresentationSessionStore {
  private readonly records = new Map<string, PresentationSessionRecordV0>();

  constructor(
    readonly operatorScope: string,
    readonly ttlMs = 15 * 60 * 1_000,
  ) {
    if (!operatorScope)
      throw new Error("Presentation session scope is required.");
    if (!Number.isFinite(ttlMs) || ttlMs <= 0)
      throw new Error("Presentation session TTL must be greater than zero.");
  }

  create(
    artifactBytes: Uint8Array,
    artifactSha256: string,
    hrefBase: string,
    now = Date.now(),
  ): {
    token: string;
    ref: PresentationRefV0 & {
      delivery: { kind: "session"; href: string; expiresAt: string };
    };
  } {
    const token = randomBytes(24).toString("base64url");
    const hash = tokenHash(token);
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + this.ttlMs).toISOString();
    this.records.set(hash, {
      format: PRESENTATION_SESSION_FORMAT,
      artifactSha256,
      tokenHash: hash,
      operatorScope: this.operatorScope,
      createdAt,
      expiresAt,
      mediaType: REFRAIN_ARTIFACT_MEDIA_TYPE,
      artifactBytes: artifactBytes.slice(),
    });
    return {
      token,
      ref: {
        format: "refrain-presentation-ref@0-experimental",
        artifactSha256,
        mediaType: REFRAIN_ARTIFACT_MEDIA_TYPE,
        delivery: {
          kind: "session",
          href: `${hrefBase.replace(/\/$/, "")}/${token}?artifactSha256=${encodeURIComponent(artifactSha256)}`,
          expiresAt,
        },
      },
    };
  }

  resolve(
    token: string,
    expectedArtifactSha256: string,
    operatorScope: string,
    now = Date.now(),
  ): SessionLookup {
    const hash = tokenHash(token);
    const record = this.records.get(hash);
    if (!record) return { ok: false, reason: "missing" };
    if (record.operatorScope !== operatorScope)
      return { ok: false, reason: "wrong-scope" };
    if (Date.parse(record.expiresAt) <= now) {
      this.records.delete(hash);
      return { ok: false, reason: "expired" };
    }
    if (record.artifactSha256 !== expectedArtifactSha256)
      return { ok: false, reason: "identity-mismatch" };
    return { ok: true, record };
  }

  recordKeys(): string[] {
    return [...this.records.keys()];
  }
}

function respondJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

export function presentationSessionHandler(
  store: PresentationSessionStore,
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const match = /^\/session\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    const expected = url.searchParams.get("artifactSha256");
    if (request.method !== "GET" || !match || !expected) {
      respondJson(response, 404, { ok: false, reason: "missing" });
      return;
    }
    const result = store.resolve(match[1]!, expected, store.operatorScope);
    if (!result.ok) {
      const status = result.reason === "expired" ? 410 : 404;
      respondJson(response, status, result);
      return;
    }
    response.statusCode = 200;
    response.setHeader("Content-Type", result.record.mediaType);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "X-Refrain-Artifact-Sha256",
      result.record.artifactSha256,
    );
    response.end(result.record.artifactBytes);
  };
}
