import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildShinyguitarAcousticPack,
  loadShinyguitarExpectedAssets,
} from "./build-shinyguitar-candidate.js";

const SOURCE_ROOT = process.env.REFRAIN_SHINYGUITAR_SOURCE_ROOT ?? "";

describe.runIf(
  SOURCE_ROOT.length > 0 && existsSync(`${SOURCE_ROOT}/Programs/acoustic.sfz`),
)("Shinyguitar rebuild lock", () => {
  it("rejects local sample bytes outside the checked-in upstream lock", async () => {
    const expected = await loadShinyguitarExpectedAssets(process.cwd());
    expect(expected.size).toBe(272);
    const changed = new Map(expected);
    const [firstPath, first] = changed.entries().next().value!;
    changed.set(firstPath, { ...first, sha256: "0".repeat(64) });
    await expect(
      buildShinyguitarAcousticPack(SOURCE_ROOT, changed),
    ).rejects.toThrow(/does not match its checked-in byte\/SHA lock/);
  });
});
