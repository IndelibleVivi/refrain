import { describe, expect, it } from "vitest";
import {
  APPEARANCE_PREFERENCES_FORMAT,
  appearanceForTheme,
  parseAppearancePreferences,
  parseSharedAppearance,
  normalizePortableAppearance,
} from "./appearance.js";

describe("renderer appearance presentation state", () => {
  it("keeps image composition local and accepts only its closed choices", () => {
    const preferences = parseAppearancePreferences({
      format: APPEARANCE_PREFERENCES_FORMAT,
      themes: {
        prism: {
          backgroundPosition: "top",
          backgroundFit: "contain",
          symbolColor: "#112233",
        },
        herbarium: { backgroundFit: ["cover"], backgroundPosition: "left" },
      },
    });
    expect(preferences.themes.prism).toEqual({
      backgroundPosition: "top",
      backgroundFit: "contain",
      symbolColor: "#112233",
    });
    expect(preferences.themes.herbarium).toEqual({});
    expect(normalizePortableAppearance(preferences.themes.prism)).toEqual({
      symbolColor: "#112233",
    });
  });
  it("parses bounded per-theme preferences without accepting unknown fields", () => {
    const parsed = parseAppearancePreferences({
      format: APPEARANCE_PREFERENCES_FORMAT,
      selectedTheme: "prism",
      themes: {
        prism: {
          symbolColor: "#AABBCC",
          textColor: "#101820",
          backgroundOpacity: 0.42,
          backgroundBlurPx: 12,
          backgroundImage: {
            name: "sky.webp",
            mediaType: "image/webp",
            bytes: 1024,
          },
        },
      },
    });
    expect(parsed).toEqual({
      format: APPEARANCE_PREFERENCES_FORMAT,
      selectedTheme: "prism",
      themes: {
        prism: {
          symbolColor: "#aabbcc",
          textColor: "#101820",
          backgroundOpacity: 0.42,
          backgroundBlurPx: 12,
          backgroundImage: {
            name: "sky.webp",
            mediaType: "image/webp",
            bytes: 1024,
          },
        },
      },
    });
    expect(appearanceForTheme(parsed, "prism").symbolColor).toBe("#aabbcc");
  });

  it("drops malformed stored values instead of widening the renderer input", () => {
    expect(parseAppearancePreferences(null)).toEqual({
      format: APPEARANCE_PREFERENCES_FORMAT,
      themes: {},
    });
    const parsed = parseAppearancePreferences({
      format: APPEARANCE_PREFERENCES_FORMAT,
      selectedTheme: "invented",
      themes: {
        prism: {
          symbolColor: "red",
          textColor: "#ffffff00",
          backgroundOpacity: 2,
          backgroundBlurPx: -1,
          backgroundImage: {
            name: "unsafe.svg",
            mediaType: "image/svg+xml",
            bytes: 100,
          },
        },
      },
    });
    expect(parsed).toEqual({
      format: APPEARANCE_PREFERENCES_FORMAT,
      themes: { prism: {} },
    });
  });

  it("reads a complete bounded scalar appearance from share query state", () => {
    const query = new URLSearchParams({
      appearanceSymbol: "#445566",
      appearanceText: "#f0eee8",
      appearanceOpacity: "0.35",
      appearanceBlur: "8",
    });
    expect(parseSharedAppearance(query)).toEqual({
      symbolColor: "#445566",
      textColor: "#f0eee8",
      backgroundOpacity: 0.35,
      backgroundBlurPx: 8,
    });
  });

  it("rejects malformed or image-bearing share appearance", () => {
    expect(
      parseSharedAppearance(new URLSearchParams({ appearanceSymbol: "red" })),
    ).toBeUndefined();
    expect(
      parseSharedAppearance(
        new URLSearchParams({ appearanceImage: "blob:https://example.test/x" }),
      ),
    ).toBeUndefined();
  });
});
