import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareLocalAssetProjection } from "./local-asset-projection.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("local renderer asset projection", () => {
  it("atomically replaces stale soundpack files with one exact closure", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "refrain-projection-"));
    temporaryRoots.push(root);
    const sourceRoot = resolve(root, "source");
    const targetRoot = resolve(root, "target");
    const bytes = Buffer.from("exact sample bytes");
    const localPath = "soundpacks/example/sha256/exact.wav";
    await mkdir(resolve(sourceRoot, "soundpacks/example/sha256"), {
      recursive: true,
    });
    await writeFile(resolve(sourceRoot, localPath), bytes);
    await mkdir(resolve(targetRoot, "soundpacks/obsolete"), {
      recursive: true,
    });
    await writeFile(
      resolve(targetRoot, "soundpacks/obsolete/stale.wav"),
      "stale",
    );

    await prepareLocalAssetProjection({
      assets: [
        {
          assetId: "exact",
          bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          localPath,
        },
      ],
      sourceRoot,
      targetRoot,
      missingAssetHint: "Fetch the exact closure.",
    });

    await expect(readFile(resolve(targetRoot, localPath))).resolves.toEqual(
      bytes,
    );
    await expect(
      stat(resolve(targetRoot, "soundpacks/obsolete/stale.wav")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
