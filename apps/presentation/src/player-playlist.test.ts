import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createRefrainArtifactV3,
  parseRefrainArtifact,
  type RefrainArtifact,
} from "@refrain/renderer";
import { createRootReceiptV1 } from "@refrain/renderer/v1";
import { F_SYNTHETIC_BEAT_PERFORMANCE_BINDING } from "@refrain/soundpack";
import {
  looksLikePlayerPlaylist,
  mergePlayerPlaylistAssets,
  parsePlayerPlaylist,
  parsePlayerPlaylistBytes,
  PLAYER_PLAYLIST_FORMAT,
  PLAYER_PLAYLIST_MEDIA_TYPE,
  PLAYER_PLAYLIST_THEME_IDS,
  playerPlaylistBytesOf,
  stringifyPlayerPlaylist,
  type PlayerPlaylist,
} from "./player-playlist.js";

const demoDocument = JSON.parse(
  readFileSync("examples/demo/velvet-mischief.refrain.json", "utf8"),
) as RefrainArtifact;

function syntheticDocument(): RefrainArtifact {
  const source = JSON.parse(
    readFileSync("fixtures/air-v1/synthetic-counterpulse.air.json", "utf8"),
  );
  return createRefrainArtifactV3({
    source,
    receipt: createRootReceiptV1(source),
    performanceBinding: F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
    caption: "Synthetic playlist proof",
  });
}

function playlistValue(overrides: Record<string, unknown> = {}) {
  return {
    format: PLAYER_PLAYLIST_FORMAT,
    title: "Saved local queue",
    entries: [{ id: "first", artifact: demoDocument }],
    ...overrides,
  };
}

function failure(value: unknown): string {
  const parsed = parsePlayerPlaylist(value);
  if (parsed.ok) throw new Error("Expected the playlist to be rejected.");
  return parsed.message;
}

