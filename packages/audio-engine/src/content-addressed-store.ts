import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { SoundAssetDefinition } from "@refrain/soundpack";
import { path7za } from "7zip-bin";

const SHA256 = /^[0-9a-f]{64}$/;

export interface ContentAddressedStoreOptions {
  root: string;
  allowedOrigins: readonly string[];
  maxAssetBytes: number;
  extractContainer?: (
    containerPath: string,
    memberPath: string,
    targetPath: string,
  ) => Promise<void>;
}

export interface AssetAcquisitionLimits {
  maxAssets: number;
  maxBytes: number;
  maxConcurrentFetches: number;
  onProgress?: (progress: AssetAcquisitionProgress) => void;
}

export interface AcquiredAsset {
  assetId: string;
  sha256: string;
  bytes: number;
  cache: "cold" | "warm";
  contentPath: string;
}

export interface AssetAcquisitionProgress {
  acquired: AcquiredAsset;
  completedAssets: number;
  completedBytes: number;
  totalAssets: number;
  totalBytes: number;
}

async function fileDigest(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function matches(
  path: string,
  expected: { bytes: number; sha256: string },
): Promise<boolean> {
  try {
    const file = await stat(path);
    return (
      file.size === expected.bytes &&
      (await fileDigest(path)) === expected.sha256
    );
  } catch {
    return false;
  }
}

async function describeMismatch(
  path: string,
  expected: { bytes: number; sha256: string },
): Promise<string> {
  try {
    const file = await stat(path);
    const actual = await fileDigest(path);
    return (
      `expected ${expected.bytes} bytes sha256:${expected.sha256.slice(0, 12)}…, ` +
      `received ${file.size} bytes sha256:${actual.slice(0, 12)}…`
    );
  } catch {
    return "the download produced no readable file";
  }
}

function normalizedContainerMember(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").some((part) => part === "" || part === "..")
  )
    throw new Error(`Invalid source-container member path ${path}.`);
  return normalized;
}

async function extract7zMember(
  containerPath: string,
  memberPath: string,
  targetPath: string,
): Promise<void> {
  if (process.platform !== "win32") await chmod(path7za, 0o755);
  const child = spawn(path7za, ["x", "-so", containerPath, memberPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errorText = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    errorText += chunk;
  });
  const completed = new Promise<void>((resolveExtraction, rejectExtraction) => {
    child.once("error", rejectExtraction);
    child.once("close", (code) => {
      if (code === 0) resolveExtraction();
      else
        rejectExtraction(
          new Error(
            `Source-container extraction failed with code ${code}: ${errorText.trim()}`,
          ),
        );
    });
  });
  await Promise.all([
    pipeline(child.stdout, createWriteStream(targetPath, { flags: "wx" })),
    completed,
  ]);
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error("Acquisition concurrency must be a positive integer.");
  }

  async use<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit)
      await new Promise<void>((resolveWaiter) =>
        this.waiters.push(resolveWaiter),
      );
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

export class FileContentAddressedStore {
  private readonly root: string;
  private readonly origins: Set<string>;
  private readonly maxAssetBytes: number;
  private readonly extractContainer: NonNullable<
    ContentAddressedStoreOptions["extractContainer"]
  >;
  private readonly pending = new Map<string, Promise<AcquiredAsset>>();
  private readonly pendingContainers = new Map<string, Promise<string>>();

  constructor(options: ContentAddressedStoreOptions) {
    this.root = resolve(options.root);
    this.origins = new Set(options.allowedOrigins);
    this.maxAssetBytes = options.maxAssetBytes;
    this.extractContainer = options.extractContainer ?? extract7zMember;
    if (!Number.isInteger(this.maxAssetBytes) || this.maxAssetBytes < 1)
      throw new Error("maxAssetBytes must be a positive integer.");
  }

  contentPath(sha256: string): string {
    if (!SHA256.test(sha256)) throw new Error("Invalid content SHA-256.");
    return resolve(this.root, "sha256", sha256.slice(0, 2), sha256);
  }

