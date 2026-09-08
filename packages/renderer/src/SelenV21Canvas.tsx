import { useLayoutEffect, useRef, useState } from "react";
import type { SelenV21Piece, SelenV21ThemeId } from "./selen-v21-model.js";
import type { RefrainLocale } from "./ui-copy.js";
import {
  mountSelenV21,
  type SelenV21Runtime,
  type SelenV21RuntimeCallbacks,
  type SelenV21SelectionOption,
  type SelenV21Surface,
} from "./selen-v21-runtime.js";

interface SelenV21CanvasProps {
  artifactIdentity: string;
  locale: RefrainLocale;
  callbacks: SelenV21RuntimeCallbacks;
  canReturnSelection: boolean;
  playbackEnabled: boolean;
  piece: SelenV21Piece;
  playing: boolean;
  positionBeat: number;
  selectionOptions: readonly SelenV21SelectionOption[];
  selectedAnchor?: string;
  surface: "url" | "mcp-canvas";
  themeId?: SelenV21ThemeId;
}

function initialSurface(
  surface: SelenV21CanvasProps["surface"],
): SelenV21Surface {
  if (surface === "mcp-canvas") return "mcp";
  return typeof window !== "undefined" && window.innerWidth <= 620
    ? "mobile"
    : "desktop";
}

export function SelenV21Canvas({
  artifactIdentity,
  locale,
  callbacks,
  canReturnSelection,
  playbackEnabled,
  piece,
  playing,
  positionBeat,
  selectionOptions,
  selectedAnchor,
  surface,
  themeId = "paper-sonata",
}: SelenV21CanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<SelenV21Runtime | undefined>(undefined);
  const presentation = useRef<
    | {
        artifactIdentity: string;
        detailsOpen: boolean;
        selection: string;
        languageFocused: boolean;
        themeFocused: boolean;
      }
    | undefined
  >(undefined);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const [resolvedSurface, setResolvedSurface] = useState<SelenV21Surface>(() =>
    initialSurface(surface),
  );

  useLayoutEffect(() => {
    if (surface === "mcp-canvas") {
      setResolvedSurface("mcp");
      return;
    }
    const element = host.current;
    if (!element) return;
    const resolve = (width: number) =>
      setResolvedSurface(width <= 620 ? "mobile" : "desktop");
    resolve(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) resolve(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [surface]);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    runtime.current = mountSelenV21(element, {
      callbacks: {
        onLocaleChange: (next) => callbacksRef.current.onLocaleChange(next),
        onThemeChange: (next) => callbacksRef.current.onThemeChange(next),
        onExportArtifact: () => callbacksRef.current.onExportArtifact?.(),
        onExportSource: () => callbacksRef.current.onExportSource?.(),
        onRestartPlayback: () => callbacksRef.current.onRestartPlayback(),
        onSeekBeat: (beat) => callbacksRef.current.onSeekBeat(beat),
        onSelectionAction: (anchor) =>
          callbacksRef.current.onSelectionAction?.(anchor),
        onExactSelectionAction: (kind, anchor, action) =>
          callbacksRef.current.onExactSelectionAction?.(kind, anchor, action),
        onSelectionChange: (anchor) =>
          callbacksRef.current.onSelectionChange(anchor),
        onStopPlayback: () => callbacksRef.current.onStopPlayback(),
        onTogglePlayback: () => callbacksRef.current.onTogglePlayback(),
      },
      locale,
      piece,
      canReturnSelection,
      playbackEnabled,
      selectionOptions,
      state: { playing, positionBeat, selectedAnchor },
      surface: resolvedSurface,
      themeId,
    });
    // A language change redraws the same composer. Keep the listening engine
    // outside this bridge and retain the open passage controls in this view.
    const previous = presentation.current;
    if (previous?.artifactIdentity === artifactIdentity) {
      const details = element.querySelector("details");
      if (details) details.open = previous.detailsOpen;
      const select = element.querySelector(".exact-selection select");
      if (select instanceof HTMLSelectElement) {
        select.value = previous.selection;
        element
          .querySelectorAll<HTMLButtonElement>(
            ".exact-selection__actions button",
          )
          .forEach((button) => {
            button.disabled = select.value === "";
          });
      }
      if (previous.languageFocused)
        element.querySelector<HTMLButtonElement>(".refrain-language")?.focus();
      if (previous.themeFocused)
        element.querySelector<HTMLSelectElement>(".refrain-theme")?.focus();
    }
    return () => {
      presentation.current = {
        artifactIdentity,
        detailsOpen: element.querySelector("details")?.open ?? false,
        selection:
          element.querySelector<HTMLSelectElement>(".exact-selection select")
            ?.value ?? "",
        languageFocused:
          element.querySelector(".refrain-language") === document.activeElement,
        themeFocused:
          element.querySelector(".refrain-theme") === document.activeElement,
      };
      runtime.current?.destroy();
      runtime.current = undefined;
    };
  }, [
    artifactIdentity,
    locale,
    canReturnSelection,
    playbackEnabled,
    piece,
    resolvedSurface,
    selectionOptions,
    surface,
    themeId,
  ]);

  useLayoutEffect(() => {
    runtime.current?.update({ playing, positionBeat, selectedAnchor });
  }, [playing, positionBeat, selectedAnchor]);

  return (
    <div className="selen-v21-host" data-renderer="selen-v21" ref={host} />
  );
}
