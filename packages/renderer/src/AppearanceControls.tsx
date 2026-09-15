import {
  DEFAULT_BACKGROUND_OPACITY,
  MAX_BACKGROUND_BLUR_PX,
  MAX_BACKGROUND_OPACITY,
  SELEN_V21_APPEARANCE_DEFAULTS,
  type ThemeAppearance,
} from "./appearance.js";
import type { SelenV21ThemeId } from "./selen-v21-model.js";
import type { RefrainLocale } from "./ui-copy.js";
import { uiCopy } from "./ui-copy.js";

export function AppearanceControls(props: {
  appearance: ThemeAppearance;
  locale: RefrainLocale;
  notice?: string;
  theme: SelenV21ThemeId;
  onChange: (change: Partial<ThemeAppearance>) => void;
  onImage: (file: File) => void;
  onRemoveImage: () => void;
  onReset: () => void;
}) {
  const copy = uiCopy(props.locale);
  const defaults = SELEN_V21_APPEARANCE_DEFAULTS[props.theme];
  const opacity =
    props.appearance.backgroundOpacity ?? DEFAULT_BACKGROUND_OPACITY;
  const blur = props.appearance.backgroundBlurPx ?? 0;

  return (
    <details className="refrain-appearance-controls">
      <summary>{copy.customizeAppearance}</summary>
      <div className="refrain-appearance-controls__body">
        <div className="refrain-appearance-controls__colors">
          <label>
            <span>{copy.symbolColor}</span>
            <input
              aria-label={copy.symbolColor}
              data-appearance-control="symbol"
              type="color"
              value={props.appearance.symbolColor ?? defaults.symbolColor}
              onChange={(event) =>
                props.onChange({ symbolColor: event.currentTarget.value })
              }
            />
          </label>
          <label>
            <span>{copy.textColor}</span>
            <input
              aria-label={copy.textColor}
              data-appearance-control="text"
              type="color"
              value={props.appearance.textColor ?? defaults.textColor}
              onChange={(event) =>
                props.onChange({ textColor: event.currentTarget.value })
              }
            />
          </label>
        </div>
        <label className="refrain-appearance-controls__range">
          <span>
            {copy.backgroundOpacity} · {Math.round(opacity * 100)}%
          </span>
          <input
            aria-label={copy.backgroundOpacity}
            max={MAX_BACKGROUND_OPACITY}
            min="0"
            step="0.01"
            type="range"
            value={opacity}
            onChange={(event) =>
              props.onChange({
                backgroundOpacity: Number(event.currentTarget.value),
              })
            }
          />
        </label>
        <label className="refrain-appearance-controls__range">
          <span>
            {copy.backgroundBlur} · {blur}px
          </span>
          <input
            aria-label={copy.backgroundBlur}
            max={MAX_BACKGROUND_BLUR_PX}
            min="0"
            step="1"
            type="range"
            value={blur}
            onChange={(event) =>
              props.onChange({
                backgroundBlurPx: Number(event.currentTarget.value),
              })
            }
          />
        </label>
        <div className="refrain-appearance-controls__actions">
          <label className="refrain-appearance-controls__file">
            {copy.chooseBackground}
            <input
              accept="image/avif,image/gif,image/jpeg,image/png,image/webp"
              aria-label={copy.backgroundImage}
              type="file"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) props.onImage(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {props.appearance.backgroundImage ? (
            <button type="button" onClick={props.onRemoveImage}>
              {copy.removeBackground}
            </button>
          ) : null}
          <button type="button" onClick={props.onReset}>
            {copy.resetAppearance}
          </button>
        </div>
        <p>{copy.appearanceLocal}</p>
        <p aria-live="polite" role="status">
          {props.notice ?? ""}
        </p>
      </div>
    </details>
  );
}
