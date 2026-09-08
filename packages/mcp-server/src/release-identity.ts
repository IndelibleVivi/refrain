import { readFileSync } from "node:fs";

const GIT_REVISION = /^[0-9a-f]{40}$/;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function validFileManifest(value: unknown): value is Array<{
  path: string;
  bytes: number;
  sha256: string;
}> {
  if (!Array.isArray(value) || value.length === 0) return false;
  const paths = new Set<string>();
  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.path !== "string" ||
      entry.path.length === 0 ||
      entry.path.startsWith("/") ||
      entry.path.split("/").includes("..") ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      typeof entry.sha256 !== "string" ||
      !SHA256_HEX.test(entry.sha256) ||
      paths.has(entry.path)
    )
      return false;
    paths.add(entry.path);
  }
  return true;
}

export interface RuntimeReleaseIdentity {
  format: "refrain-mcp-runtime@1-experimental";
  sourceRevision: string;
  bundleDigest: string;
  fileCount: number;
}

export function loadRuntimeReleaseIdentity(
  path = process.env.REFRAIN_RELEASE_FILE,
): RuntimeReleaseIdentity | undefined {
  if (!path) return undefined;
  const value = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    unknown
  >;
  if (
    value.format !== "refrain-mcp-runtime@1-experimental" ||
    typeof value.sourceRevision !== "string" ||
    !GIT_REVISION.test(value.sourceRevision) ||
    value.sourceDirty !== false ||
    typeof value.bundleDigest !== "string" ||
    !SHA256_ID.test(value.bundleDigest) ||
    !validFileManifest(value.files)
  )
    throw new Error(
      "REFRAIN_RELEASE_FILE does not contain a clean runtime@1 identity.",
    );
  return {
    format: value.format,
    sourceRevision: value.sourceRevision,
    bundleDigest: value.bundleDigest,
    fileCount: value.files.length,
  };
}
