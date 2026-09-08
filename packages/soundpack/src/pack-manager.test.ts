import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensionPack, createExtensionPackV1 } from "./vnext.js";
import { LocalPackManager } from "./pack-manager.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `refrain-${label}-`));
  roots.push(root);
  return root;
}

describe("LocalPackManager", () => {
  it("side-loads metadata, hydrates exact bytes, pins archives and uninstalls honestly", async () => {
    const source = await tempRoot("pack-source");
    const managed = await tempRoot("pack-managed");
    const bytes = new TextEncoder().encode("tiny exact proof asset");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const pack = createExtensionPack({
      id: "tiny-proof@0",
      version: "0.0.1",
      label: "Tiny proof",
      modules: [
        { kind: "render-scene", id: "tiny-room@1", sha256: "a".repeat(64) },
      ],
      assets: [{ id: "tiny-room-ir", sha256, bytes: bytes.byteLength }],
    });
    await mkdir(join(source, "assets"), { recursive: true });
    await writeFile(
      join(source, "pack.json"),
      `${JSON.stringify(pack, null, 2)}\n`,
    );
    await writeFile(join(source, "assets", "tiny-room-ir"), bytes);

    const manager = new LocalPackManager(managed);
    await manager.install(source);
    expect((await manager.list()).installed).toHaveLength(1);
    expect((await manager.list()).hydrated).toHaveLength(0);

    const hydrated = await manager.hydrate(pack.id, pack.version, [
      "tiny-room-ir",
    ]);
    expect(hydrated[0]?.sha256).toBe(sha256);
    expect(new Uint8Array(await readFile(hydrated[0]!.path))).toEqual(bytes);

    await manager.setShelf(pack.id, pack.version, true);
    await manager.pinArchive("sha256:" + "b".repeat(64), [
      {
        packId: pack.id,
        version: pack.version,
        packSha256: pack.contentSha256,
      },
    ]);
    await expect(manager.uninstall(pack.id, pack.version)).rejects.toThrow(
      /pinned by archive/,
    );
    await manager.unpinArchive("sha256:" + "b".repeat(64));
    await manager.uninstall(pack.id, pack.version);
    expect((await manager.list()).installed).toHaveLength(0);
    expect((await manager.list()).hydrated).toHaveLength(0);
  });

  it("installs metadata for an exact ExtensionPack@1 authoring vocabulary", async () => {
    const root = await mkdtemp(join(tmpdir(), "refrain-pack-manager-v1-"));
    const source = await mkdtemp(join(tmpdir(), "refrain-pack-source-v1-"));
    const manager = new LocalPackManager(root);
    try {
      const pack = createExtensionPackV1({
        id: "meter-language@1",
        version: "1.0.0",
        label: "Meter language",
        modules: [
          {
            kind: "authoring-vocabulary",
            id: "meter-language@0",
            sha256: "a".repeat(64),
          },
        ],
        assets: [],
      });
      await writeFile(join(source, "pack.json"), `${JSON.stringify(pack)}\n`);
      await expect(manager.install(source)).resolves.toMatchObject({
        id: pack.id,
        modules: [{ kind: "authoring-vocabulary" }],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(source, { recursive: true, force: true });
    }
  });
});
