import {
  normalizePortableAppearance,
  SELEN_V21_APPEARANCE_DEFAULTS,
  type PortableShareAppearance,
  type RefrainArtifact,
  type SelenV21ThemeId,
} from "@refrain/renderer";
import { presentPortableArtifact } from "@refrain/renderer/artifact-document";
import { BUILT_IN_PERFORMANCE_BINDINGS, sha256Hex } from "@refrain/soundpack";

/**
 * Portable saved-queue contract for the canonical Player. This module is
 * browser-safe: it owns shape validation and artifact verification only, never
 * musical defaults, asset resolution, or delivery.
 */
export const PLAYER_PLAYLIST_FORMAT =
  "refrain-playlist@0-experimental" as const;
export const PLAYER_PLAYLIST_MEDIA_TYPE =
  "application/vnd.refrain-playlist+json" as const;
export const MAX_PLAYER_PLAYLIST_ENTRIES = 256;

const MAX_TITLE_LENGTH = 256;
const MAX_ENTRY_ID_LENGTH = 1_024;
const MAX_BINDING_ID_LENGTH = 1_024;
const APPEARANCE_KEYS = new Set<keyof PortableShareAppearance>([
  "symbolColor",
  "textColor",
  "backgroundOpacity",
  "backgroundBlurPx",
]);

/** The four existing Selen v21 theme IDs, taken from the canonical defaults. */
export const PLAYER_PLAYLIST_THEME_IDS = Object.keys(
  SELEN_V21_APPEARANCE_DEFAULTS,
) as readonly SelenV21ThemeId[];

export function isPlayerPlaylistTheme(
  value: unknown,
): value is SelenV21ThemeId {
  return PLAYER_PLAYLIST_THEME_IDS.includes(value as SelenV21ThemeId);
}

export interface PlayerPlaylistPresentation {
  theme: SelenV21ThemeId;
  appearance?: PortableShareAppearance;
}

export interface PlayerPlaylistEntry {
  id: string;
  /** The complete imported artifact graph, never a playback projection. */
  artifact: RefrainArtifact;
  bindingId?: string;
  presentation?: PlayerPlaylistPresentation;
}

export interface PlayerPlaylist {
  format: typeof PLAYER_PLAYLIST_FORMAT;
  title: string;
  entries: PlayerPlaylistEntry[];
  currentEntryId?: string;
}

export type PlayerPlaylistParseResult =
  { ok: true; playlist: PlayerPlaylist } | { ok: false; message: string };

/** One exact closure entry; the CLI supplies canonical resolved values. */
export interface PlayerPlaylistAsset {
  assetId: string;
  bytes: number;
  sha256: string;
  localPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function usesExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  return JSON.stringify(keys) === JSON.stringify([...expected].sort());
}

function parseAppearance(value: unknown): PortableShareAppearance | "invalid" {
  if (!isRecord(value)) return "invalid";
  const keys = Object.keys(value);
  if (keys.length === 0) return "invalid";
  if (keys.some((key) => !APPEARANCE_KEYS.has(key as never))) return "invalid";
  const normalized = normalizePortableAppearance(value);
  if (!normalized || Object.keys(normalized).length !== keys.length)
    return "invalid";
  return normalized;
}

function parsePresentation(
  value: unknown,
): PlayerPlaylistPresentation | "invalid" {
  if (!isRecord(value)) return "invalid";
  if (
    !usesExactKeys(value, [
      "theme",
      ...(value.appearance === undefined ? [] : ["appearance"]),
    ])
  )
    return "invalid";
  if (!isPlayerPlaylistTheme(value.theme)) return "invalid";
  if (value.appearance === undefined) return { theme: value.theme };
  const appearance = parseAppearance(value.appearance);
  if (appearance === "invalid") return "invalid";
  return { theme: value.theme, appearance };
}

function invalid(message: string): PlayerPlaylistParseResult {
  return { ok: false, message };
}

/** True for any object claiming a playlist format; it must never be read as AIR. */
export function looksLikePlayerPlaylist(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.format === "string" &&
    value.format.startsWith("refrain-playlist@")
  );
}

