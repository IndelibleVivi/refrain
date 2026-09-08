import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SoundAssetDefinition } from "@refrain/soundpack";
import {
  FileContentAddressedStore,
  ensureAssetClosure,
} from "./content-addressed-store.js";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

function assetOf(bytes: Uint8Array): SoundAssetDefinition {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    id: "fixture-wave",
    kind: "wav",
    source: {
      repository: "https://assets.example/refrain",
      ref: "a".repeat(40),
      url: "https://assets.example/fixture.wav",
    },
    localPath: "soundpacks/fixture.wav",
    bytes: bytes.byteLength,
    sha256,
    audio: { sampleRate: 48_000, frameCount: 1, channels: 1 },
    license: {
      expression: "CC0-1.0",
      path: "third_party/fixture/LICENSE.txt",
      assetScope: "test fixture",
    },
    processingHistory: [
      {
        operation: "identity-copy",
        tool: "fixture",
        inputSha256: sha256,
        outputSha256: sha256,
        parameters: {},
      },
    ],
    releaseStatus: "listening-candidate",
    publicReleaseAccepted: false,
  };
}

describe("FileContentAddressedStore", () => {
  it("coalesces exact downloads, publishes verified content, and projects it", async () => {
    const bytes = new Uint8Array([82, 73, 70, 70]);
    const asset = assetOf(bytes);
    const root = await mkdtemp(resolve(tmpdir(), "refrain-cas-"));
    roots.push(root);
    const fetchMock = vi.fn(async () => new Response(bytes));
    vi.stubGlobal("fetch", fetchMock);
    const store = new FileContentAddressedStore({
      root,
      allowedOrigins: ["https://assets.example"],
      maxAssetBytes: 1024,
    });

    const [left, right] = await Promise.all([
      store.ensure(asset),
      store.ensure(asset),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(left).toEqual(right);
    expect(left.cache).toBe("cold");
    expect(new Uint8Array(await readFile(left.contentPath))).toEqual(bytes);

    const projection = resolve(root, "projection", asset.localPath);
    await store.project(left, projection);
    expect(new Uint8Array(await readFile(projection))).toEqual(bytes);
    expect((await store.ensure(asset)).cache).toBe("warm");

    const adoptedRoot = await mkdtemp(resolve(tmpdir(), "refrain-cas-"));
    roots.push(adoptedRoot);
    const adoptedStore = new FileContentAddressedStore({
      root: adoptedRoot,
      allowedOrigins: ["https://assets.example"],
      maxAssetBytes: 1024,
    });
    expect((await adoptedStore.adopt(asset, projection))?.cache).toBe("warm");
    expect((await adoptedStore.ensure(asset)).cache).toBe("warm");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects corruption, disallowed origins, and closure budget overflow", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const asset = assetOf(bytes);
    const root = await mkdtemp(resolve(tmpdir(), "refrain-cas-"));
    roots.push(root);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([4, 3, 2, 1]))),
    );
    const store = new FileContentAddressedStore({
      root,
      allowedOrigins: ["https://assets.example"],
      maxAssetBytes: 1024,
    });
    await expect(store.ensure(asset)).rejects.toThrow(
      "did not match its pinned bytes/SHA-256",
    );
    await expect(
      ensureAssetClosure([asset], store, {
        maxAssets: 0,
        maxBytes: 1024,
        maxConcurrentFetches: 1,
      }),
    ).rejects.toThrow("limit is 0");

    const wrongOrigin = structuredClone(asset);
    wrongOrigin.source.url = "https://elsewhere.example/fixture.wav";
    await expect(store.ensure(wrongOrigin)).rejects.toThrow(
      "uses disallowed origin",
    );
  });

  it("coalesces one exact source container and verifies each extracted member", async () => {
    const archive = new Uint8Array([55, 122, 1, 2, 3]);
    const leftBytes = new Uint8Array([82, 73, 70, 70, 1]);
    const rightBytes = new Uint8Array([82, 73, 70, 70, 2]);
    const archiveSha256 = createHash("sha256").update(archive).digest("hex");
    const containerAsset = (
      id: string,
      memberPath: string,
      bytes: Uint8Array,
    ): SoundAssetDefinition => {
      const asset = assetOf(bytes);
      return {
        ...asset,
        id,
        source: {
          repository: "https://assets.example/container",
          ref: archiveSha256,
          url: "https://assets.example/bank.7z",
          path: memberPath,
          container: {
            format: "7z",
            bytes: archive.byteLength,
            sha256: archiveSha256,
            memberPath,
          },
        },
      };
    };
    const leftAsset = containerAsset("left-wave", "bank/left.wav", leftBytes);
    const rightAsset = containerAsset(
      "right-wave",
      "bank/right.wav",
      rightBytes,
    );
    const members = new Map([
      ["bank/left.wav", leftBytes],
      ["bank/right.wav", rightBytes],
    ]);
    const root = await mkdtemp(resolve(tmpdir(), "refrain-cas-"));
    roots.push(root);
    const fetchMock = vi.fn(async () => new Response(archive));
    vi.stubGlobal("fetch", fetchMock);
    const store = new FileContentAddressedStore({
      root,
      allowedOrigins: ["https://assets.example"],
      maxAssetBytes: 1024,
      extractContainer: async (_container, member, target) => {
        await writeFile(target, members.get(member)!);
      },
    });

    const acquired = await ensureAssetClosure([leftAsset, rightAsset], store, {
      maxAssets: 2,
      maxBytes: 1024,
      maxConcurrentFetches: 2,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(await readFile(acquired[0]!.contentPath))).toEqual(
      leftBytes,
    );
    expect(new Uint8Array(await readFile(acquired[1]!.contentPath))).toEqual(
      rightBytes,
    );
  });

  it("reports bounded acquisition progress as each exact asset settles", async () => {
    const left = assetOf(new Uint8Array([1, 2, 3]));
    left.id = "left-wave";
    left.source.url = "https://assets.example/left.wav";
    const right = assetOf(new Uint8Array([4, 5, 6, 7]));
    right.id = "right-wave";
    right.source.url = "https://assets.example/right.wav";
    const payloads = new Map([
      [left.source.url, new Uint8Array([1, 2, 3])],
      [right.source.url, new Uint8Array([4, 5, 6, 7])],
    ]);
    const root = await mkdtemp(resolve(tmpdir(), "refrain-cas-"));
    roots.push(root);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | RequestInfo) =>
        Promise.resolve(new Response(payloads.get(String(url))!)),
      ),
    );
    const store = new FileContentAddressedStore({
      root,
      allowedOrigins: ["https://assets.example"],
      maxAssetBytes: 1024,
    });
    const progress: Array<{
      completedAssets: number;
      completedBytes: number;
      totalAssets: number;
      totalBytes: number;
    }> = [];

    await ensureAssetClosure([left, right], store, {
      maxAssets: 2,
      maxBytes: 1024,
      maxConcurrentFetches: 2,
      onProgress: ({ acquired: _acquired, ...event }) => progress.push(event),
    });

    expect(progress).toHaveLength(2);
    expect(progress.map((event) => event.completedAssets).sort()).toEqual([
      1, 2,
    ]);
    expect(progress.at(-1)).toEqual({
      completedAssets: 2,
      completedBytes: 7,
      totalAssets: 2,
      totalBytes: 7,
    });
  });
});
