import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

export interface LocalProjectionAsset {
  assetId: string;
  bytes: number;
  sha256: string;
  localPath: string;
}

export interface PrepareLocalAssetProjectionOptions {
  assets: readonly LocalProjectionAsset[];
  sourceRoot: string;
  targetRoot: string;
  missingAssetHint: string;
}

async function digest(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function verifySource(
  asset: LocalProjectionAsset,
  sourceRoot: string,
  missingAssetHint: string,
): Promise<string> {
  const source = resolve(sourceRoot, asset.localPath);
  const sourceStat = await stat(source).catch(() => undefined);
  if (
    !sourceStat ||
    sourceStat.size !== asset.bytes ||
    (await digest(source)) !== asset.sha256
  )
    throw new Error(
      `Asset ${asset.assetId} is missing or corrupt. ${missingAssetHint}`,
    );
  return source;
}

function soundpackRelativePath(localPath: string): string {
  const relativePath = relative("soundpacks", localPath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    resolve("soundpacks", relativePath) !== resolve(localPath)
  )
    throw new Error(
      `Renderer asset ${localPath} is outside the canonical soundpacks projection.`,
    );
  return relativePath;
}

export async function prepareLocalAssetProjection({
  assets,
  sourceRoot,
  targetRoot,
  missingAssetHint,
}: PrepareLocalAssetProjectionOptions): Promise<void> {
  if (resolve(sourceRoot) === resolve(targetRoot)) {
    for (const asset of assets)
      await verifySource(asset, sourceRoot, missingAssetHint);
    return;
  }

  const soundpacksRoot = resolve(targetRoot, "soundpacks");
  const stagingRoot = `${soundpacksRoot}.partial-${process.pid}-${randomUUID()}`;
  const previousRoot = `${soundpacksRoot}.previous-${process.pid}-${randomUUID()}`;
  await mkdir(stagingRoot, { recursive: true });
  try {
    for (const asset of assets) {
      const source = await verifySource(asset, sourceRoot, missingAssetHint);
      const target = resolve(
        stagingRoot,
        soundpackRelativePath(asset.localPath),
      );
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
    }

    const hasPrevious = await stat(soundpacksRoot)
      .then(() => true)
      .catch(() => false);
    if (hasPrevious) await rename(soundpacksRoot, previousRoot);
    try {
      await rename(stagingRoot, soundpacksRoot);
    } catch (cause) {
      if (hasPrevious) await rename(previousRoot, soundpacksRoot);
      throw cause;
    }
    if (hasPrevious) await rm(previousRoot, { recursive: true, force: true });
  } catch (cause) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw cause;
  }
}

export async function prepareSpessaSynthWorklet(
  repoRoot: string,
  targetRoot: string,
): Promise<void> {
  const source = resolve(
    repoRoot,
    "node_modules/spessasynth_lib/dist/spessasynth_processor.min.js",
  );
  await mkdir(targetRoot, { recursive: true });
  await copyFile(source, resolve(targetRoot, "spessasynth_processor.min.js"));
}
