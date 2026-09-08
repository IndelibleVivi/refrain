import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { validateAnyExtensionPack, type AnyExtensionPack } from "./vnext.js";

export const LOCAL_PACK_STATE_FORMAT =
  "refrain-local-pack-state@0-experimental" as const;

export interface InstalledPackState {
  id: string;
  version: string;
  label: string;
  contentSha256: string;
  sourceRoot: string;
  modules: AnyExtensionPack["modules"];
  assets: AnyExtensionPack["assets"];
}

export interface HydratedPackAsset {
  assetId: string;
  sha256: string;
  bytes: number;
  path: string;
  owners: string[];
}

export interface ArchivePackReference {
  packId: string;
  version: string;
  packSha256: string;
}

export interface LocalPackState {
  format: typeof LOCAL_PACK_STATE_FORMAT;
  installed: InstalledPackState[];
  shelf: Array<{ packId: string; version: string }>;
  hydrated: HydratedPackAsset[];
  archivePins: Array<{
    archiveId: string;
    packs: ArchivePackReference[];
  }>;
}

const EMPTY_STATE: LocalPackState = {
  format: LOCAL_PACK_STATE_FORMAT,
  installed: [],
  shelf: [],
  hydrated: [],
  archivePins: [],
};

function packKey(packId: string, version: string): string {
  return `${packId}@${version}`;
}

function isMissingFile(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    "code" in cause &&
    (cause as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function validateState(value: unknown): asserts value is LocalPackState {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { format?: unknown }).format !== LOCAL_PACK_STATE_FORMAT ||
    !Array.isArray((value as { installed?: unknown }).installed) ||
    !Array.isArray((value as { shelf?: unknown }).shelf) ||
    !Array.isArray((value as { hydrated?: unknown }).hydrated) ||
    !Array.isArray((value as { archivePins?: unknown }).archivePins)
  )
    throw new Error("The local Refrain pack state is malformed.");
}

/**
 * Explicit-rooted local pack lifecycle. Metadata install is intentionally
 * separate from byte hydration and from authoring-shelf activation.
 */
export class LocalPackManager {
  readonly root: string;
  readonly statePath: string;
  readonly blobRoot: string;

  constructor(root: string) {
    if (!isAbsolute(root) || root === "/")
      throw new Error("LocalPackManager requires a bounded absolute root.");
    this.root = root;
    this.statePath = join(root, "state.json");
    this.blobRoot = join(root, "blobs");
  }

