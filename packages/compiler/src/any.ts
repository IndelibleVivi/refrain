import { AIR_FORMAT } from "@refrain/air-schema";
import { AIR_V1_FORMAT } from "@refrain/air-schema/v1";
import {
  compileAir,
  type CompileAirOptions,
  type CompileAirResult,
} from "./index.js";
import { compileAirV1, type CompileAirV1Result } from "./v1.js";

export type CompileAnyAirResult = CompileAirResult | CompileAirV1Result;

function sourceFormat(input: string | unknown): unknown {
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

export function compileAnyAir(
  input: string | unknown,
  options: CompileAirOptions = {},
): CompileAnyAirResult {
  const format = sourceFormat(input);
  if (format === AIR_FORMAT) return compileAir(input, options);
  if (format === AIR_V1_FORMAT) return compileAirV1(input);
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
