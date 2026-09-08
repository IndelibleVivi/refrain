import { describe, expect, it } from "vitest";
import { resolveSoundContentStoreRoot } from "./sound-content-store-root.js";

describe("sound content store root", () => {
  it("uses one explicit operator override", () => {
    expect(
      resolveSoundContentStoreRoot({
        environment: {
          REFRAIN_SOUND_CONTENT_STORE_ROOT: "/var/cache/refrain-content",
          XDG_CACHE_HOME: "/ignored",
        },
        homeDirectory: "/home/operator",
        platformName: "linux",
      }),
    ).toBe("/var/cache/refrain-content");
  });

  it("uses the platform cache outside any repository checkout", () => {
    expect(
      resolveSoundContentStoreRoot({
        environment: {},
        homeDirectory: "/Users/operator",
        platformName: "darwin",
      }),
    ).toBe("/Users/operator/Library/Caches/Refrain/sound-content-store");
    expect(
      resolveSoundContentStoreRoot({
        environment: { XDG_CACHE_HOME: "/cache" },
        homeDirectory: "/home/operator",
        platformName: "linux",
      }),
    ).toBe("/cache/refrain/sound-content-store");
    expect(
      resolveSoundContentStoreRoot({
        environment: { LOCALAPPDATA: "C:/Users/operator/AppData/Local" },
        homeDirectory: "C:/Users/operator",
        platformName: "win32",
      }).replaceAll("\\", "/"),
    ).toMatch(/Users\/operator\/AppData\/Local\/Refrain\/sound-content-store$/);
  });
});
