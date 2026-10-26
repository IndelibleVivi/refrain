import { useRef } from "react";
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
  followsWork: boolean;
  onSource: (work: boolean) => void;
  onTheme: (theme: SelenV21ThemeId) => void;
  onChange: (change: Partial<ThemeAppearance>) => void;
  onImage: (file: File) => void;
  onRemoveImage: () => void;
  onReset: () => void;
}) {
  const copy = uiCopy(props.locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const defaults = SELEN_V21_APPEARANCE_DEFAULTS[props.theme];
  const opacity =
    props.appearance.backgroundOpacity ?? DEFAULT_BACKGROUND_OPACITY;
  const blur = props.appearance.backgroundBlurPx ?? 0;

  return (
    <div className="refrain-appearance-controls">
      <button type="button" onClick={() => dialog.current?.showModal()}>
        {copy.appearance}
      </button>
      <dialog
        ref={dialog}
        className="refrain-appearance-dialog"
        aria-label={copy.customizeAppearance}
      >
        <header>
          <h2>{copy.customizeAppearance}</h2>
          <button
            type="button"
            aria-label={copy.close}
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </header>
        <div className="refrain-appearance-controls__body">
          <div
            className="refrain-appearance-source"
            role="group"
            aria-label={copy.appearance}
          >
            <button
              type="button"
              aria-pressed={props.followsWork}
              onClick={() => props.onSource(true)}
            >
              {copy.workAppearance}
            </button>
            <button
              type="button"
              aria-pressed={!props.followsWork}
              onClick={() => props.onSource(false)}
            >
              {copy.localAppearance}
            </button>
          </div>
          <p>{copy.appearanceOwnership}</p>
          <label className="refrain-appearance-theme">
            <span>{copy.themeGrammar}</span>
            <select
              aria-label={copy.appearance}
              value={props.theme}
              onChange={(event) =>
                props.onTheme(event.currentTarget.value as SelenV21ThemeId)
              }
            >
              <option value="paper-sonata">Paper Sonata</option>
              <option value="prism">Prism</option>
              <option value="nocturne-ink">Nocturne Ink</option>
              <option value="herbarium">Herbarium</option>
            </select>
          </label>
          <fieldset className="refrain-palette">
            <legend>{copy.colorPalette}</legend>
            {[
              {
                name: copy.originalPalette,
                color: defaults.symbolColor,
                ink: defaults.textColor,
              },
              {
                name: "Rose",
                color: "#a36875",
                ink: props.theme === "nocturne-ink" ? "#f1ddd9" : "#402f37",
              },
              {
                name: "Moss",
                color: "#768964",
                ink: props.theme === "nocturne-ink" ? "#e3e8d7" : "#30392d",
              },
              {
                name: "Tide",
                color: "#53879e",
                ink: props.theme === "nocturne-ink" ? "#dce9ed" : "#263944",
              },
            ].map((palette) => (
              <button
                key={palette.name}
                type="button"
                aria-label={palette.name}
                aria-pressed={
                  (props.appearance.symbolColor ?? defaults.symbolColor) ===
                  palette.color
                }
                style={{ "--swatch": palette.color } as React.CSSProperties}
                onClick={() =>
                  props.onChange({
                    symbolColor: palette.color,
                    textColor: palette.ink,
                  })
                }
              >
                <span />
                {palette.name}
              </button>
            ))}
          </fieldset>
          <details className="refrain-fine-tune">
            <summary>{copy.fineTune}</summary>
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
          </details>
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
          </div>
          <p>{copy.photoHint}</p>
          {props.appearance.backgroundImage ? (
            <>
              <div className="refrain-photo-crop">
                <label>
                  {copy.backgroundPosition}
                  <select
                    aria-label={copy.backgroundPosition}
                    value={props.appearance.backgroundPosition ?? "center"}
                    onChange={(event) =>
                      props.onChange({
                        backgroundPosition: event.currentTarget
                          .value as ThemeAppearance["backgroundPosition"],
                      })
                    }
                  >
                    <option value="center">{copy.imageCenter}</option>
                    <option value="top">{copy.imageTop}</option>
                    <option value="bottom">{copy.imageBottom}</option>
                  </select>
                </label>
                <label>
                  {copy.backgroundFit}
                  <select
                    aria-label={copy.backgroundFit}
                    value={props.appearance.backgroundFit ?? "cover"}
                    onChange={(event) =>
                      props.onChange({
                        backgroundFit: event.currentTarget
                          .value as ThemeAppearance["backgroundFit"],
                      })
                    }
                  >
                    <option value="cover">{copy.imageCover}</option>
                    <option value="contain">{copy.imageContain}</option>
                  </select>
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
            </>
          ) : null}
          <div className="refrain-appearance-controls__actions">
            <button type="button" onClick={props.onReset}>
              {copy.resetAppearance}
            </button>
          </div>
          <p>{copy.appearanceLocal}</p>
          <p aria-live="polite" role="status">
            {props.notice ?? ""}
          </p>
        </div>
      </dialog>
    </div>
  );
}
