import { verifyAssetBytes } from "./digest.js";
import type { AssetRequirementV3 } from "./execution.js";

export type VerifiedAssetState =
  "absent" | "fetching" | "verified-bytes" | "decoding" | "decoded" | "failed";

export interface DecodedExecutionAsset<T> {
  value: T;
  decodedBytes: number;
}

export interface VerifiedAssetStoreOptions<T> {
  requirements: readonly AssetRequirementV3[];
  maxConcurrentFetches: number;
  maxConcurrentDecodes: number;
  rawCacheBudgetBytes: number;
  decodedCacheBudgetBytes: number;
  fetchBytes: (
    requirement: AssetRequirementV3,
    signal: AbortSignal,
  ) => Promise<ArrayBuffer>;
  decode: (
    requirement: AssetRequirementV3,
    bytes: ArrayBuffer,
    signal: AbortSignal,
  ) => Promise<DecodedExecutionAsset<T>>;
}

export interface AssetPreparationEvidence {
  assetId: string;
  state: VerifiedAssetState;
  byteCache: "cold" | "warm";
  decodeCache: "cold" | "warm";
  fetchMs: number;
  verifyMs: number;
  decodeMs: number;
}

interface AssetEntry<T> {
  state: VerifiedAssetState;
  bytes?: ArrayBuffer;
  decoded?: T;
  decodedBytes: number;
  lastUsed: number;
  error?: Error;
  pending?: AssetTask;
}

interface AssetTask {
  controller: AbortController;
  promise: Promise<AssetPreparationEvidence>;
  subscribers: Set<symbol>;
  settled: boolean;
}

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit <= 0)
      throw new Error("Asset concurrency must be a positive integer.");
  }

  async use<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit)
      await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

function timeNow(): number {
  return globalThis.performance.now();
}

export class VerifiedAssetStore<T> {
  private readonly requirements: Map<string, AssetRequirementV3>;
  private readonly entries = new Map<string, AssetEntry<T>>();
  private readonly fetchSemaphore: Semaphore;
  private readonly decodeSemaphore: Semaphore;
  private readonly options: VerifiedAssetStoreOptions<T>;
  private rawBytes = 0;
  private decodedBytes = 0;
  private counter = 0;

  constructor(options: VerifiedAssetStoreOptions<T>) {
    this.options = options;
    this.requirements = new Map(
      options.requirements.map((requirement) => [
        requirement.assetId,
        requirement,
      ]),
    );
    this.fetchSemaphore = new Semaphore(options.maxConcurrentFetches);
    this.decodeSemaphore = new Semaphore(options.maxConcurrentDecodes);
  }

  state(assetId: string): VerifiedAssetState {
    return this.entries.get(assetId)?.state ?? "absent";
  }

  bytes(assetId: string): ArrayBuffer | undefined {
    return this.entries.get(assetId)?.bytes;
  }

  decoded(assetId: string): T | undefined {
    const entry = this.entries.get(assetId);
    if (entry?.decoded !== undefined) entry.lastUsed = ++this.counter;
    return entry?.decoded;
  }

  cacheUsage(): { rawBytes: number; decodedBytes: number } {
    return { rawBytes: this.rawBytes, decodedBytes: this.decodedBytes };
  }

  async prepare(
    assetId: string,
    signal: AbortSignal,
  ): Promise<AssetPreparationEvidence> {
    if (signal.aborted) return Promise.reject(signal.reason);
    const requirement = this.requirements.get(assetId);
    if (!requirement) throw new Error(`Unknown execution asset ${assetId}.`);
    const present = this.entries.get(assetId);
    if (present?.state === "decoded") {
      present.lastUsed = ++this.counter;
      return {
        assetId,
        state: "decoded",
        byteCache: "warm",
        decodeCache: "warm",
        fetchMs: 0,
        verifyMs: 0,
        decodeMs: 0,
      };
    }
    if (present?.pending) return this.subscribe(present.pending, signal);
    const entry = present ?? {
      state: "absent" as const,
      decodedBytes: 0,
      lastUsed: ++this.counter,
    };
    const controller = new AbortController();
    const task: AssetTask = {
      controller,
      promise: this.prepareEntry(requirement, entry, controller.signal),
      subscribers: new Set(),
      settled: false,
    };
    entry.pending = task;
    this.entries.set(assetId, entry);
    task.promise.then(
      () => this.settleTask(entry, task),
      () => this.settleTask(entry, task),
    );
    return this.subscribe(task, signal);
  }

  async prepareMany(
    assetIds: readonly string[],
    signal: AbortSignal,
  ): Promise<AssetPreparationEvidence[]> {
    return Promise.all(
      assetIds.map((assetId) => this.prepare(assetId, signal)),
    );
  }

