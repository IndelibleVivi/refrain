import { describe, expect, it } from "vitest";
import {
  readStoredAppearancePreferences,
  writeStoredAppearancePreferences,
} from "./appearance-storage.js";
import { APPEARANCE_PREFERENCES_FORMAT } from "./appearance.js";

class MemoryStorage {
  value: string | null = null;
  getItem() {
    return this.value;
  }
  setItem(_key: string, value: string) {
    this.value = value;
  }
}

describe("appearance preference storage", () => {
  it("round-trips validated scalar and image metadata", () => {
    const storage = new MemoryStorage();
    const preferences = {
      format: APPEARANCE_PREFERENCES_FORMAT,
      selectedTheme: "herbarium" as const,
      themes: {
        herbarium: {
          symbolColor: "#556644",
          backgroundOpacity: 0.3,
          backgroundImage: {
            name: "garden.webp",
            mediaType: "image/webp",
            bytes: 500,
          },
        },
      },
    };
    writeStoredAppearancePreferences(preferences, storage);
    expect(readStoredAppearancePreferences(storage)).toEqual(preferences);
  });

  it("returns clean preferences for denied or malformed storage", () => {
    expect(
      readStoredAppearancePreferences({
        getItem() {
          throw new Error("denied");
        },
      }),
    ).toEqual({ format: APPEARANCE_PREFERENCES_FORMAT, themes: {} });
    expect(
      readStoredAppearancePreferences({ getItem: () => "not json" }),
    ).toEqual({ format: APPEARANCE_PREFERENCES_FORMAT, themes: {} });
  });
});