export function parsePlayerPlaylist(value: unknown): PlayerPlaylistParseResult {
  if (!isRecord(value))
    return invalid("A Refrain playlist must be a JSON object.");
  if (value.format !== PLAYER_PLAYLIST_FORMAT)
    return invalid(
      `Unsupported Refrain playlist format ${String(value.format)}; expected ${PLAYER_PLAYLIST_FORMAT}.`,
    );
  if (
    !usesExactKeys(value, [
      "format",
      "title",
      "entries",
      ...(value.currentEntryId === undefined ? [] : ["currentEntryId"]),
    ])
  )
    return invalid("The Refrain playlist has unexpected fields.");
  if (typeof value.title !== "string" || value.title.length > MAX_TITLE_LENGTH)
    return invalid("The Refrain playlist title is invalid.");
  if (!Array.isArray(value.entries))
    return invalid("The Refrain playlist needs an entries array.");
  if (value.entries.length > MAX_PLAYER_PLAYLIST_ENTRIES)
    return invalid(
      `A Refrain playlist carries at most ${MAX_PLAYER_PLAYLIST_ENTRIES} entries.`,
    );

  const entries: PlayerPlaylistEntry[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of value.entries.entries()) {
    const label = `Playlist entry ${index + 1}`;
    if (!isRecord(candidate)) return invalid(`${label} must be an object.`);
    if (
      !usesExactKeys(candidate, [
        "id",
        "artifact",
        ...(candidate.bindingId === undefined ? [] : ["bindingId"]),
        ...(candidate.presentation === undefined ? [] : ["presentation"]),
      ])
    )
      return invalid(`${label} has unexpected fields.`);
    if (
      typeof candidate.id !== "string" ||
      candidate.id.length === 0 ||
      candidate.id.length > MAX_ENTRY_ID_LENGTH
    )
      return invalid(`${label} has no usable entry ID.`);
    if (ids.has(candidate.id))
      return invalid(
        `The Refrain playlist repeats the entry ID ${candidate.id}.`,
      );
    ids.add(candidate.id);
    if (
      candidate.bindingId !== undefined &&
      (typeof candidate.bindingId !== "string" ||
        candidate.bindingId.length === 0 ||
        candidate.bindingId.length > MAX_BINDING_ID_LENGTH)
    )
      return invalid(`${label} names an invalid PerformanceBinding.`);
    const presentation =
      candidate.presentation === undefined
        ? undefined
        : parsePresentation(candidate.presentation);
    if (presentation === "invalid")
      return invalid(
        `${label} carries an unsupported theme or portable appearance.`,
      );
    // Canonical presentation verification keeps the entire imported graph; the
    // named binding must be carried by the artifact or be one exact built-in.
    const presented = presentPortableArtifact(
      candidate.artifact,
      candidate.bindingId,
      BUILT_IN_PERFORMANCE_BINDINGS,
    );
    if (!presented.ok)
      return invalid(
        `${label} is not an exact presentable artifact: ${presented.message}`,
      );
    entries.push({
      id: candidate.id,
      artifact: presented.artifact.portableArtifact!,
      ...(candidate.bindingId === undefined
        ? {}
        : { bindingId: candidate.bindingId }),
      ...(presentation === undefined ? {} : { presentation }),
    });
  }

  if (
    value.currentEntryId !== undefined &&
    (typeof value.currentEntryId !== "string" || !ids.has(value.currentEntryId))
  )
    return invalid(
      "The current playlist entry is not one of the playlist entries.",
    );

  return {
    ok: true,
    playlist: {
      format: PLAYER_PLAYLIST_FORMAT,
      title: value.title,
      entries,
      ...(value.currentEntryId === undefined
        ? {}
        : { currentEntryId: value.currentEntryId }),
    },
  };
}

/** Exact playlist JSON; artifact objects are preserved, never flattened. */
export function stringifyPlayerPlaylist(playlist: PlayerPlaylist): string {
  return `${JSON.stringify(playlist, null, 2)}\n`;
}

export function playerPlaylistBytesFromText(text: string): {
  bytes: Uint8Array;
  sha256: string;
} {
  return {
    bytes: new TextEncoder().encode(text),
    sha256: `sha256:${sha256Hex(text)}`,
  };
}

export function playerPlaylistBytesOf(playlist: PlayerPlaylist): {
  bytes: Uint8Array;
  sha256: string;
} {
  return playerPlaylistBytesFromText(stringifyPlayerPlaylist(playlist));
}

export function parsePlayerPlaylistBytes(
  bytes: Uint8Array,
  expectedSha256: string,
): PlayerPlaylistParseResult {
  const text = new TextDecoder().decode(bytes);
  if (`sha256:${sha256Hex(text)}` !== expectedSha256)
    return invalid(
      "The delivered playlist bytes do not match their expected identity.",
    );
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return invalid("The delivered playlist is not JSON.");
  }
  return parsePlayerPlaylist(value);
}

/**
 * Union of exact already-resolved closures. Two works may share one identical
 * asset, but the same asset ID may never name different content.
 */
export function mergePlayerPlaylistAssets(
  works: readonly {
    label: string;
    assets: readonly PlayerPlaylistAsset[];
  }[],
): PlayerPlaylistAsset[] {
  const union = new Map<string, PlayerPlaylistAsset>();
  const owner = new Map<string, string>();
  for (const work of works)
    for (const asset of work.assets) {
      const present = union.get(asset.assetId);
      if (!present) {
        union.set(asset.assetId, asset);
        owner.set(asset.assetId, work.label);
        continue;
      }
      if (
        present.bytes !== asset.bytes ||
        present.sha256 !== asset.sha256 ||
        present.localPath !== asset.localPath
      )
        throw new Error(
          `Works ${owner.get(asset.assetId)} and ${work.label} select conflicting content for asset ${asset.assetId}; refusing to prepare a conflicting union.`,
        );
    }
  return [...union.values()];
}