  private async readState(): Promise<LocalPackState> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(this.statePath, "utf8"),
      );
      validateState(parsed);
      return structuredClone(parsed);
    } catch (cause) {
      if (isMissingFile(cause)) return structuredClone(EMPTY_STATE);
      throw cause;
    }
  }

  private async writeState(state: LocalPackState): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const temporary = join(this.root, `.state-${randomUUID()}.json`);
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.statePath);
  }

  async list(): Promise<LocalPackState> {
    return this.readState();
  }

  async install(sourceRoot: string): Promise<InstalledPackState> {
    if (!isAbsolute(sourceRoot) || sourceRoot === "/")
      throw new Error("Pack side-load source must be a bounded absolute root.");
    const pack: unknown = JSON.parse(
      await readFile(join(sourceRoot, "pack.json"), "utf8"),
    );
    const errors = validateAnyExtensionPack(pack);
    if (errors.length) throw new Error(errors.join("\n"));
    const exactPack = pack as AnyExtensionPack;
    const state = await this.readState();
    const key = packKey(exactPack.id, exactPack.version);
    const present = state.installed.find(
      (item) => packKey(item.id, item.version) === key,
    );
    if (present && present.contentSha256 !== exactPack.contentSha256)
      throw new Error(
        `Installed pack ${key} has a different exact content identity.`,
      );
    const installed: InstalledPackState = {
      id: exactPack.id,
      version: exactPack.version,
      label: exactPack.label,
      contentSha256: exactPack.contentSha256,
      sourceRoot,
      modules: structuredClone(exactPack.modules),
      assets: structuredClone(exactPack.assets),
    };
    if (!present) {
      state.installed.push(installed);
      state.installed.sort((left, right) =>
        packKey(left.id, left.version).localeCompare(
          packKey(right.id, right.version),
        ),
      );
      await this.writeState(state);
    }
    return present ?? installed;
  }

  async setShelf(
    packId: string,
    version: string,
    active: boolean,
  ): Promise<void> {
    const state = await this.readState();
    const installed = state.installed.some(
      (item) => item.id === packId && item.version === version,
    );
    if (!installed)
      throw new Error(`Pack ${packKey(packId, version)} is not installed.`);
    const index = state.shelf.findIndex(
      (item) => item.packId === packId && item.version === version,
    );
    if (active && index < 0) state.shelf.push({ packId, version });
    if (!active && index >= 0) state.shelf.splice(index, 1);
    state.shelf.sort((left, right) =>
      packKey(left.packId, left.version).localeCompare(
        packKey(right.packId, right.version),
      ),
    );
    await this.writeState(state);
  }

  async hydrate(
    packId: string,
    version: string,
    assetIds: readonly string[],
  ): Promise<HydratedPackAsset[]> {
    const state = await this.readState();
    const pack = state.installed.find(
      (item) => item.id === packId && item.version === version,
    );
    if (!pack)
      throw new Error(`Pack ${packKey(packId, version)} is not installed.`);
    const owner = packKey(packId, version);
    await mkdir(this.blobRoot, { recursive: true });
    const hydrated: HydratedPackAsset[] = [];
    for (const assetId of [...new Set(assetIds)].sort()) {
      const asset = pack.assets.find((item) => item.id === assetId);
      if (!asset)
        throw new Error(`Pack ${owner} does not declare asset ${assetId}.`);
      const bytes = await readFile(join(pack.sourceRoot, "assets", asset.id));
      if (bytes.byteLength !== asset.bytes)
        throw new Error(`Pack asset ${asset.id} byte count does not match.`);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== asset.sha256)
        throw new Error(`Pack asset ${asset.id} SHA-256 does not match.`);
      const path = join(this.blobRoot, sha256);
      try {
        await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
      } catch (cause) {
        if (
          !(cause instanceof Error) ||
          !("code" in cause) ||
          (cause as NodeJS.ErrnoException).code !== "EEXIST"
        )
          throw cause;
      }
      const present = state.hydrated.find((item) => item.sha256 === sha256);
      if (present) {
        if (!present.owners.includes(owner)) present.owners.push(owner);
        present.owners.sort();
        hydrated.push(present);
      } else {
        const item: HydratedPackAsset = {
          assetId: asset.id,
          sha256,
          bytes: asset.bytes,
          path,
          owners: [owner],
        };
        state.hydrated.push(item);
        hydrated.push(item);
      }
    }
    state.hydrated.sort((left, right) =>
      left.sha256.localeCompare(right.sha256),
    );
    await this.writeState(state);
    return structuredClone(hydrated);
  }

  async pinArchive(
    archiveId: string,
    packs: readonly ArchivePackReference[],
  ): Promise<void> {
    if (!/^sha256:[0-9a-f]{64}$/.test(archiveId) || packs.length === 0)
      throw new Error(
        "Archive pins need an exact archive ID and pack references.",
      );
    const state = await this.readState();
    for (const reference of packs) {
      const installed = state.installed.find(
        (item) =>
          item.id === reference.packId &&
          item.version === reference.version &&
          item.contentSha256 === reference.packSha256,
      );
      if (!installed)
        throw new Error(
          `Archive pin refers to unavailable pack ${packKey(reference.packId, reference.version)}.`,
        );
    }
    const next = {
      archiveId,
      packs: structuredClone([...packs]).sort((left, right) =>
        packKey(left.packId, left.version).localeCompare(
          packKey(right.packId, right.version),
        ),
      ),
    };
    const index = state.archivePins.findIndex(
      (item) => item.archiveId === archiveId,
    );
    if (index >= 0) state.archivePins[index] = next;
    else state.archivePins.push(next);
    state.archivePins.sort((left, right) =>
      left.archiveId.localeCompare(right.archiveId),
    );
    await this.writeState(state);
  }

  async unpinArchive(archiveId: string): Promise<void> {
    const state = await this.readState();
    state.archivePins = state.archivePins.filter(
      (item) => item.archiveId !== archiveId,
    );
    await this.writeState(state);
  }

  async uninstall(packId: string, version: string): Promise<void> {
    const state = await this.readState();
    const index = state.installed.findIndex(
      (item) => item.id === packId && item.version === version,
    );
    if (index < 0)
      throw new Error(`Pack ${packKey(packId, version)} is not installed.`);
    const pack = state.installed[index]!;
    const blocking = state.archivePins.find((pin) =>
      pin.packs.some(
        (reference) =>
          reference.packId === packId &&
          reference.version === version &&
          reference.packSha256 === pack.contentSha256,
      ),
    );
    if (blocking)
      throw new Error(
        `Pack ${packKey(packId, version)} is pinned by archive ${blocking.archiveId}.`,
      );
    const owner = packKey(packId, version);
    for (const item of state.hydrated) {
      item.owners = item.owners.filter((candidate) => candidate !== owner);
      if (item.owners.length === 0) await rm(item.path, { force: true });
    }
    state.hydrated = state.hydrated.filter((item) => item.owners.length > 0);
    state.shelf = state.shelf.filter(
      (item) => item.packId !== packId || item.version !== version,
    );
    state.installed.splice(index, 1);
    await this.writeState(state);
  }
}
