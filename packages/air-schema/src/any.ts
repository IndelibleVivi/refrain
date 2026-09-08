import {
  AIR_FORMAT,
  canonicalAirJson,
  parseAir,
  stringifyAir,
  type AirSource,
  type Diagnostic,
} from "./index.js";
import {
  AIR_V1_FORMAT,
  canonicalAirV1Json,
  parseAirV1,
  stringifyAirV1,
  type AirSourceV1,
} from "./v1.js";

export type AnyAirSource = AirSource | AirSourceV1;

export interface ParseAnyAirResult {
  source?: AnyAirSource;
  diagnostics: Diagnostic[];
}

function inputFormat(input: string | unknown): unknown {
  if (typeof input !== "string")
    return typeof input === "object" && input !== null
      ? (input as { format?: unknown }).format
      : undefined;
  try {
    const value = JSON.parse(input) as unknown;
    return typeof value === "object" && value !== null
      ? (value as { format?: unknown }).format
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseAnyAir(input: string | unknown): ParseAnyAirResult {
  const format = inputFormat(input);
  if (format === AIR_FORMAT) return parseAir(input);
  if (format === AIR_V1_FORMAT) return parseAirV1(input);
  return {
    diagnostics: [
      {
        severity: "error",
        code: "unsupported_format",
        path: "$.format",
        message: `Expected ${AIR_FORMAT} or ${AIR_V1_FORMAT}.`,
      },
    ],
  };
}

export function canonicalAnyAirJson(source: AnyAirSource): string {
  return source.format === AIR_FORMAT
    ? canonicalAirJson(source)
    : canonicalAirV1Json(source);
}

export function stringifyAnyAir(source: AnyAirSource): string {
  return source.format === AIR_FORMAT
    ? stringifyAir(source)
    : stringifyAirV1(source);
}