  async ensure(
    asset: SoundAssetDefinition,
    signal?: AbortSignal,
  ): Promise<AcquiredAsset> {
    const active = this.pending.get(asset.sha256);
    if (active) return active;
    const operation = this.ensureOne(asset, signal);
    this.pending.set(asset.sha256, operation);
    try {
      return await operation;
    } finally {
      if (this.pending.get(asset.sha256) === operation)
        this.pending.delete(asset.sha256);
    }
  }

  async adopt(
    asset: SoundAssetDefinition,
    sourcePath: string,
  ): Promise<AcquiredAsset | undefined> {
    const source = resolve(sourcePath);
    if (!(await matches(source, asset))) return undefined;
    const target = this.contentPath(asset.sha256);
    if (!(await matches(target, asset))) {
      await mkdir(dirname(target), { recursive: true });
      const partial = `${target}.partial-${process.pid}-${randomUUID()}`;
      try {
        await copyFile(source, partial);
        if (!(await matches(partial, asset)))
          throw new Error(
            `Adopted content ${asset.sha256} failed verification.`,
          );
        await rename(partial, target);
      } catch (cause) {
        await rm(partial, { force: true });
        throw cause;
      }
    }
    return {
      assetId: asset.id,
      sha256: asset.sha256,
      bytes: asset.bytes,
      cache: "warm",
      contentPath: target,
    };
  }

  private async ensureOne(
    asset: SoundAssetDefinition,
    signal?: AbortSignal,
  ): Promise<AcquiredAsset> {
    if (asset.bytes > this.maxAssetBytes)
      throw new Error(
        `Asset ${asset.id} exceeds the ${this.maxAssetBytes}-byte acquisition limit.`,
      );
    const source = new URL(asset.source.url);
    if (source.protocol !== "https:" || !this.origins.has(source.origin))
      throw new Error(
        `Asset ${asset.id} uses disallowed origin ${source.origin}.`,
      );
    const target = this.contentPath(asset.sha256);
    if (await matches(target, asset))
      return {
        assetId: asset.id,
        sha256: asset.sha256,
        bytes: asset.bytes,
        cache: "warm",
        contentPath: target,
      };

    await mkdir(dirname(target), { recursive: true });
    const partial = `${target}.partial-${process.pid}-${randomUUID()}`;
    try {
      if (asset.source.container) {
        const containerPath = await this.ensureContainer(asset, signal);
        const memberPath = normalizedContainerMember(
          asset.source.container.memberPath,
        );
        await this.extractContainer(containerPath, memberPath, partial);
        if (!(await matches(partial, asset)))
          throw new Error(
            `Asset ${asset.id} extracted from its source container did not match its pinned bytes/SHA-256 (${await describeMismatch(partial, asset)}).`,
          );
        await this.publishPartial(partial, target);
        return {
          assetId: asset.id,
          sha256: asset.sha256,
          bytes: asset.bytes,
          cache: "cold",
          contentPath: target,
        };
      }
      const response = await fetch(source, { redirect: "follow", signal });
      if (!response.ok || !response.body)
        throw new Error(
          `Asset ${asset.id} download failed: HTTP ${response.status}.`,
        );
      await pipeline(
        Readable.fromWeb(
          response.body as unknown as import("node:stream/web").ReadableStream,
        ),
        createWriteStream(partial, { flags: "wx" }),
        ...(signal ? [{ signal }] : []),
      );
      if (!(await matches(partial, asset)))
        throw new Error(
          `Asset ${asset.id} did not match its pinned bytes/SHA-256 (${await describeMismatch(partial, asset)}, from ${source.origin}). A proxy or mirror may have altered the download; retry on a direct connection.`,
        );
      await this.publishPartial(partial, target);
      return {
        assetId: asset.id,
        sha256: asset.sha256,
        bytes: asset.bytes,
        cache: "cold",
        contentPath: target,
      };
    } catch (cause) {
      await rm(partial, { force: true });
      throw cause;
    }
  }