describe("portable saved playlists", () => {
  it("keeps the whole imported artifact graph through parse and re-serialize", () => {
    const value = {
      format: PLAYER_PLAYLIST_FORMAT,
      title: "Saved local queue",
      entries: [
        {
          id: "first",
          artifact: demoDocument,
          bindingId: "velvet-mischief-native@0",
          presentation: {
            theme: "nocturne-ink",
            appearance: { symbolColor: "#A1B2C3", backgroundOpacity: 0.4 },
          },
        },
        { id: "second", artifact: syntheticDocument() },
      ],
      currentEntryId: "second",
    };
    const parsed = parsePlayerPlaylist(value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // The imported document object is retained, not rebuilt from a projection.
    expect(parsed.playlist.entries[0]!.artifact).toBe(demoDocument);
    expect(parsed.playlist.entries[0]!.bindingId).toBe(
      "velvet-mischief-native@0",
    );
    expect(parsed.playlist.entries[0]!.presentation).toEqual({
      theme: "nocturne-ink",
      appearance: { symbolColor: "#a1b2c3", backgroundOpacity: 0.4 },
    });
    expect(parsed.playlist.currentEntryId).toBe("second");

    const text = stringifyPlayerPlaylist(parsed.playlist);
    expect(text.endsWith("\n")).toBe(true);
    const restored = JSON.parse(text) as PlayerPlaylist;
    const restoredArtifact = restored.entries[0]!.artifact;
    expect(restoredArtifact).toEqual(demoDocument);
    // A playback projection would have added these; the portable graph must not.
    expect("compiled" in restoredArtifact).toBe(false);
    expect("diagnostics" in restoredArtifact).toBe(false);
    expect("portableArtifact" in restoredArtifact).toBe(false);
    expect("renderReceipts" in restoredArtifact).toBe(true);
    expect(parseRefrainArtifact(restored.entries[0]!.artifact).ok).toBe(true);
    expect(restored).toEqual(parsed.playlist);
    expect(parsePlayerPlaylist(restored)).toEqual(parsed);
  });

  it("accepts an empty saved queue and bounds the list", () => {
    expect(parsePlayerPlaylist({ ...playlistValue(), entries: [] })).toEqual({
      ok: true,
      playlist: {
        format: PLAYER_PLAYLIST_FORMAT,
        title: "Saved local queue",
        entries: [],
      },
    });
    const overflow = playlistValue({
      entries: Array.from({ length: 257 }, (_unused, index) => ({
        id: `entry-${index}`,
        artifact: demoDocument,
      })),
    });
    expect(failure(overflow)).toContain("at most 256 entries");
  });

  it("never accepts a playlist through the AIR reader or the reverse", () => {
    expect(looksLikePlayerPlaylist(playlistValue())).toBe(true);
    expect(looksLikePlayerPlaylist(demoDocument)).toBe(false);
    expect(parseRefrainArtifact(playlistValue()).ok).toBe(false);
    expect(failure(demoDocument)).toContain(
      "Unsupported Refrain playlist format",
    );
  });

  it("rejects malformed playlist structure", () => {
    expect(failure(null)).toContain("must be a JSON object");
    expect(failure(playlistValue({ title: undefined }))).toContain(
      "title is invalid",
    );
    expect(failure(playlistValue({ entries: undefined }))).toContain(
      "entries array",
    );
    expect(failure(playlistValue({ title: 7 }))).toContain("title is invalid");
    expect(failure(playlistValue({ entries: {} }))).toContain("entries array");
    expect(failure(playlistValue({ extra: true }))).toContain(
      "unexpected fields",
    );
    expect(failure(playlistValue({ entries: [7] }))).toContain(
      "must be an object",
    );
    expect(
      failure(playlistValue({ entries: [{ id: "", artifact: demoDocument }] })),
    ).toContain("no usable entry ID");
    expect(
      failure(
        playlistValue({
          entries: [
            { id: "same", artifact: demoDocument },
            { id: "same", artifact: demoDocument },
          ],
        }),
      ),
    ).toContain("repeats the entry ID");
    expect(
      failure(
        playlistValue({
          entries: [{ id: "a", artifact: demoDocument, surprise: 1 }],
        }),
      ),
    ).toContain("unexpected fields");
    expect(
      failure(
        playlistValue({
          entries: [{ id: "a", artifact: {} }],
        }),
      ),
    ).toContain("not an exact presentable artifact");
    expect(failure(playlistValue({ currentEntryId: "absent" }))).toContain(
      "current playlist entry",
    );
  });

  it("resolves the exact saved binding and rejects unavailable ones", () => {
    const carried = parsePlayerPlaylist(
      playlistValue({
        entries: [
          {
            id: "carried",
            artifact: demoDocument,
            bindingId: "velvet-mischief-native@0",
          },
          {
            id: "built-in",
            artifact: demoDocument,
            bindingId: "f-synthetic-beat@0",
          },
          { id: "implicit", artifact: demoDocument },
        ],
      }),
    );
    expect(carried.ok).toBe(true);
    expect(
      failure(
        playlistValue({
          entries: [
            { id: "a", artifact: demoDocument, bindingId: "missing@0" },
          ],
        }),
      ),
    ).toContain("not an exact presentable artifact");
    expect(
      failure(
        playlistValue({
          entries: [{ id: "a", artifact: demoDocument, bindingId: 7 }],
        }),
      ),
    ).toContain("invalid PerformanceBinding");
  });

  it("closes the portable theme and scalar appearance", () => {
    expect(PLAYER_PLAYLIST_THEME_IDS).toEqual([
      "paper-sonata",
      "prism",
      "nocturne-ink",
      "herbarium",
    ]);
    const entry = (presentation: unknown) =>
      playlistValue({
        entries: [{ id: "a", artifact: demoDocument, presentation }],
      });
    for (const theme of PLAYER_PLAYLIST_THEME_IDS)
      expect(parsePlayerPlaylist(entry({ theme })).ok).toBe(true);
    expect(
      parsePlayerPlaylist(
        entry({ theme: "prism", appearance: { textColor: "#123456" } }),
      ).ok,
    ).toBe(true);

    for (const presentation of [
      { theme: "sunrise" },
      { theme: "prism", extra: 1 },
      { theme: "prism", appearance: {} },
      { theme: "prism", appearance: { symbolColor: "#xyz" } },
      { theme: "prism", appearance: { backgroundOpacity: 0.9 } },
      { theme: "prism", appearance: { backgroundBlurPx: -1 } },
      { theme: "prism", appearance: { backgroundImageUrl: "blob:x" } },
      { theme: "prism", appearance: { backgroundImage: { name: "x" } } },
      { theme: "prism", appearance: null },
      null,
    ])
      expect(failure(entry(presentation))).toContain(
        "unsupported theme or portable appearance",
      );
  });

  it("verifies delivered playlist bytes by exact identity", () => {
    const playlist = parsePlayerPlaylist(playlistValue());
    if (!playlist.ok) throw new Error(playlist.message);
    const { bytes, sha256 } = playerPlaylistBytesOf(playlist.playlist);
    expect(parsePlayerPlaylistBytes(bytes, sha256)).toEqual(playlist);
    const wrong = `sha256:${"0".repeat(64)}`;
    const mismatch = parsePlayerPlaylistBytes(bytes, wrong);
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) return;
    expect(mismatch.message).toContain("do not match their expected identity");
    const truncated = parsePlayerPlaylistBytes(
      bytes.slice(0, Math.floor(bytes.length / 2)),
      sha256,
    );
    expect(truncated.ok).toBe(false);
    const notJson = parsePlayerPlaylistBytes(
      new TextEncoder().encode("not json"),
      `sha256:${"1".repeat(64)}`,
    );
    expect(notJson.ok).toBe(false);
    expect(PLAYER_PLAYLIST_MEDIA_TYPE).toContain("+json");
  });

  it("merges exact selected closures and refuses conflicting content", () => {
    const shared = {
      assetId: "wav:shared",
      bytes: 10,
      sha256: `sha256:${"a".repeat(64)}`,
      localPath: "soundpacks/shared.wav",
    } as const;
    const extra = {
      assetId: "wav:extra",
      bytes: 20,
      sha256: `sha256:${"b".repeat(64)}`,
      localPath: "soundpacks/extra.wav",
    } as const;
    expect(
      mergePlayerPlaylistAssets([
        { label: "one", assets: [shared] },
        { label: "two", assets: [{ ...shared }, extra] },
      ]),
    ).toEqual([shared, extra]);
    expect(
      mergePlayerPlaylistAssets([
        { label: "one", assets: [shared] },
        { label: "two", assets: [] },
      ]),
    ).toEqual([shared]);
    expect(() =>
      mergePlayerPlaylistAssets([
        { label: "one", assets: [shared] },
        {
          label: "two",
          assets: [
            {
              ...shared,
              sha256: `sha256:${"c".repeat(64)}`,
              localPath: "soundpacks/other.wav",
            },
          ],
        },
      ]),
    ).toThrow(/conflicting content for asset wav:shared/);
  });
});
