import { describe, expect, it } from "vitest";
import { sha256Bytes } from "./digest.js";
import { VerifiedAssetStore } from "./verified-asset-store.js";

async function fixture() {
  const bytes = new TextEncoder().encode("verified asset").buffer;
  const sha256 = await sha256Bytes(bytes);
  return { bytes, sha256 };
}

describe("VerifiedAssetStore", () => {
  it("deduplicates work and verifies before bounded decode", async () => {
    const { bytes, sha256 } = await fixture();
    let fetches = 0;
    let decodes = 0;
    const store = new VerifiedAssetStore<string>({
      requirements: [
        {
          assetId: "one",
          kind: "wav",
          bytes: bytes.byteLength,
          sha256,
          candidateIds: ["candidate"],
          firstUseSeconds: 0,
          lastUseSeconds: 2,
          useCount: 1,
        },
      ],
      maxConcurrentFetches: 1,
      maxConcurrentDecodes: 1,
      rawCacheBudgetBytes: 128,
      decodedCacheBudgetBytes: 128,
      fetchBytes: async () => {
        fetches += 1;
        return bytes.slice(0);
      },
      decode: async (_requirement, verified) => {
        decodes += 1;
        return {
          value: new TextDecoder().decode(verified),
          decodedBytes: verified.byteLength,
        };
      },
    });
    const controller = new AbortController();
    const [first, second] = await Promise.all([
      store.prepare("one", controller.signal),
      store.prepare("one", controller.signal),
    ]);
    expect(first.state).toBe("decoded");
    expect(second.state).toBe("decoded");
    expect(fetches).toBe(1);
    expect(decodes).toBe(1);
    expect(store.decoded("one")).toBe("verified asset");
    expect(store.bytes("one")).toBeUndefined();
    expect(store.cacheUsage()).toEqual({
      rawBytes: 0,
      decodedBytes: bytes.byteLength,
    });
  });

  it("never decodes same-size corruption", async () => {
    const { bytes, sha256 } = await fixture();
    const corrupt = bytes.slice(0);
    const corruptView = new Uint8Array(corrupt);
    corruptView[0] = corruptView[0]! ^ 0xff;
    let decoded = false;
    const store = new VerifiedAssetStore<string>({
      requirements: [
        {
          assetId: "one",
          kind: "wav",
          bytes: bytes.byteLength,
          sha256,
          candidateIds: ["candidate"],
          firstUseSeconds: 0,
          lastUseSeconds: 2,
          useCount: 1,
        },
      ],
      maxConcurrentFetches: 1,
      maxConcurrentDecodes: 1,
      rawCacheBudgetBytes: 128,
      decodedCacheBudgetBytes: 128,
      fetchBytes: async () => corrupt,
      decode: async () => {
        decoded = true;
        return { value: "bad", decodedBytes: 1 };
      },
    });
    await expect(
      store.prepare("one", new AbortController().signal),
    ).rejects.toThrow(/SHA-256/);
    expect(decoded).toBe(false);
  });

  it("separates shared work from subscriber cancellation", async () => {
    const { bytes, sha256 } = await fixture();
    let finishFetch!: (value: ArrayBuffer) => void;
    let fetches = 0;
    const store = new VerifiedAssetStore<string>({
      requirements: [
        {
          assetId: "one",
          kind: "wav",
          bytes: bytes.byteLength,
          sha256,
          candidateIds: ["candidate"],
          firstUseSeconds: 0,
          lastUseSeconds: 2,
          useCount: 1,
        },
      ],
      maxConcurrentFetches: 1,
      maxConcurrentDecodes: 1,
      rawCacheBudgetBytes: 128,
      decodedCacheBudgetBytes: 128,
      fetchBytes: async () => {
        fetches += 1;
        return new Promise<ArrayBuffer>((resolve) => {
          finishFetch = resolve;
        });
      },
      decode: async (_requirement, verified) => ({
        value: new TextDecoder().decode(verified),
        decodedBytes: verified.byteLength,
      }),
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = store.prepare("one", firstController.signal);
    const second = store.prepare("one", secondController.signal);
    firstController.abort(new DOMException("first left", "AbortError"));
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    finishFetch(bytes.slice(0));
    await expect(second).resolves.toMatchObject({ state: "decoded" });
    expect(fetches).toBe(1);
  });

  it("hands pending work to a replacement operation in the same turn", async () => {
    const { bytes, sha256 } = await fixture();
    let finishFetch!: (value: ArrayBuffer) => void;
    let fetches = 0;
    const store = new VerifiedAssetStore<string>({
      requirements: [
        {
          assetId: "one",
          kind: "wav",
          bytes: bytes.byteLength,
          sha256,
          candidateIds: ["candidate"],
          firstUseSeconds: 0,
          lastUseSeconds: 2,
          useCount: 1,
        },
      ],
      maxConcurrentFetches: 1,
      maxConcurrentDecodes: 1,
      rawCacheBudgetBytes: 128,
      decodedCacheBudgetBytes: 128,
      fetchBytes: async () => {
        fetches += 1;
        return new Promise<ArrayBuffer>((resolve) => {
          finishFetch = resolve;
        });
      },
      decode: async (_requirement, verified) => ({
        value: new TextDecoder().decode(verified),
        decodedBytes: verified.byteLength,
      }),
    });
    const superseded = new AbortController();
    const replacement = new AbortController();
    const first = store.prepare("one", superseded.signal);

    superseded.abort(new DOMException("seek replaced play", "AbortError"));
    const second = store.prepare("one", replacement.signal);
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    finishFetch(bytes.slice(0));

    await expect(second).resolves.toMatchObject({ state: "decoded" });
    expect(fetches).toBe(1);
  });

  it("aborts underlying work after its final subscriber leaves", async () => {
    const { bytes, sha256 } = await fixture();
    let underlyingAborted = false;
    const store = new VerifiedAssetStore<string>({
      requirements: [
        {
          assetId: "one",
          kind: "wav",
          bytes: bytes.byteLength,
          sha256,
          candidateIds: ["candidate"],
          firstUseSeconds: 0,
          lastUseSeconds: 2,
          useCount: 1,
        },
      ],
      maxConcurrentFetches: 1,
      maxConcurrentDecodes: 1,
      rawCacheBudgetBytes: 128,
      decodedCacheBudgetBytes: 128,
      fetchBytes: async (_requirement, signal) =>
        new Promise<ArrayBuffer>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              underlyingAborted = true;
              reject(signal.reason);
            },
            { once: true },
          );
        }),
      decode: async () => ({ value: "unreachable", decodedBytes: 1 }),
    });
    const controller = new AbortController();
    const pending = store.prepare("one", controller.signal);
    controller.abort(new DOMException("last left", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    expect(underlyingAborted).toBe(true);
  });

  it("evicts failed-decode raw bytes by LRU within the independent budget", async () => {
    const { bytes, sha256 } = await fixture();
    const requirement = (assetId: string) => ({
      assetId,
      kind: "wav" as const,
      bytes: bytes.byteLength,
      sha256,
      candidateIds: ["candidate"],
      firstUseSeconds: 0,
      lastUseSeconds: 2,
      useCount: 1,
    });
    const store = new VerifiedAssetStore<string>({
      requirements: [requirement("one"), requirement("two")],
      maxConcurrentFetches: 1,
      maxConcurrentDecodes: 1,
      rawCacheBudgetBytes: bytes.byteLength,
      decodedCacheBudgetBytes: 128,
      fetchBytes: async () => bytes.slice(0),
      decode: async () => {
        throw new Error("decoder unavailable");
      },
    });
    await expect(
      store.prepare("one", new AbortController().signal),
    ).rejects.toThrow(/decoder unavailable/);
    await expect(
      store.prepare("two", new AbortController().signal),
    ).rejects.toThrow(/decoder unavailable/);
    expect(store.bytes("one")).toBeUndefined();
    expect(store.bytes("two")?.byteLength).toBe(bytes.byteLength);
    expect(store.cacheUsage().rawBytes).toBe(bytes.byteLength);
  });

  it("evicts by the decoder's complete retained-memory charge", async () => {
    const { bytes, sha256 } = await fixture();
    const requirement = (assetId: string) => ({
      assetId,
      kind: "wav" as const,
      bytes: bytes.byteLength,
      sha256,
      candidateIds: ["candidate"],
      firstUseSeconds: 0,
      lastUseSeconds: 2,
      useCount: 1,
    });
    const store = new VerifiedAssetStore<{ retained: Uint8Array }>({
      requirements: [requirement("one"), requirement("two")],
      maxConcurrentFetches: 1,
      maxConcurrentDecodes: 1,
      rawCacheBudgetBytes: 128,
      decodedCacheBudgetBytes: 100,
      fetchBytes: async () => bytes.slice(0),
      decode: async () => ({
        value: { retained: new Uint8Array(80) },
        decodedBytes: 80,
      }),
    });
    const signal = new AbortController().signal;

    await store.prepare("one", signal);
    await store.prepare("two", signal);

    expect(store.decoded("one")).toBeUndefined();
    expect(store.decoded("two")?.retained).toHaveLength(80);
    expect(store.cacheUsage()).toEqual({ rawBytes: 0, decodedBytes: 80 });
  });

  it("rejects a decoded asset whose retained charge cannot fit the budget", async () => {
    const { bytes, sha256 } = await fixture();
    const store = new VerifiedAssetStore<{ retained: Uint8Array }>({
      requirements: [
        {
          assetId: "oversized",
          kind: "wav",
          bytes: bytes.byteLength,
          sha256,
          candidateIds: ["candidate"],
          firstUseSeconds: 0,
          lastUseSeconds: 2,
          useCount: 1,
        },
      ],
      maxConcurrentFetches: 1,
      maxConcurrentDecodes: 1,
      rawCacheBudgetBytes: 128,
      decodedCacheBudgetBytes: 64,
      fetchBytes: async () => bytes.slice(0),
      decode: async () => ({
        value: { retained: new Uint8Array(80) },
        decodedBytes: 80,
      }),
    });

    await expect(
      store.prepare("oversized", new AbortController().signal),
    ).rejects.toThrow(
      "Decoded asset oversized retains 80 bytes, exceeding the 64-byte cache budget.",
    );
    expect(store.decoded("oversized")).toBeUndefined();
    expect(store.cacheUsage().decodedBytes).toBe(0);
  });
});