  private async prepareEntry(
    requirement: AssetRequirementV3,
    entry: AssetEntry<T>,
    signal: AbortSignal,
  ): Promise<AssetPreparationEvidence> {
    let fetchMs = 0;
    let verifyMs = 0;
    let decodeMs = 0;
    const byteCache = entry.bytes ? "warm" : "cold";
    try {
      if (!entry.bytes) {
        entry.state = "fetching";
        const fetchStarted = timeNow();
        const loaded = await this.fetchSemaphore.use(() =>
          this.options.fetchBytes(requirement, signal),
        );
        fetchMs = timeNow() - fetchStarted;
        if (signal.aborted) throw signal.reason;
        const verifyStarted = timeNow();
        const verified = await verifyAssetBytes(requirement, loaded);
        verifyMs = timeNow() - verifyStarted;
        entry.bytes = verified.data;
        this.rawBytes += verified.data.byteLength;
        entry.state = "verified-bytes";
        this.evictRaw(requirement.assetId);
      }
      entry.state = "decoding";
      const decodeStarted = timeNow();
      const decoded = await this.decodeSemaphore.use(() =>
        this.options.decode(requirement, entry.bytes!.slice(0), signal),
      );
      decodeMs = timeNow() - decodeStarted;
      if (signal.aborted) throw signal.reason;
      if (
        !Number.isSafeInteger(decoded.decodedBytes) ||
        decoded.decodedBytes < 0
      )
        throw new Error(
          `Decoded asset ${requirement.assetId} reported an invalid retained byte count.`,
        );
      if (decoded.decodedBytes > this.options.decodedCacheBudgetBytes)
        throw new Error(
          `Decoded asset ${requirement.assetId} retains ${decoded.decodedBytes} bytes, exceeding the ${this.options.decodedCacheBudgetBytes}-byte cache budget.`,
        );
      entry.decoded = decoded.value;
      entry.decodedBytes = decoded.decodedBytes;
      entry.lastUsed = ++this.counter;
      entry.state = "decoded";
      this.decodedBytes += decoded.decodedBytes;
      this.releaseRaw(entry);
      this.evictDecoded(requirement.assetId);
      return {
        assetId: requirement.assetId,
        state: "decoded",
        byteCache,
        decodeCache: "cold",
        fetchMs,
        verifyMs,
        decodeMs,
      };
    } catch (cause) {
      entry.state = "failed";
      entry.error =
        cause instanceof Error
          ? cause
          : new Error(`Asset ${requirement.assetId} preparation failed.`);
      throw entry.error;
    }
  }

  private settleTask(entry: AssetEntry<T>, task: AssetTask): void {
    task.settled = true;
    if (entry.pending === task) entry.pending = undefined;
  }

  private subscribe(
    task: AssetTask,
    signal: AbortSignal,
  ): Promise<AssetPreparationEvidence> {
    if (signal.aborted) {
      this.abortTaskIfStillOrphaned(task, signal.reason);
      return Promise.reject(signal.reason);
    }
    const subscriber = Symbol("asset-subscriber");
    task.subscribers.add(subscriber);
    return new Promise<AssetPreparationEvidence>((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", onAbort);
        task.subscribers.delete(subscriber);
      };
      const onAbort = () => {
        finish();
        this.abortTaskIfStillOrphaned(task, signal.reason);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      task.promise.then(
        (evidence) => {
          finish();
          resolve(evidence);
        },
        (cause) => {
          finish();
          reject(cause);
        },
      );
    });
  }

  private abortTaskIfStillOrphaned(task: AssetTask, reason: unknown): void {
    queueMicrotask(() => {
      if (task.subscribers.size === 0 && !task.settled)
        task.controller.abort(reason);
    });
  }

  private releaseRaw(entry: AssetEntry<T>): void {
    if (!entry.bytes) return;
    this.rawBytes -= entry.bytes.byteLength;
    entry.bytes = undefined;
  }

  private evictRaw(pinnedAssetId: string): void {
    while (this.rawBytes > this.options.rawCacheBudgetBytes) {
      const candidate = [...this.entries]
        .filter(
          ([assetId, entry]) =>
            assetId !== pinnedAssetId &&
            entry.bytes !== undefined &&
            entry.pending === undefined,
        )
        .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
      if (!candidate) return;
      const [, entry] = candidate;
      this.releaseRaw(entry);
      if (entry.decoded === undefined) entry.state = "absent";
    }
  }

  private evictDecoded(pinnedAssetId: string): void {
    while (this.decodedBytes > this.options.decodedCacheBudgetBytes) {
      const candidate = [...this.entries]
        .filter(
          ([assetId, entry]) =>
            assetId !== pinnedAssetId && entry.decoded !== undefined,
        )
        .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
      if (!candidate) return;
      const [, entry] = candidate;
      entry.decoded = undefined;
      entry.state = entry.bytes ? "verified-bytes" : "absent";
      this.decodedBytes -= entry.decodedBytes;
      entry.decodedBytes = 0;
    }
  }
}