  private async publishPartial(partial: string, target: string): Promise<void> {
    const handle = await open(partial, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(partial, target);
  }

  private async ensureContainer(
    asset: SoundAssetDefinition,
    signal?: AbortSignal,
  ): Promise<string> {
    const container = asset.source.container!;
    if (container.format !== "7z")
      throw new Error(
        `Unsupported source-container format ${container.format}.`,
      );
    if (container.bytes > this.maxAssetBytes)
      throw new Error(
        `Source container ${container.sha256} exceeds the ${this.maxAssetBytes}-byte acquisition limit.`,
      );
    const existing = this.pendingContainers.get(container.sha256);
    if (existing) return existing;
    const operation = this.ensureContainerOne(asset, signal);
    this.pendingContainers.set(container.sha256, operation);
    try {
      return await operation;
    } finally {
      if (this.pendingContainers.get(container.sha256) === operation)
        this.pendingContainers.delete(container.sha256);
    }
  }

  private async ensureContainerOne(
    asset: SoundAssetDefinition,
    signal?: AbortSignal,
  ): Promise<string> {
    const container = asset.source.container!;
    const target = resolve(
      this.root,
      "source-containers",
      "sha256",
      container.sha256.slice(0, 2),
      `${container.sha256}.7z`,
    );
    if (await matches(target, container)) return target;
    await mkdir(dirname(target), { recursive: true });
    const partial = `${target}.partial-${process.pid}-${randomUUID()}`;
    try {
      const response = await fetch(new URL(asset.source.url), {
        redirect: "follow",
        signal,
      });
      if (!response.ok || !response.body)
        throw new Error(
          `Source container ${container.sha256} download failed: HTTP ${response.status}.`,
        );
      await pipeline(
        Readable.fromWeb(
          response.body as unknown as import("node:stream/web").ReadableStream,
        ),
        createWriteStream(partial, { flags: "wx" }),
        ...(signal ? [{ signal }] : []),
      );
      if (!(await matches(partial, container)))
        throw new Error(
          `Source container ${container.sha256} did not match its pinned bytes/SHA-256.`,
        );
      await this.publishPartial(partial, target);
      return target;
    } catch (cause) {
      await rm(partial, { force: true });
      throw cause;
    }
  }

  async project(acquired: AcquiredAsset, targetPath: string): Promise<void> {
    const target = resolve(targetPath);
    if (
      await matches(target, {
        bytes: acquired.bytes,
        sha256: acquired.sha256,
      })
    )
      return;
    await mkdir(dirname(target), { recursive: true });
    const partial = `${target}.partial-${process.pid}-${randomUUID()}`;
    try {
      await copyFile(acquired.contentPath, partial);
      if (
        !(await matches(partial, {
          bytes: acquired.bytes,
          sha256: acquired.sha256,
        }))
      )
        throw new Error(
          `Projected content ${acquired.sha256} failed verification.`,
        );
      await rename(partial, target);
    } catch (cause) {
      await rm(partial, { force: true });
      throw cause;
    }
  }
}

export async function ensureAssetClosure(
  assets: readonly SoundAssetDefinition[],
  store: FileContentAddressedStore,
  limits: AssetAcquisitionLimits,
  signal?: AbortSignal,
): Promise<AcquiredAsset[]> {
  if (!Number.isInteger(limits.maxAssets) || assets.length > limits.maxAssets)
    throw new Error(
      `Asset closure contains ${assets.length} items; limit is ${limits.maxAssets}.`,
    );
  const bytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  if (!Number.isInteger(limits.maxBytes) || bytes > limits.maxBytes)
    throw new Error(
      `Asset closure contains ${bytes} bytes; limit is ${limits.maxBytes}.`,
    );
  const semaphore = new Semaphore(limits.maxConcurrentFetches);
  let completedAssets = 0;
  let completedBytes = 0;
  return Promise.all(
    assets.map((asset) =>
      semaphore.use(async () => {
        const acquired = await store.ensure(asset, signal);
        completedAssets += 1;
        completedBytes += acquired.bytes;
        limits.onProgress?.({
          acquired,
          completedAssets,
          completedBytes,
          totalAssets: assets.length,
          totalBytes: bytes,
        });
        return acquired;
      }),
    ),
  );
}
