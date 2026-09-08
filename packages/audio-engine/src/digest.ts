export { sha256Hex } from "@refrain/soundpack";

export interface AssetByteExpectation {
  assetId: string;
  bytes: number;
  sha256: string;
}

export interface VerifiedAssetBytes {
  assetId: string;
  bytes: number;
  sha256: string;
  data: ArrayBuffer;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Bytes(bytes: ArrayBuffer): Promise<string> {
  return hex(await globalThis.crypto.subtle.digest("SHA-256", bytes));
}

export async function verifyAssetBytes(
  expected: AssetByteExpectation,
  bytes: ArrayBuffer,
): Promise<VerifiedAssetBytes> {
  if (bytes.byteLength !== expected.bytes) {
    throw new Error(
      `${expected.assetId} loaded ${bytes.byteLength} bytes; the manifest requires ${expected.bytes}.`,
    );
  }
  const actualSha256 = await sha256Bytes(bytes);
  if (actualSha256 !== expected.sha256) {
    throw new Error(
      `${expected.assetId} failed SHA-256 verification: expected ${expected.sha256}, received ${actualSha256}.`,
    );
  }
  return {
    assetId: expected.assetId,
    bytes: bytes.byteLength,
    sha256: actualSha256,
    data: bytes,
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalValue(record[key])]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}
