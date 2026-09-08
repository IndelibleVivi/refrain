import { AIR_V1_FORMAT } from "@refrain/air-schema/v1";
import { hum, type HumInput, type HumResult } from "./hum.js";
import {
  humV1,
  type HumInputV1,
  type HumResultV1,
  type HumV1Defaults,
} from "./hum-v1.js";

function formatOf(input: string | unknown): unknown {
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

export function humAny(
  input: HumInput | HumInputV1,
  airV1Defaults: HumV1Defaults = {},
): HumResult | HumResultV1 {
  return formatOf(input.air) === AIR_V1_FORMAT
    ? humV1(input as HumInputV1, airV1Defaults)
    : hum(input as HumInput);
}
