import type { SelenV21ThemeId } from "./selen-v21-model.js";

export const APPEARANCE_PREFERENCES_FORMAT =
  "refrain-appearance-preferences@0" as const;
export const MAX_APPEARANCE_IMAGE_BYTES = 12 * 1024 * 1024;
export const DEFAULT_BACKGROUND_OPACITY = 0.24;
export const MAX_BACKGROUND_OPACITY = 0.65;
export const MAX_BACKGROUND_BLUR_PX = 24;

const THEMES: readonly SelenV21ThemeId[] = [
  "paper-sonata",
  "prism",
  "nocturne-ink",
  "herbarium",
];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const RASTER_MEDIA_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const SELEN_V21_APPEARANCE_DEFAULTS: Record<
  SelenV21ThemeId,
  { readonly symbolColor: string; readonly textColor: string }
> = {
  "paper-sonata": { symbolColor: "#29465f", textColor: "#1d252b" },
  prism: { symbolColor: "#4965ff", textColor: "#181824" },
  "nocturne-ink": { symbolColor: "#cfd3d6", textColor: "#e4dfd1" },
  herbarium: { symbolColor: "#6a7a58", textColor: "#2c2f26" },
};

export interface PortableShareAppearance {
  readonly symbolColor?: string;
  readonly textColor?: string;
  readonly backgroundOpacity?: number;
  readonly backgroundBlurPx?: number;
}

export interface AppearanceImageMetadata {
  readonly name: string;
  readonly mediaType: string;
  readonly bytes: number;
}

export interface ThemeAppearance extends PortableShareAppearance {
  readonly backgroundImage?: AppearanceImageMetadata;
}

export interface AppearancePreferences {
  readonly format: typeof APPEARANCE_PREFERENCES_FORMAT;
  readonly selectedTheme?: SelenV21ThemeId;
  readonly themes: Partial<Record<SelenV21ThemeId, ThemeAppearance>>;
}

export interface ResolvedAppearance extends PortableShareAppearance {
  readonly backgroundImageUrl?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function color(value: unknown): string | undefined {
  return typeof value === "string" && HEX_COLOR.test(value)
    ? value.toLowerCase()
    : undefined;
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

export function appearanceImageMetadata(
  value: unknown,
): AppearanceImageMetadata | undefined {
  const candidate = record(value);
  if (!candidate) return undefined;
  if (
    typeof candidate.name !== "string" ||
    candidate.name.length === 0 ||
    candidate.name.length > 255 ||
    typeof candidate.mediaType !== "string" ||
    !RASTER_MEDIA_TYPES.has(candidate.mediaType) ||
    !Number.isSafeInteger(candidate.bytes) ||
    (candidate.bytes as number) <= 0 ||
    (candidate.bytes as number) > MAX_APPEARANCE_IMAGE_BYTES
  )
    return undefined;
  return {
    name: candidate.name,
    mediaType: candidate.mediaType,
    bytes: candidate.bytes as number,
  };
}

export function normalizePortableAppearance(
  value: unknown,
): PortableShareAppearance | undefined {
  const candidate = record(value);
  if (!candidate) return undefined;
  const normalized: PortableShareAppearance = {
    ...(color(candidate.symbolColor)
      ? { symbolColor: color(candidate.symbolColor) }
      : {}),
    ...(color(candidate.textColor)
      ? { textColor: color(candidate.textColor) }
      : {}),
    ...(boundedNumber(
      candidate.backgroundOpacity,
      0,
      MAX_BACKGROUND_OPACITY,
    ) !== undefined
      ? {
          backgroundOpacity: boundedNumber(
            candidate.backgroundOpacity,
            0,
            MAX_BACKGROUND_OPACITY,
          ),
        }
      : {}),
    ...(boundedNumber(candidate.backgroundBlurPx, 0, MAX_BACKGROUND_BLUR_PX) !==
    undefined
      ? {
          backgroundBlurPx: boundedNumber(
            candidate.backgroundBlurPx,
            0,
            MAX_BACKGROUND_BLUR_PX,
          ),
        }
      : {}),
  };
  return normalized;
}

function parseThemeAppearance(value: unknown): ThemeAppearance {
  const candidate = record(value);
  if (!candidate) return {};
  return {
    ...(normalizePortableAppearance(candidate) ?? {}),
    ...(appearanceImageMetadata(candidate.backgroundImage)
      ? { backgroundImage: appearanceImageMetadata(candidate.backgroundImage) }
      : {}),
  };
}

export function parseAppearancePreferences(
  value: unknown,
): AppearancePreferences {
  const candidate = record(value);
  if (candidate?.format !== APPEARANCE_PREFERENCES_FORMAT)
    return { format: APPEARANCE_PREFERENCES_FORMAT, themes: {} };
  const sourceThemes = record(candidate.themes);
  const themes: AppearancePreferences["themes"] = {};
  if (sourceThemes)
    for (const theme of THEMES) {
      if (theme in sourceThemes)
        themes[theme] = parseThemeAppearance(sourceThemes[theme]);
    }
  const selectedTheme = THEMES.includes(
    candidate.selectedTheme as SelenV21ThemeId,
  )
    ? (candidate.selectedTheme as SelenV21ThemeId)
    : undefined;
  return {
    format: APPEARANCE_PREFERENCES_FORMAT,
    ...(selectedTheme ? { selectedTheme } : {}),
    themes,
  };
}

export function appearanceForTheme(
  preferences: AppearancePreferences,
  theme: SelenV21ThemeId,
): ThemeAppearance {
  return { ...(preferences.themes[theme] ?? {}) };
}

export function parseSharedAppearance(
  query: URLSearchParams,
): PortableShareAppearance | undefined {
  if (
    query.has("appearanceImage") ||
    query.has("appearanceImageUrl") ||
    query.has("backgroundImage")
  )
    return undefined;
  const names = [
    "appearanceSymbol",
    "appearanceText",
    "appearanceOpacity",
    "appearanceBlur",
  ] as const;
  if (!names.some((name) => query.has(name))) return undefined;
  const raw: Record<string, unknown> = {};
  const symbol = query.get("appearanceSymbol");
  const text = query.get("appearanceText");
  const opacity = query.get("appearanceOpacity");
  const blur = query.get("appearanceBlur");
  if (symbol !== null) raw.symbolColor = symbol;
  if (text !== null) raw.textColor = text;
  if (opacity !== null) raw.backgroundOpacity = Number(opacity);
  if (blur !== null) raw.backgroundBlurPx = Number(blur);
  const normalized = normalizePortableAppearance(raw);
  if (!normalized) return undefined;
  const expectedCount = [symbol, text, opacity, blur].filter(
    (value) => value !== null,
  ).length;
  return Object.keys(normalized).length === expectedCount
    ? normalized
    : undefined;
}

export function isRasterAppearanceImage(file: {
  type: string;
  size: number;
}): boolean {
  return (
    RASTER_MEDIA_TYPES.has(file.type) &&
    Number.isSafeInteger(file.size) &&
    file.size > 0 &&
    file.size <= MAX_APPEARANCE_IMAGE_BYTES
  );
}
