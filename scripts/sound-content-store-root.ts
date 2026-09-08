import { homedir, platform } from "node:os";
import { resolve } from "node:path";

interface SoundContentStoreEnvironment {
  REFRAIN_SOUND_CONTENT_STORE_ROOT?: string;
  XDG_CACHE_HOME?: string;
  LOCALAPPDATA?: string;
}

interface SoundContentStoreRootOptions {
  environment?: SoundContentStoreEnvironment;
  homeDirectory?: string;
  platformName?: NodeJS.Platform;
}

function configuredPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? resolve(trimmed) : undefined;
}

export function resolveSoundContentStoreRoot(
  options: SoundContentStoreRootOptions = {},
): string {
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const platformName = options.platformName ?? platform();
  const explicit = configuredPath(environment.REFRAIN_SOUND_CONTENT_STORE_ROOT);
  if (explicit) return explicit;

  const xdgCache = configuredPath(environment.XDG_CACHE_HOME);
  if (xdgCache) return resolve(xdgCache, "refrain/sound-content-store");

  if (platformName === "darwin")
    return resolve(homeDirectory, "Library/Caches/Refrain/sound-content-store");
  if (platformName === "win32")
    return resolve(
      configuredPath(environment.LOCALAPPDATA) ??
        resolve(homeDirectory, "AppData/Local"),
      "Refrain/sound-content-store",
    );
  return resolve(homeDirectory, ".cache/refrain/sound-content-store");
}
