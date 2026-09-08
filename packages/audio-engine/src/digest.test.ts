import { describe, expect, it } from "vitest";
import { sha256Hex, verifyAssetBytes } from "./digest.js";

describe("portable SHA-256", () => {
  it("matches the standard UTF-8 vector", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("accepts only the exact byte count and SHA-256 declared by an asset", async () => {
    const bytes = new TextEncoder().encode("refrain").buffer;
    const expected = {
      assetId: "fixture",
      bytes: 7,
      sha256:
        "040f521d2c01bb99954a8285ddef4d98dd5749bb31323d643f65d9e2ec2445e9",
    };
    await expect(verifyAssetBytes(expected, bytes)).resolves.toMatchObject({
      assetId: "fixture",
      bytes: 7,
      sha256: expected.sha256,
    });
    await expect(
      verifyAssetBytes(expected, new TextEncoder().encode("refrain!").buffer),
    ).rejects.toThrow(/loaded 8 bytes/);
    await expect(
      verifyAssetBytes({ ...expected, sha256: "0".repeat(64) }, bytes),
    ).rejects.toThrow(/SHA-256/);
  });
});
