import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const encoder = new TextEncoder();

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(encoder.encode(text)));
}

export function sha256Id(text: string): string {
  return `sha256:${sha256Hex(text)}`;
}
