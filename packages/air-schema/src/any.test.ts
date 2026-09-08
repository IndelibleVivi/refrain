import { describe, expect, it } from "vitest";
import { AIR_FORMAT } from "./index.js";
import { canonicalAnyAirJson, parseAnyAir } from "./any.js";
import { AIR_V1_FORMAT } from "./v1.js";
import { VALID_AIR_V1 } from "./v1.test.js";

describe("versioned AIR dispatch", () => {
  it("dispatches only the two complete source formats", () => {
    expect(parseAnyAir(VALID_AIR_V1).source?.format).toBe(AIR_V1_FORMAT);
    const legacy = {
      format: AIR_FORMAT,
      title: "Legacy",
      tempo: 60,
      meter: "4/4",
      motifs: {},
      voices: [
        {
          id: "piano",
          instrument: "warm_piano",
          role: "lead",
          part: "C4/1",
        },
      ],
    };
    expect(parseAnyAir(legacy).source?.format).toBe(AIR_FORMAT);
    expect(canonicalAnyAirJson(VALID_AIR_V1)).toContain('"conductor"');
    expect(
      parseAnyAir({ format: "air@1-partial" }).diagnostics[0],
    ).toMatchObject({
      code: "unsupported_format",
      path: "$.format",
    });
  });
});
