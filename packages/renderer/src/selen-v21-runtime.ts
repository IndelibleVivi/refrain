// The visual composer below is a source transplant from Selen v21
// (experiments/themebench/index.html at df2d3c5). The typed boundary lives in
// selen-v21-model.ts; preserving the authored imperative SVG functions avoids
// a second, approximate React geometry implementation.
// @ts-nocheck

import type { SelenV21Piece, SelenV21ThemeId } from "./selen-v21-model.js";
import { uiCopy, type RefrainLocale } from "./ui-copy.js";
import type { RefrainSelectionKind } from "./selection.js";
import {
  motifFigureAnchorIsInteractive,
  motifLandmarkAnchors,
  SELEN_V21_DENSE_MOTIF_THRESHOLD,
} from "./selen-v21-density.js";
import {
  DEFAULT_BACKGROUND_OPACITY,
  SELEN_V21_APPEARANCE_DEFAULTS,
  type ResolvedAppearance,
} from "./appearance.js";

export type SelenV21Surface = "mcp" | "desktop" | "mobile";

export interface SelenV21RuntimeState {
  playing: boolean;
  positionBeat: number;
  selectedAnchor?: string;
  preparation?: {
    completedAssets: number;
    totalAssets: number;
    completedBytes: number;
    totalBytes: number;
  } | null;
}

export interface SelenV21RuntimeCallbacks {
  onLocaleChange: (locale: RefrainLocale) => void;
  onThemeChange: (theme: SelenV21ThemeId) => void;
  onTogglePlayback: () => void | Promise<void>;
  onRestartPlayback: () => void | Promise<void>;
  onStopPlayback: () => void | Promise<void>;
  onSeekBeat: (beat: number) => void | Promise<void>;
  onSelectionChange: (anchor?: string) => void;
  onSelectionAction?: (
    anchor: string,
  ) => boolean | void | Promise<boolean | void>;
  onExactSelectionAction?: (
    kind: RefrainSelectionKind,
    anchor: string,
    action: "copy" | "download" | "return",
  ) => void | Promise<void>;
  onExportArtifact?: () => void | Promise<void>;
  onExportSource?: () => void | Promise<void>;
}

export interface SelenV21SelectionOption {
  kind: RefrainSelectionKind;
  anchor: string;
  label: string;
}

export interface SelenV21Runtime {
  update(state: SelenV21RuntimeState): void;
  destroy(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

const SELEN_V21_THEMES = {
  paper: {
    id: "paper-sonata",
    label: "Paper Sonata",
    description: "现代手稿语法",
    className: "theme-paper",
    composer: {
      id: "paper-folio-composer@0",
      embedded: "continuous compact manuscript field",
      expanded: "continuous folio spread with adaptive folds and marginalia",
      elements: [
        "continuous-folio-sheet",
        "adaptive-folio-fold",
        "engraved-phrase-band",
        "marginal-motif-seal",
        "editorial-return-rule",
        "graphite-cursor",
        "impression-hatch",
      ],
    },
    voice: {
      lead: "#29465f",
      echo: "#747078",
      bass: "#8b5260",
      pulse: "#9b7942",
    },
    section: ["#29465f", "#6e6970", "#8b5260", "#9b7942"],
    accent: SELEN_V21_APPEARANCE_DEFAULTS["paper-sonata"].symbolColor,
    companion: "#8b5260",
    display: "modern",
    texture: "subtle",
    motion: "restrained",
  },
  prism: {
    id: "prism",
    label: "Prism",
    description: "连续折射氛围 · 明亮而有生命力",
    className: "theme-prism",
    composer: {
      id: "prism-field-composer@0",
      embedded: "compact connected light field",
      expanded: "wide refractive stage",
      elements: [
        "continuous-caustic-field",
        "spectral-ribbon",
        "adaptive-form-seam",
        "diffraction-glint",
        "crystal-motif",
        "return-ray",
        "light-slit-cursor",
      ],
    },
    voice: {
      lead: "#4965ff",
      echo: "#8e5eff",
      bass: "#f0677b",
      pulse: "#e9a13c",
    },
    section: ["#6678ff", "#a56dff", "#f16e87", "#edac4a"],
    accent: SELEN_V21_APPEARANCE_DEFAULTS.prism.symbolColor,
    companion: "#f0677b",
    display: "modern",
    texture: "subtle",
    motion: "restrained",
  },
  nocturne: {
    id: "nocturne-ink",
    label: "Nocturne Ink",
    description: "深海暗场语法 · 暗涌墨池与矿银刻痕",
    className: "theme-nocturne",
    composer: {
      id: "nocturne-pool-composer@0",
      embedded: "single lifted dark pool, compressed wells",
      expanded: "dark negative-space field with separated ink pools",
      elements: [
        "matte-dark-field",
        "ink-pool",
        "brush-trace",
        "section-well",
        "mineral-incision",
        "sparse-mineral-route",
        "luminous-incision-cursor",
      ],
    },
    voice: {
      lead: "#d8d2c0",
      echo: "#8fa6b2",
      bass: "#5f7a80",
      pulse: "#b3a077",
    },
    section: ["#c9c3b2", "#8fa6b2", "#8d7f8e", "#b3a077"],
    accent: SELEN_V21_APPEARANCE_DEFAULTS["nocturne-ink"].symbolColor,
    companion: "#8a5f6d",
    display: "editorial",
    texture: "subtle",
    motion: "restrained",
  },
  herbarium: {
    id: "herbarium",
    label: "Herbarium",
    description: "暖纸标本语法 · 压制纤维与收藏签",
    className: "theme-herbarium",
    composer: {
      id: "herbarium-sheet-composer@0",
      embedded: "single pressed specimen sheet",
      expanded: "collector's folio plate with hairline mount and label tickets",
      elements: [
        "warm-specimen-sheet",
        "hairline-mount",
        "stem-fibre-trace",
        "fern-branch-trace",
        "root-system",
        "density-bud",
        "motif-sprig-signature",
        "collector-label-ticket",
        "specimen-pin-cursor",
      ],
    },
    voice: {
      lead: "#5d7a4e",
      echo: "#7d946b",
      bass: "#7a5c42",
      pulse: "#a3854f",
    },
    section: ["#5d7a4e", "#7d946b", "#a3685f", "#a3854f"],
    accent: SELEN_V21_APPEARANCE_DEFAULTS.herbarium.symbolColor,
    companion: "#a3685f",
    display: "lyrical",
    texture: "subtle",
    motion: "restrained",
  },
};

function cloneThemes() {
  return JSON.parse(JSON.stringify(SELEN_V21_THEMES));
}

function themeKey(id: SelenV21ThemeId) {
  if (id === "paper-sonata") return "paper";
  if (id === "nocturne-ink") return "nocturne";
  return id;
}

function parseHex(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((index) =>
    Number.parseInt(value.slice(index, index + 2), 16),
  );
}

function mixHex(left, right, rightWeight) {
  const a = parseHex(left);
  const b = parseHex(right);
  return `#${a
    .map((value, index) =>
      Math.round(value * (1 - rightWeight) + b[index] * rightWeight)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function mountSelenV21(
  root: HTMLElement,
  input: {
    locale: RefrainLocale;
    piece: SelenV21Piece;
    themeId: SelenV21ThemeId;
    surface: SelenV21Surface;
    state: SelenV21RuntimeState;
    callbacks: SelenV21RuntimeCallbacks;
    selectionOptions: readonly SelenV21SelectionOption[];
    canReturnSelection: boolean;
    playbackEnabled: boolean;
    appearance?: ResolvedAppearance;
  },
): SelenV21Runtime {
  const copy = uiCopy(input.locale);
  const piece = input.piece;
  const callbacks = input.callbacks;
  const themes = cloneThemes();
  const theme = themes[themeKey(input.themeId)];
  const appearanceDefaults = SELEN_V21_APPEARANCE_DEFAULTS[input.themeId];
  if (input.appearance?.symbolColor) {
    const originalAccent = theme.accent;
    theme.accent = input.appearance.symbolColor;
    Object.keys(theme.voice).forEach((voiceId) => {
      const original = theme.voice[voiceId];
      theme.voice[voiceId] =
        original === originalAccent
          ? input.appearance.symbolColor
          : mixHex(original, input.appearance.symbolColor, 0.58);
    });
    theme.section = theme.section.map((original) =>
      original === originalAccent
        ? input.appearance.symbolColor
        : mixHex(original, input.appearance.symbolColor, 0.58),
    );
  }
  const durationBeats = Math.max(0.0001, piece.durationBeats);
  const durationSeconds = piece.durationSeconds;
  const beatSeconds = 60 / piece.tempo;
  const state = {
    playing: input.state.playing,
    dragging: false,
    positionBeat: input.state.positionBeat,
    selectedAnchor: input.state.selectedAnchor ?? null,
    preparation: input.state.preparation ?? null,
  };
  const figures = [];
  const transports = [];
  const presentations = [];
  let instanceCounter = 0;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const formatTime = (seconds) => {
    const safe = Math.max(0, Math.round(seconds));
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
  };
  const svgEl = (name, attrs = {}, text) => {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attrs).forEach(([key, value]) =>
      node.setAttribute(key, String(value)),
    );
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const htmlEl = (name, className, text) => {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const fnv1a = (text) => {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  };
  const seeded = (seedText) => {
    let seed = parseInt(fnv1a(seedText), 16) || 1;
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
  };

  function configureThemeRoot(themeRoot, selectedTheme) {
    themeRoot.dataset.display = selectedTheme.display;
    themeRoot.dataset.texture = selectedTheme.texture;
    themeRoot.dataset.motion = selectedTheme.motion;
    themeRoot.dataset.composer = selectedTheme.composer.id;
    themeRoot.style.setProperty("--accent", selectedTheme.accent);
    themeRoot.style.setProperty("--companion", selectedTheme.companion);
    themeRoot.style.setProperty("--selection-bg", `${selectedTheme.accent}13`);
    themeRoot.style.setProperty(
      "--ink",
      input.appearance?.textColor ?? appearanceDefaults.textColor,
    );
    if (input.appearance?.backgroundImageUrl) {
      themeRoot.dataset.customBackground = "true";
      themeRoot.style.setProperty(
        "--appearance-image",
        `url("${input.appearance.backgroundImageUrl.replaceAll('"', "%22")}")`,
      );
      themeRoot.style.setProperty(
        "--appearance-opacity",
        String(
          input.appearance.backgroundOpacity ?? DEFAULT_BACKGROUND_OPACITY,
        ),
      );
      themeRoot.style.setProperty(
        "--appearance-blur",
        `${input.appearance.backgroundBlurPx ?? 0}px`,
      );
    }
  }

  function transformLabel(occurrence) {
    const parts = [];
    if (occurrence.transpose) parts.push(copy.semitones(occurrence.transpose));
    if (occurrence.stretch !== 1) parts.push(copy.stretch(occurrence.stretch));
    if (occurrence.inversion) parts.push(copy.inversion);
    if (occurrence.retrograde) parts.push(copy.retrograde);
    return parts.length ? parts.join(" · ") : copy.original;
  }
  function sectionAtBeat(beat) {
    return (
      piece.sections.find(
        (section) => beat >= section.startBeat && beat < section.endBeat,
      ) ?? (beat >= durationBeats ? piece.sections.at(-1) : undefined)
    );
  }
  function sectionLabelAtBeat(beat) {
    return sectionAtBeat(beat)?.label ?? copy.continuous;
  }
  function currentSection() {
    return sectionAtBeat(state.positionBeat);
  }
  function currentPassageWindow() {
    const section = currentSection();
    if (section) return { ...section, authored: true };
    const width = 16;
    const startBeat = clamp(
      Math.floor(state.positionBeat / 8) * 8,
      0,
      Math.max(0, durationBeats - width),
    );
    return {
      id: "through-line",
      label: copy.now,
      startBeat,
      endBeat: Math.min(durationBeats, startBeat + width),
      authored: false,
    };
  }
  function occurrenceSectionLabel(occurrence) {
    return sectionLabelAtBeat(occurrence.startBeat);
  }
  function currentOccurrence() {
    return piece.motifOccurrences.find(
      (occ) =>
        state.positionBeat >= occ.startBeat &&
        state.positionBeat <= occ.startBeat + occ.durationBeats,
    );
  }

  function transformedMotifAtoms(occurrence) {
    const source = piece.motifDefinitions[occurrence.motif].atoms.map(
      (atom) => ({ ...atom }),
    );
    const total = Math.max(...source.map((atom) => atom.t + atom.d));
    let atoms = source;
    if (occurrence.retrograde)
      atoms = source
        .slice()
        .reverse()
        .map((atom) => ({ ...atom, t: total - atom.t - atom.d }));
    const axis = atoms[0]?.p ?? 0;
    return atoms.map((atom) => ({
      t: atom.t * occurrence.stretch,
      d: atom.d * occurrence.stretch,
      p:
        (occurrence.inversion ? axis * 2 - atom.p : atom.p) +
        occurrence.transpose,
    }));
  }

  function selectOccurrence(anchor) {
    state.selectedAnchor = state.selectedAnchor === anchor ? null : anchor;
    callbacks.onSelectionChange(state.selectedAnchor ?? undefined);
    updateAll();
  }
  function seekTo(beat) {
    state.positionBeat = clamp(beat, 0, durationBeats);
    callbacks.onSeekBeat(state.positionBeat);
    updateAll();
  }
  function restartPlayback() {
    state.positionBeat = 0;
    callbacks.onRestartPlayback();
    updateAll();
  }
  function stopPlayback() {
    state.playing = false;
    state.positionBeat = 0;
    callbacks.onStopPlayback();
    updateAll();
  }
  function togglePlayback() {
    return callbacks.onTogglePlayback();
  }
  function pointerToBeat(event, instance) {
    const rect = instance.svg.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * instance.m.width;
    return instance.beatForX(svgX);
  }
  function beginPlayheadDrag(event, instance) {
    event.preventDefault();
    state.dragging = true;
    instance.refs.playheadGroup.classList.add("dragging");
    instance.refs.playheadHit.setPointerCapture?.(event.pointerId);
    state.positionBeat = pointerToBeat(event, instance);
    updateAll();
    const move = (moveEvent) => {
      if (!state.dragging) return;
      state.positionBeat = pointerToBeat(moveEvent, instance);
      callbacks.onSeekBeat(state.positionBeat);
      updateAll();
    };
    const end = (endEvent) => {
      state.dragging = false;
      instance.refs.playheadGroup.classList.remove("dragging");
      try {
        instance.refs.playheadHit.releasePointerCapture?.(endEvent.pointerId);
      } catch {}
      instance.refs.playheadHit.removeEventListener("pointermove", move);
      instance.refs.playheadHit.removeEventListener("pointerup", end);
      instance.refs.playheadHit.removeEventListener("pointercancel", end);
      callbacks.onSeekBeat(state.positionBeat);
    };
    instance.refs.playheadHit.addEventListener("pointermove", move);
    instance.refs.playheadHit.addEventListener("pointerup", end);
    instance.refs.playheadHit.addEventListener("pointercancel", end);
  }
  function handlePlayheadKeydown(event) {
    const jumps = { ArrowLeft: -1, ArrowRight: 1, PageUp: 4, PageDown: -4 };
    if (event.key in jumps) {
      event.preventDefault();
      seekTo(state.positionBeat + jumps[event.key]);
    } else if (event.key === "Home") {
      event.preventDefault();
      seekTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      seekTo(durationBeats);
    }
  }

  function groupedVoiceMoments(voiceId) {
    const events = piece.events.filter(
      (event) => event.voiceId === voiceId && voiceId !== "pulse",
    );
    const map = new Map();
    events.forEach((event) => {
      const key = `${event.startBeat}|${event.durationBeats}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(event);
    });
    return [...map.values()]
      .map((group) => ({
        startBeat: group[0].startBeat,
        durationBeats: Math.max(...group.map((event) => event.durationBeats)),
        midi:
          group.reduce((sum, event) => sum + event.midi * event.velocity, 0) /
          group.reduce((sum, event) => sum + event.velocity, 0),
        velocity:
          group.reduce((sum, event) => sum + event.velocity, 0) / group.length,
      }))
      .sort((a, b) => a.startBeat - b.startBeat);
  }

  function buildVoicePhrases(voiceId, xForBeat, yForMidi) {
    const moments = groupedVoiceMoments(voiceId);
    const phrases = [];
    let phrase = [];
    let previousEnd = -Infinity;
    moments.forEach((moment) => {
      if (moment.startBeat - previousEnd > 1.6 && phrase.length) {
        phrases.push(phrase);
        phrase = [];
      }
      const y = yForMidi(moment.midi);
      phrase.push(
        { x: xForBeat(moment.startBeat), y, velocity: moment.velocity },
        {
          x: xForBeat(moment.startBeat + moment.durationBeats),
          y,
          velocity: moment.velocity,
        },
      );
      previousEnd = moment.startBeat + moment.durationBeats;
    });
    if (phrase.length) phrases.push(phrase);
    return phrases;
  }

  function densityBins(count = 42) {
    const bins = piece.densityByCount[String(count)];
    if (!bins)
      throw new Error(`Missing Selen density series for ${count} bins.`);
    return bins;
  }

  function smoothPath(points) {
    if (!points.length) return "";
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 1; i < points.length - 1; i++) {
      const current = points[i],
        next = points[i + 1];
      const cx = (current.x + next.x) / 2,
        cy = (current.y + next.y) / 2;
      d += ` Q ${current.x.toFixed(2)} ${current.y.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)}`;
    }
    const last = points.at(-1);
    d += ` T ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
    return d;
  }

  // Engraved-stroke model: a filled outline whose width follows per-point
  // pressure (velocity) and tapers at phrase entries and terminals.
  function pressureOutline(points, widthFor) {
    if (points.length < 2) return "";
    const n = points.length;
    const widths = points.map((point, index) => {
      const t = index / (n - 1);
      const taper = Math.pow(Math.sin(Math.PI * clamp(t, 0.02, 0.98)), 0.55);
      return Math.max(0.3, widthFor(point) * (0.35 + 0.65 * taper));
    });
    const top = [],
      bottom = [];
    for (let index = 0; index < n; index++) {
      const prev = points[Math.max(0, index - 1)],
        next = points[Math.min(n - 1, index + 1)];
      const dx = next.x - prev.x,
        dy = next.y - prev.y;
      const length = Math.hypot(dx, dy) || 1;
      const nx = -dy / length,
        ny = dx / length;
      top.push({
        x: points[index].x + (nx * widths[index]) / 2,
        y: points[index].y + (ny * widths[index]) / 2,
      });
      bottom.push({
        x: points[index].x - (nx * widths[index]) / 2,
        y: points[index].y - (ny * widths[index]) / 2,
      });
    }
    return `${top.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ")} ${bottom
      .reverse()
      .map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(" ")} Z`;
  }

  function motifGlyphPath(definition, occurrence, width = 28, height = 18) {
    const atoms = transformedMotifAtoms(occurrence);
    const minT = Math.min(...atoms.map((atom) => atom.t));
    const maxT = Math.max(...atoms.map((atom) => atom.t + atom.d));
    const minP = Math.min(...atoms.map((atom) => atom.p));
    const maxP = Math.max(...atoms.map((atom) => atom.p));
    const timeSpan = Math.max(0.01, maxT - minT);
    const pitchSpan = Math.max(1, maxP - minP);
    const points = atoms.map((atom) => ({
      x: ((atom.t - minT) / timeSpan) * width,
      y: height - ((atom.p - minP) / pitchSpan) * height,
    }));
    return smoothPath(points);
  }

  function layoutFor(surface, themeId) {
    const desktop = surface === "desktop";
    const mobile = surface === "mobile";
    if (themeId === "paper-sonata") {
      if (desktop)
        return {
          width: 840,
          height: 430,
          left: 28,
          right: 24,
          top: 25,
          plotTop: 54,
          plotBottom: 382,
        };
      if (mobile)
        return {
          width: 640,
          height: 420,
          left: 22,
          right: 18,
          top: 23,
          plotTop: 50,
          plotBottom: 374,
        };
      return {
        width: 640,
        height: 352,
        left: 22,
        right: 18,
        top: 23,
        plotTop: 48,
        plotBottom: 312,
      };
    }
    if (themeId === "nocturne-ink") {
      if (desktop)
        return {
          width: 900,
          height: 370,
          left: 34,
          right: 26,
          top: 30,
          plotTop: 56,
          plotBottom: 314,
        };
      if (mobile)
        return {
          width: 640,
          height: 420,
          left: 26,
          right: 20,
          top: 28,
          plotTop: 52,
          plotBottom: 372,
        };
      return {
        width: 640,
        height: 344,
        left: 26,
        right: 20,
        top: 28,
        plotTop: 52,
        plotBottom: 300,
      };
    }
    if (themeId === "herbarium") {
      if (desktop)
        return {
          width: 880,
          height: 400,
          left: 30,
          right: 24,
          top: 27,
          plotTop: 56,
          plotBottom: 344,
        };
      if (mobile)
        return {
          width: 640,
          height: 420,
          left: 24,
          right: 19,
          top: 25,
          plotTop: 52,
          plotBottom: 374,
        };
      return {
        width: 640,
        height: 348,
        left: 24,
        right: 19,
        top: 25,
        plotTop: 50,
        plotBottom: 306,
      };
    }
    if (desktop)
      return {
        width: 900,
        height: 350,
        left: 36,
        right: 27,
        top: 31,
        plotTop: 58,
        plotBottom: 300,
      };
    if (mobile)
      return {
        width: 640,
        height: 420,
        left: 29,
        right: 21,
        top: 29,
        plotTop: 54,
        plotBottom: 374,
      };
    return {
      width: 640,
      height: 340,
      left: 29,
      right: 21,
      top: 29,
      plotTop: 54,
      plotBottom: 296,
    };
  }

  function semanticProjectionDigest() {
    const semantic = {
      sections: piece.sections,
      motifs: piece.motifOccurrences.map((o) => [
        o.anchor,
        o.startBeat,
        o.durationBeats,
        o.registerMidi,
        o.transpose,
        o.stretch,
        o.inversion,
        o.retrograde,
      ]),
      voices: piece.voices.map((v) => [v.id, groupedVoiceMoments(v.id)]),
      density: densityBins(42),
    };
    return `semantic:${fnv1a(JSON.stringify(semantic))}`;
  }

  function visualPlanDigest(theme, surface) {
    const plan = {
      semanticProjectionId: semanticProjectionDigest(),
      composer: theme.composer,
      surface,
      accent: theme.accent,
      companion: theme.companion,
      display: theme.display,
      texture: theme.texture,
      motion: theme.motion,
    };
    return `${theme.id}:${fnv1a(JSON.stringify(plan))}`;
  }

  function updateDigestProof() {
    document.getElementById("semanticDigest").textContent =
      semanticProjectionDigest();
    document.getElementById("paperPlanDigest").textContent = visualPlanDigest(
      themes.paper,
      state.activeSurface,
    );
    document.getElementById("prismPlanDigest").textContent = visualPlanDigest(
      themes.prism,
      state.activeSurface,
    );
  }

  function paperPlanFor(surface) {
    const m = layoutFor(surface, "paper-sonata");
    const fullWidth = m.width - m.left - m.right;
    const maxLeaves = surface === "desktop" ? 3 : 1;
    const targetBeatsPerLeaf = surface === "desktop" ? 48 : durationBeats;
    const densityFactor =
      surface === "desktop" ? clamp(piece.exactEventCount / 360, 0, 0.38) : 0;
    const leafCount = clamp(
      Math.ceil(durationBeats / targetBeatsPerLeaf + densityFactor),
      1,
      maxLeaves,
    );
    const gap = surface === "desktop" && leafCount > 1 ? 7 : 0;
    const usableWidth = fullWidth - gap * (leafCount - 1);
    const leafWidth = usableWidth / leafCount;
    const windowDuration = durationBeats / leafCount;
    const yOffsets = surface === "desktop" ? [2, 0, 3] : [0];
    const frames = Array.from({ length: leafCount }, (_, index) => {
      const x = m.left + index * (leafWidth + gap);
      const yOffset = yOffsets[index % yOffsets.length];
      const startBeat = index * windowDuration;
      const endBeat =
        index === leafCount - 1 ? durationBeats : (index + 1) * windowDuration;
      const y = m.top + yOffset;
      const height = m.plotBottom - m.top + 18 - yOffset - (index % 2 ? 2 : 0);
      return {
        index,
        x,
        y,
        width: leafWidth,
        height,
        startBeat,
        endBeat,
        innerLeft: x + (surface === "desktop" ? 16 : 12),
        innerRight: x + leafWidth - (surface === "desktop" ? 13 : 10),
        topMargin: y + 34,
        contentTop: y + 52,
        contentBottom: y + height - 27,
      };
    });
    const frameForBeat = (beat) =>
      frames.find((frame) => beat >= frame.startBeat && beat < frame.endBeat) ??
      frames.at(-1);
    const xForBeat = (beat) => {
      const safe = clamp(beat, 0, durationBeats);
      const frame = frameForBeat(
        safe === durationBeats ? durationBeats - 0.0001 : safe,
      );
      const local =
        (safe - frame.startBeat) / (frame.endBeat - frame.startBeat);
      return (
        frame.innerLeft +
        clamp(local, 0, 1) * (frame.innerRight - frame.innerLeft)
      );
    };
    const beatForX = (x) => {
      const frame =
        frames.find((item) => x >= item.x && x <= item.x + item.width) ??
        frames.reduce((best, item) => {
          const distance =
            x < item.x
              ? item.x - x
              : x > item.x + item.width
                ? x - (item.x + item.width)
                : 0;
          return !best || distance < best.distance ? { item, distance } : best;
        }, null).item;
      const local = clamp(
        (x - frame.innerLeft) / (frame.innerRight - frame.innerLeft),
        0,
        1,
      );
      return frame.startBeat + local * (frame.endBeat - frame.startBeat);
    };
    const voiceBand = (frame, voiceId) => {
      const available = frame.contentBottom - frame.contentTop;
      const positions = { lead: 0.17, echo: 0.5, bass: 0.82 };
      return frame.contentTop + available * (positions[voiceId] ?? 0.5);
    };
    const voiceY = (frame, voiceId, midi) => {
      const center = voiceBand(frame, voiceId);
      const reference = voiceId === "bass" ? 38 : voiceId === "echo" ? 72 : 67;
      return clamp(
        center - (midi - reference) * 1.0,
        frame.contentTop + 3,
        frame.contentBottom - 4,
      );
    };
    const motifPoint = (occurrence) => {
      const frame = frameForBeat(occurrence.startBeat);
      const x = xForBeat(occurrence.startBeat + occurrence.durationBeats / 2);
      const phraseY = voiceY(
        frame,
        occurrence.voiceId,
        occurrence.registerMidi,
      );
      const y = clamp(
        phraseY - 34,
        frame.contentTop + 7,
        frame.contentBottom - 9,
      );
      return { x, y, phraseY };
    };
    return {
      m,
      frames,
      xForBeat,
      beatForX,
      voiceY,
      motifPoint,
      frameForBeat,
      minX: m.left,
      maxX: m.width - m.right,
    };
  }

  function prismPlanFor(surface) {
    const m = layoutFor(surface, "prism");
    const plotWidth = m.width - m.left - m.right;
    const xForBeat = (beat) =>
      m.left + (clamp(beat, 0, durationBeats) / durationBeats) * plotWidth;
    const beatForX = (x) =>
      clamp(((x - m.left) / plotWidth) * durationBeats, 0, durationBeats);
    // Per-voice spectral bands: register is a local deviation around each
    // voice's own center, so low voices float in the field instead of
    // parking at the bottom like a chart baseline.
    const voiceBand = (voiceId) => {
      const positions = { lead: 0.22, echo: 0.52, bass: 0.76 };
      return (
        m.plotTop + (m.plotBottom - m.plotTop) * (positions[voiceId] ?? 0.5)
      );
    };
    const yForVoiceMidi = (voiceId, midi) => {
      const reference = voiceId === "bass" ? 38 : voiceId === "echo" ? 72 : 67;
      return clamp(
        voiceBand(voiceId) - (midi - reference) * 1.05,
        m.plotTop + 6,
        m.plotBottom - 16,
      );
    };
    const yForMidi = (midi) => yForVoiceMidi("lead", midi);
    // Refraction weaves the ribbons: each voice drifts on its own slow
    // wavelength, so bands converge, cross, and part instead of running
    // as three parallel rails.
    const weaveProfile = {
      lead: { amp: 30, freq: (Math.PI * 2) / 300, phase: 0.4 },
      echo: { amp: 36, freq: (Math.PI * 2) / 380, phase: 2.6 },
      bass: { amp: 26, freq: (Math.PI * 2) / 240, phase: 4.4 },
    };
    const weaveFor = (voiceId, x) => {
      const w = weaveProfile[voiceId];
      return w ? Math.sin(x * w.freq + w.phase) * w.amp : 0;
    };
    const motifPoint = (occurrence) => {
      const x = xForBeat(occurrence.startBeat + occurrence.durationBeats / 2);
      const ribbonY = clamp(
        yForVoiceMidi(occurrence.voiceId, occurrence.registerMidi) +
          weaveFor(occurrence.voiceId, x),
        m.plotTop + 6,
        m.plotBottom - 16,
      );
      return { x, y: ribbonY - 42, ribbonY };
    };
    return {
      m,
      xForBeat,
      beatForX,
      yForMidi,
      yForVoiceMidi,
      weaveFor,
      motifPoint,
      minX: m.left,
      maxX: m.width - m.right,
    };
  }

  function romanNumeral(value) {
    const numerals = [
      [10, "X"],
      [9, "IX"],
      [5, "V"],
      [4, "IV"],
      [1, "I"],
    ];
    let remaining = Math.max(1, Math.floor(value));
    let result = "";
    for (const [amount, symbol] of numerals) {
      while (remaining >= amount) {
        result += symbol;
        remaining -= amount;
      }
    }
    return result;
  }

  function sectionColor(theme, index) {
    return theme.section[index % theme.section.length];
  }

  function sectionLabelEntries(plan, minWidth = 52) {
    return piece.sections.map((section, index) => {
      const startX = plan.xForBeat(section.startBeat);
      const endX = plan.xForBeat(section.endBeat);
      const span = Math.abs(endX - startX);
      const nextStart = piece.sections[index + 1]
        ? plan.xForBeat(piece.sections[index + 1].startBeat)
        : plan.maxX;
      const room = Math.max(span, nextStart - startX);
      const selectedOccurrence = piece.motifOccurrences.find(
        (item) => item.anchor === state.selectedAnchor,
      );
      const selectedSectionId = selectedOccurrence
        ? sectionAtBeat(selectedOccurrence.startBeat)?.id
        : undefined;
      const currentSectionId = currentSection()?.id;
      const duration = section.endBeat - section.startBeat;
      const longest = Math.max(
        0,
        ...piece.sections.map((item) => item.endBeat - item.startBeat),
      );
      const showLabel =
        room >= minWidth ||
        index === 0 ||
        index === piece.sections.length - 1 ||
        section.id === selectedSectionId ||
        section.id === currentSectionId ||
        duration === longest;
      return { section, index, startX, endX, room, showLabel };
    });
  }

  function createIconButton(label, kind, primary = false) {
    const button = htmlEl("button", `icon-button${primary ? " primary" : ""}`);
    button.type = "button";
    button.setAttribute("aria-label", label);
    if (kind === "play")
      button.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" fill="currentColor"/></svg>';
    if (kind === "pause")
      button.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5.5" width="3.5" height="13" rx="1" fill="currentColor"/><rect x="13.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor"/></svg>';
    if (kind === "restart")
      button.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.1 8.2H2.8V4.9M3.4 8.1A9 9 0 1 1 3 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (kind === "stop")
      button.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="1.4" fill="currentColor"/></svg>';
    return button;
  }

  function buildTransport(theme, surface) {
    const compact = surface === "mcp";
    const root = htmlEl(
      "section",
      `transport${compact ? "" : " page-transport"}`,
    );
    root.setAttribute("aria-label", copy.transport);
    const buttons = htmlEl("div", "transport-buttons");
    const play = createIconButton(copy.play, "play", true);
    const restart = createIconButton(copy.restart, "restart");
    const stop = createIconButton(copy.stop, "stop");
    play.disabled = !input.playbackEnabled;
    restart.disabled = !input.playbackEnabled;
    stop.disabled = !input.playbackEnabled;
    play.addEventListener("click", () => void togglePlayback());
    restart.addEventListener("click", () => restartPlayback());
    stop.addEventListener("click", () => stopPlayback());
    buttons.append(play, restart, stop);
    const timeline = htmlEl("div", "timeline");
    const time = htmlEl("div", "time");
    const current = htmlEl("strong", "", "0:00");
    const total = htmlEl("span", "", formatTime(durationSeconds));
    time.append(current, document.createTextNode(" / "), total);
    const sectionNow = htmlEl(
      "div",
      "section-now",
      currentSection()?.label ?? copy.continuous,
    );
    const seek = document.createElement("input");
    seek.type = "range";
    seek.className = "seek";
    seek.min = "0";
    seek.max = String(durationBeats);
    seek.step = "0.01";
    seek.value = String(state.positionBeat);
    seek.setAttribute("aria-label", copy.seek);
    seek.disabled = !input.playbackEnabled;
    seek.addEventListener("input", () => seekTo(Number(seek.value)));
    timeline.append(time, sectionNow, seek);
    root.append(buttons, timeline);
    transports.push({ root, play, current, total, sectionNow, seek });
    return root;
  }

  function buildDetails(theme) {
    const details = htmlEl("details", "product-details");
    const summary = document.createElement("summary");
    summary.innerHTML = `<span>${copy.about}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 9 12 14.5 17.5 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const body = htmlEl("div", "details-body");
    const grid = htmlEl("div", "details-grid");
    [
      [
        piece.sections.length ? String(piece.sections.length) : "—",
        piece.sections.length ? copy.sections : copy.noSections,
      ],
      [String(piece.sourceVoiceCount), copy.voices],
      [String(piece.motifOccurrences.length), copy.occurrences],
      [String(piece.tempo), `BPM · ${piece.meter}`],
    ].forEach(([value, label]) => {
      const box = document.createElement("div");
      box.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
      grid.append(box);
    });
    const paragraph = htmlEl("p", "", copy.aboutCopy);
    const appearance = htmlEl("div", "appearance-line");
    appearance.innerHTML = `<span>${copy.appearance}</span><span><strong>${theme.label}</strong></span>`;
    body.append(grid, paragraph, appearance);
    details.append(summary, body);
    return details;
  }

  function buildSelectionStrip() {
    const strip = htmlEl("div", "selection-strip");
    strip.dataset.visible = "false";
    strip.setAttribute("aria-live", "polite");
    const content = htmlEl("div", "selection-copy");
    const title = htmlEl("strong");
    const meta = htmlEl("span");
    content.append(title, meta);
    const actionLabel = input.surface === "mcp" ? copy.send : copy.copy;
    const action = htmlEl("button", "selection-action", actionLabel);
    action.type = "button";
    action.addEventListener("click", async () => {
      const occurrence = piece.motifOccurrences.find(
        (item) => item.anchor === state.selectedAnchor,
      );
      if (!occurrence) return;
      try {
        const accepted = await callbacks.onSelectionAction?.(occurrence.anchor);
        action.textContent =
          accepted === false
            ? copy.failed
            : input.surface === "mcp"
              ? copy.sent
              : copy.copied;
        setTimeout(() => (action.textContent = actionLabel), 1100);
      } catch {
        action.textContent = copy.failed;
        setTimeout(() => (action.textContent = actionLabel), 1100);
      }
    });
    strip.append(content, action);
    return { root: strip, title, meta, action };
  }

  function buildFigure(theme, surface) {
    const shell = htmlEl("section", "figure-shell");
    shell.setAttribute("aria-label", copy.figure);
    const svg = svgEl("svg", {
      class: "air-figure",
      role: "img",
      tabindex: "-1",
    });
    const selection = buildSelectionStrip();
    shell.append(svg, selection.root);
    const instance = {
      id: `fig-${++instanceCounter}`,
      theme,
      surface,
      svg,
      shell,
      selection,
      refs: { motifs: new Map() },
    };
    figures.push(instance);
    renderFigure(instance);
    return { shell, instance };
  }

  function renderFigure(instance) {
    if (instance.theme.id === "paper-sonata") renderPaperSonataFigure(instance);
    else if (instance.theme.id === "nocturne-ink")
      renderNocturneFigure(instance);
    else if (instance.theme.id === "herbarium") renderHerbariumFigure(instance);
    else renderPrismFigure(instance);
  }

  function prepareFigure(instance, plan) {
    const { svg, refs, theme } = instance;
    const { m, xForBeat, beatForX, motifPoint } = plan;
    instance.m = m;
    instance.xForBeat = xForBeat;
    instance.beatForX = beatForX;
    instance.motifPoint = motifPoint;
    svg.setAttribute("viewBox", `0 0 ${m.width} ${m.height}`);
    svg.replaceChildren();
    refs.motifs.clear();
    refs.sectionFrames = new Map();
    const prefix = instance.id;
    const title = svgEl(
      "title",
      { id: `${prefix}-title` },
      copy.figureTitle(piece.title, theme.label),
    );
    const desc = svgEl(
      "desc",
      { id: `${prefix}-desc` },
      copy.figureDescription(theme.id, piece.sections.length),
    );
    svg.setAttribute("aria-labelledby", `${prefix}-title ${prefix}-desc`);
    svg.append(title, desc);
    return prefix;
  }

  function addSharedFigureDefs(instance, prefix, theme, plan) {
    const { svg, refs } = instance;
    const { m } = plan;
    const defs = svgEl("defs");
    const heardClip = svgEl("clipPath", { id: `${prefix}-heard` });
    refs.heardClipRect = svgEl("rect", {
      x: plan.minX,
      y: m.top - 4,
      width: 0,
      height: m.plotBottom - m.top + 48,
    });
    heardClip.append(refs.heardClipRect);
    defs.append(heardClip);
    const nowClip = svgEl("clipPath", { id: `${prefix}-now` });
    refs.nowClipRect = svgEl("rect", {
      x: plan.minX - 20,
      y: m.top - 4,
      width: 0,
      height: m.plotBottom - m.top + 48,
      rx: 12,
    });
    nowClip.append(refs.nowClipRect);
    defs.append(nowClip);
    const blur = svgEl("filter", {
      id: `${prefix}-blur`,
      x: "-35%",
      y: "-35%",
      width: "170%",
      height: "170%",
    });
    blur.append(
      svgEl("feGaussianBlur", {
        stdDeviation: theme.id === "prism" ? "4.6" : "1.5",
      }),
    );
    defs.append(blur);
    const grain = svgEl("filter", {
      id: `${prefix}-grain`,
      x: "-10%",
      y: "-10%",
      width: "120%",
      height: "120%",
    });
    grain.append(
      svgEl("feTurbulence", {
        type: "fractalNoise",
        baseFrequency: ".72",
        numOctaves: "2",
        seed: "17",
        result: "noise",
      }),
    );
    grain.append(
      svgEl("feColorMatrix", {
        in: "noise",
        type: "matrix",
        values: "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 .1 0",
      }),
    );
    defs.append(grain);
    svg.append(defs);
    return defs;
  }

  function installMotifInteraction(group, occurrence, refs) {
    group.append(
      svgEl("circle", { cx: 0, cy: 0, r: 25, class: "svg-motif-hit" }),
    );
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      selectOccurrence(occurrence.anchor);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectOccurrence(occurrence.anchor);
      }
    });
    refs.motifs.set(occurrence.anchor, group);
  }

  function installPlayhead(instance, plan, options) {
    const { svg, refs } = instance;
    const { m } = plan;
    refs.playheadGroup = svgEl("g", {
      class: "svg-playhead-ui",
      role: "slider",
      tabindex: "0",
      "aria-label": copy.position,
      "aria-valuemin": "0",
      "aria-valuemax": String(durationBeats),
      "aria-valuenow": "0",
    });
    refs.playheadLine = options.line;
    refs.playheadHandle = options.handle;
    refs.timePill = svgEl("rect", {
      x: -21,
      y: options.timeY,
      width: 42,
      height: 17,
      rx: 8.5,
      fill: options.timeFill,
      class: "svg-playhead-time",
    });
    refs.timeText = svgEl(
      "text",
      {
        x: 0,
        y: options.timeY + 11.2,
        "text-anchor": "middle",
        fill: "white",
        "font-size": "9",
        "font-weight": "720",
        "font-variant-numeric": "tabular-nums",
        class: "svg-playhead-time",
      },
      "0:00",
    );
    refs.playheadHit = svgEl("rect", {
      x: -19,
      y: m.top - 34,
      width: 38,
      height: m.plotBottom - m.top + 72,
      class: "svg-playhead-hit",
    });
    refs.playheadGroup.append(
      refs.playheadLine,
      refs.playheadHandle,
      refs.timePill,
      refs.timeText,
      refs.playheadHit,
    );
    const firstMotif = svg.querySelector(".svg-motif-occurrence");
    if (firstMotif) svg.insertBefore(refs.playheadGroup, firstMotif);
    else svg.append(refs.playheadGroup);
    refs.playheadHit.addEventListener("pointerdown", (event) =>
      beginPlayheadDrag(event, instance),
    );
    refs.playheadGroup.addEventListener("keydown", (event) =>
      handlePlayheadKeydown(event),
    );
  }

  function renderPaperSonataFigure(instance) {
    const { theme, surface, svg, refs } = instance;
    const plan = paperPlanFor(surface);
    const { m, frames, xForBeat, voiceY, motifPoint, frameForBeat } = plan;
    const prefix = prepareFigure(instance, plan);
    const defs = addSharedFigureDefs(instance, prefix, theme, plan);

    const leafShadow = svgEl("filter", {
      id: `${prefix}-leaf-shadow`,
      x: "-15%",
      y: "-15%",
      width: "130%",
      height: "140%",
    });
    leafShadow.append(
      svgEl("feDropShadow", {
        dx: "0",
        dy: "2",
        stdDeviation: "2",
        "flood-color": "#3c3028",
        "flood-opacity": ".075",
      }),
    );
    defs.append(leafShadow);

    const background = svgEl("g", { class: "svg-background" });
    const random = seeded(`${piece.sourceRevision}|paper-folio|background`);
    for (let i = 0; i < 38; i++) {
      const x = 8 + random() * (m.width - 16),
        y = 12 + random() * (m.height - 24);
      background.append(
        svgEl("line", {
          x1: x,
          y1: y,
          x2: Math.min(m.width - 8, x + 7 + random() * 34),
          y2: y + (random() - 0.5) * 1.1,
          stroke: i % 7 === 0 ? theme.companion : theme.accent,
          "stroke-width": random() > 0.88 ? 0.46 : 0.24,
          opacity: 0.03 + random() * 0.045,
          "vector-effect": "non-scaling-stroke",
        }),
      );
    }
    background.append(
      svgEl("rect", {
        x: 0,
        y: 0,
        width: m.width,
        height: m.height,
        fill: "transparent",
        filter: `url(#${prefix}-grain)`,
        opacity: 0.72,
      }),
    );
    svg.append(background);

    const sheetX = frames[0].x;
    const sheetY = Math.min(...frames.map((frame) => frame.y));
    const sheetRight = frames.at(-1).x + frames.at(-1).width;
    const sheetBottom = Math.max(
      ...frames.map((frame) => frame.y + frame.height),
    );
    const sheet = svgEl("g", { class: "svg-paper-sheet" });
    sheet.append(
      svgEl("rect", {
        x: sheetX,
        y: sheetY,
        width: sheetRight - sheetX,
        height: sheetBottom - sheetY,
        rx: 7,
        fill: "rgba(251,249,243,.94)",
        stroke: mixHex(theme.accent, theme.companion, 0.16),
        "stroke-width": 0.52,
        opacity: 0.99,
        "vector-effect": "non-scaling-stroke",
        filter: `url(#${prefix}-leaf-shadow)`,
      }),
    );
    const laidRandom = seeded(`${piece.sourceRevision}|paper-folio|laid`);
    for (let laidY = sheetY + 11; laidY < sheetBottom - 9; laidY += 9.5) {
      sheet.append(
        svgEl("line", {
          x1: sheetX + 9,
          y1: laidY + (laidRandom() - 0.5) * 1.2,
          x2: sheetRight - 9,
          y2: laidY + (laidRandom() - 0.5) * 1.2,
          stroke: "#7d7264",
          "stroke-width": 0.3,
          opacity: 0.05 + laidRandom() * 0.02,
          "vector-effect": "non-scaling-stroke",
        }),
      );
    }
    frames.slice(1).forEach((frame) => {
      const foldX = frame.x - (surface === "desktop" ? 3.5 : 0);
      sheet.append(
        svgEl("rect", {
          x: foldX - 3.4,
          y: sheetY + 6,
          width: 5.6,
          height: sheetBottom - sheetY - 12,
          fill: "rgba(60,48,38,.055)",
        }),
      );
      sheet.append(
        svgEl("line", {
          x1: foldX,
          y1: sheetY + 7,
          x2: foldX,
          y2: sheetBottom - 7,
          stroke: "#3c3028",
          "stroke-width": 0.72,
          opacity: 0.15,
          "vector-effect": "non-scaling-stroke",
        }),
      );
      sheet.append(
        svgEl("line", {
          x1: foldX + 1.5,
          y1: sheetY + 7,
          x2: foldX + 1.5,
          y2: sheetBottom - 7,
          stroke: "white",
          "stroke-width": 0.8,
          opacity: 0.85,
          "vector-effect": "non-scaling-stroke",
        }),
      );
    });
    svg.append(sheet);

    frames.forEach((frame, index) => {
      const leaf = svgEl("g", { class: "svg-paper-leaf" });
      const leafAccent = mixHex(
        theme.accent,
        theme.companion,
        frames.length === 1
          ? 0
          : (index / Math.max(1, frames.length - 1)) * 0.3,
      );
      leaf.append(
        svgEl("rect", {
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
          rx: 0,
          fill:
            index % 2 === 0 ? "rgba(255,255,255,.055)" : "rgba(47,39,29,.014)",
          stroke: "none",
          opacity: 0.85,
        }),
      );
      leaf.append(
        svgEl("line", {
          x1: frame.innerLeft - 6,
          y1: frame.y + 13,
          x2: frame.innerLeft - 6,
          y2: frame.y + frame.height - 13,
          stroke: leafAccent,
          "stroke-width": 0.58,
          opacity: 0.16,
          "vector-effect": "non-scaling-stroke",
        }),
      );
      if (surface === "desktop" && frames.length > 1) {
        leaf.append(
          svgEl(
            "text",
            {
              x: frame.innerLeft,
              y: frame.y + 18,
              class: "svg-paper-margin-label",
              fill: leafAccent,
              opacity: 0.72,
            },
            romanNumeral(index + 1),
          ),
        );
      }
      ["lead", "echo", "bass"].forEach((voiceId, voiceIndex) => {
        const y = voiceY(
          frame,
          voiceId,
          voiceId === "bass" ? 38 : voiceId === "echo" ? 72 : 67,
        );
        leaf.append(
          svgEl(
            "text",
            {
              x: frame.innerLeft,
              y: y - 9,
              class: "svg-paper-voice-label",
              fill: theme.voice[voiceId],
              opacity: 0.58,
            },
            copy.roles[voiceId],
          ),
        );
        leaf.append(
          svgEl("line", {
            x1: frame.innerLeft,
            y1: y + 8,
            x2: frame.innerRight,
            y2: y + 8,
            stroke: theme.voice[voiceId],
            "stroke-width": 0.32,
            opacity: 0.1,
            "stroke-dasharray": voiceIndex === 1 ? "1 3" : "none",
            "vector-effect": "non-scaling-stroke",
          }),
        );
      });
      svg.append(leaf);
    });

    sectionLabelEntries(plan, surface === "desktop" ? 62 : 50).forEach(
      ({ section, index, startX, showLabel }) => {
        const frame = frameForBeat(section.startBeat);
        const group = svgEl("g", { class: "svg-paper-section-rule" });
        const color = sectionColor(theme, index);
        if (section.startBeat > 0) {
          group.append(
            svgEl("line", {
              x1: startX,
              y1: frame.y + 25,
              x2: startX,
              y2: frame.y + frame.height - 14,
              stroke: color,
              "stroke-width": 0.65,
              opacity: 0.2,
              "stroke-dasharray": "2 3",
              "vector-effect": "non-scaling-stroke",
            }),
          );
        }
        if (showLabel) {
          group.append(
            svgEl(
              "text",
              {
                x: startX + 4,
                y: frame.y + 31,
                class: "svg-form-label",
                fill: color,
              },
              section.label,
            ),
          );
        } else {
          group.append(
            svgEl(
              "text",
              {
                x: startX + 3,
                y: frame.y + 29,
                class: "svg-form-index",
                fill: color,
              },
              romanNumeral(index + 1),
            ),
          );
        }
        refs.sectionFrames.set(section.id, group);
        svg.append(group);
      },
    );

    const bins = densityBins(surface === "desktop" ? 52 : 38);
    bins.forEach((bin) => {
      const frame = frameForBeat(bin.start);
      const x = xForBeat((bin.start + bin.end) / 2);
      const strength = clamp(bin.activeCount / 8, 0, 1),
        onset = clamp(bin.onsetCount / 4, 0, 1);
      const count = Math.max(1, Math.round(1 + onset * 3));
      const color = mixHex(
        theme.accent,
        theme.companion,
        clamp((bin.averageMidi - 42) / 40, 0, 1),
      );
      for (let tick = 0; tick < count; tick++) {
        const y = frame.y + frame.height - 13 - (tick % 2) * 2;
        svg.append(
          svgEl("line", {
            x1: x + (tick - (count - 1) / 2) * 1.8,
            y1: y - 2 - strength * 5,
            x2: x + (tick - (count - 1) / 2) * 1.8,
            y2: y + 2,
            stroke: color,
            "stroke-width": 0.42 + 0.38 * strength,
            opacity: 0.12 + 0.18 * strength,
            class: "svg-paper-onset",
            "vector-effect": "non-scaling-stroke",
          }),
        );
      }
    });

    const baseLayer = svgEl("g");
    const playedLayer = svgEl("g", { "clip-path": `url(#${prefix}-heard)` });
    const nowLayer = svgEl("g", { "clip-path": `url(#${prefix}-now)` });
    frames.forEach((frame) => {
      ["lead", "echo", "bass"].forEach((voiceId) => {
        const moments = groupedVoiceMoments(voiceId).filter(
          (moment) =>
            moment.startBeat < frame.endBeat &&
            moment.startBeat + moment.durationBeats > frame.startBeat,
        );
        if (!moments.length) return;
        const points = [];
        moments.forEach((moment) => {
          const start = Math.max(moment.startBeat, frame.startBeat),
            end = Math.min(
              moment.startBeat + moment.durationBeats,
              frame.endBeat,
            );
          const y = voiceY(frame, voiceId, moment.midi);
          points.push(
            { x: xForBeat(start), y, velocity: moment.velocity },
            {
              x: xForBeat(end),
              y: y + (voiceId === "echo" ? 1.2 : 0),
              velocity: moment.velocity,
            },
          );
        });
        const d = smoothPath(points);
        const outline = pressureOutline(
          points,
          (point) => 1.15 + point.velocity * 2.7,
        );
        const average =
          points.reduce((sum, p) => sum + p.velocity, 0) / points.length;
        const width = 1.02 + average * 2.55;
        baseLayer.append(
          svgEl("path", {
            d,
            stroke: "rgba(255,255,255,.9)",
            "stroke-width": width + 2,
            opacity: 0.68,
            fill: "none",
            class: "svg-paper-phrase-halo",
          }),
        );
        baseLayer.append(
          svgEl("path", {
            d: outline,
            fill: theme.voice[voiceId],
            stroke: "none",
            opacity: 0.48,
            class: "svg-paper-phrase-band",
          }),
        );
        playedLayer.append(
          svgEl("path", {
            d: outline,
            fill: theme.voice[voiceId],
            stroke: "none",
            opacity: 0.95,
            class: "svg-paper-phrase-band svg-voice-played",
          }),
        );
        nowLayer.append(
          svgEl("path", {
            d: outline,
            fill: voiceId === "bass" ? theme.companion : theme.accent,
            stroke: "none",
            opacity: 0.8,
            class: "svg-paper-phrase-band svg-voice-now",
          }),
        );
        moments.forEach((moment, nodeIndex) => {
          const x = xForBeat(
            clamp(moment.startBeat, frame.startBeat, frame.endBeat),
          );
          const y = voiceY(frame, voiceId, moment.midi);
          const size = 1.25 + moment.velocity * 1.6;
          const mark =
            voiceId === "echo"
              ? svgEl("ellipse", {
                  cx: x,
                  cy: y,
                  rx: size * 1.22,
                  ry: size * 0.62,
                  fill: "none",
                  stroke: theme.voice[voiceId],
                  "stroke-width": 0.6,
                  opacity: 0.31,
                  class: "svg-paper-onset",
                })
              : svgEl("path", {
                  d: `M ${x - size} ${y} L ${x} ${y - size * 0.7} L ${x + size} ${y} L ${x} ${y + size * 0.7} Z`,
                  fill: theme.voice[voiceId],
                  opacity: 0.24 + 0.07 * (nodeIndex % 2),
                  class: "svg-paper-onset",
                });
          baseLayer.append(mark);
        });
      });
    });
    svg.append(baseLayer, playedLayer, nowLayer);

    piece.events
      .filter((event) => event.voiceId === "pulse")
      .forEach((event, index) => {
        const frame = frameForBeat(event.startBeat);
        const x = xForBeat(event.startBeat),
          y = frame.y + frame.height - 17 - (index % 2) * 2;
        svg.append(
          svgEl("path", {
            d: `M ${x - 2} ${y} L ${x} ${y - 2.45} L ${x + 2} ${y} L ${x} ${y + 2.45} Z`,
            fill: theme.voice.pulse,
            opacity: 0.32,
            class: "svg-paper-onset",
          }),
        );
      });

    piece.motifOccurrences.forEach((occurrence) => {
      const point = motifPoint(occurrence);
      const color = theme.voice[occurrence.voiceId];
      if (Math.abs(point.phraseY - point.y) > 8) {
        svg.append(
          svgEl("path", {
            d: `M ${point.x} ${point.y + 11.5} L ${point.x} ${point.phraseY - 8}`,
            stroke: color,
            "stroke-width": 0.5,
            opacity: 0.28,
            "stroke-dasharray": "1 2.4",
            "vector-effect": "non-scaling-stroke",
          }),
        );
      }
      const sealTurn =
        (seeded(`${piece.sourceRevision}|paper-seal|${occurrence.anchor}`)() -
          0.5) *
        4;
      const group = svgEl("g", {
        class: "svg-motif-occurrence",
        role: "button",
        tabindex: "0",
        "aria-label": copy.selectMotif(
          occurrence.motif,
          occurrence.occurrence,
          transformLabel(occurrence),
          occurrenceSectionLabel(occurrence),
        ),
        transform: `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${sealTurn.toFixed(2)})`,
        "data-anchor": occurrence.anchor,
      });
      group.append(
        svgEl("rect", {
          x: -11.5,
          y: -11.5,
          width: 23,
          height: 23,
          rx: 2.5,
          fill: "rgba(250,248,242,.97)",
          stroke: color,
          "stroke-width": 1.05,
          class: "svg-motif-ring",
          "vector-effect": "non-scaling-stroke",
        }),
        svgEl("rect", {
          x: -8.6,
          y: -8.6,
          width: 17.2,
          height: 17.2,
          rx: 1.2,
          fill: "none",
          stroke: color,
          "stroke-width": 0.34,
          opacity: 0.4,
          "vector-effect": "non-scaling-stroke",
        }),
        svgEl("path", {
          d: motifGlyphPath(
            piece.motifDefinitions[occurrence.motif],
            occurrence,
            15,
            9,
          ),
          stroke: color,
          "stroke-width": 1.2,
          transform: "translate(-7.5 -5.4)",
          class: "svg-motif-glyph",
          "vector-effect": "non-scaling-stroke",
        }),
        svgEl(
          "text",
          {
            x: 7.6,
            y: 9.4,
            "text-anchor": "end",
            fill: color,
            "font-size": "5.6",
            "font-weight": "760",
          },
          String(occurrence.occurrence),
        ),
      );
      installMotifInteraction(group, occurrence, refs);
      svg.append(group);
    });

    refs.playedWash = svgEl("rect", {
      x: plan.minX,
      y: m.top - 3,
      width: 0,
      height: m.plotBottom - m.top + 34,
      fill: "rgba(41,70,95,.015)",
      "pointer-events": "none",
    });
    svg.insertBefore(refs.playedWash, baseLayer);
    refs.nowBand = svgEl("rect", {
      x: plan.minX - 4,
      y: m.top - 2,
      width: 8,
      height: m.plotBottom - m.top + 32,
      fill: "rgba(41,70,95,.047)",
      opacity: 0,
      "pointer-events": "none",
    });
    svg.insertBefore(refs.nowBand, baseLayer);
    instance.motifBaseFill = "rgba(250,248,242,.96)";
    instance.motifSelectedFill = "rgba(139,82,96,.13)";

    const paperAxisHandle = svgEl("g", {
      transform: `translate(0 ${m.top - 5})`,
      "pointer-events": "none",
    });
    paperAxisHandle.append(
      svgEl("rect", {
        x: -6.2,
        y: -6.2,
        width: 12.4,
        height: 12.4,
        rx: 1.6,
        transform: "rotate(45)",
        fill: "#26333b",
        stroke: "white",
        "stroke-width": 1.2,
        "vector-effect": "non-scaling-stroke",
      }),
      svgEl("rect", {
        x: -3,
        y: -3,
        width: 6,
        height: 6,
        rx: 0.8,
        transform: "rotate(45)",
        fill: "none",
        stroke: "rgba(250,248,242,.85)",
        "stroke-width": 0.6,
        "vector-effect": "non-scaling-stroke",
      }),
    );
    installPlayhead(instance, plan, {
      line: svgEl("line", {
        x1: 0,
        y1: m.top - 5,
        x2: 0,
        y2: m.plotBottom + 18,
        stroke: "#26333b",
        "stroke-width": 1.02,
        "vector-effect": "non-scaling-stroke",
        "pointer-events": "none",
      }),
      handle: paperAxisHandle,
      timeY: m.top - 31,
      timeFill: "#26333b",
    });
    updateFigure(instance);
  }

  function renderPrismFigure(instance) {
    const { theme, surface, svg, refs } = instance;
    const plan = prismPlanFor(surface);
    const { m, xForBeat, yForMidi, yForVoiceMidi, weaveFor, motifPoint } = plan;
    const prefix = prepareFigure(instance, plan);
    const defs = addSharedFigureDefs(instance, prefix, theme, plan);
    const bins = densityBins(surface === "desktop" ? 34 : 26);

    const returnGradient = svgEl("linearGradient", {
      id: `${prefix}-return`,
      x1: "0",
      y1: "0",
      x2: "1",
      y2: "0",
    });
    returnGradient.append(
      svgEl("stop", { offset: "0%", "stop-color": theme.voice.lead }),
      svgEl("stop", { offset: "48%", "stop-color": theme.voice.echo }),
      svgEl("stop", { offset: "100%", "stop-color": theme.voice.bass }),
    );
    defs.append(returnGradient);

    Object.entries(theme.voice).forEach(([voiceId, color], index) => {
      const gradient = svgEl("linearGradient", {
        id: `${prefix}-voice-${voiceId}`,
        x1: "0",
        y1: "0",
        x2: "1",
        y2: "0",
      });
      const companion = [
        theme.voice.lead,
        theme.voice.echo,
        theme.voice.bass,
        theme.voice.pulse,
      ][(index + 1) % 4];
      gradient.append(
        svgEl("stop", { offset: "0%", "stop-color": color }),
        svgEl("stop", { offset: "52%", "stop-color": companion }),
        svgEl("stop", { offset: "100%", "stop-color": color }),
      );
      defs.append(gradient);
    });

    const fieldGradient = svgEl("linearGradient", {
      id: `${prefix}-field`,
      x1: "0",
      y1: "0",
      x2: "1",
      y2: "0",
    });
    const gradientBins = densityBins(11);
    gradientBins.forEach((bin, index) => {
      const density = clamp(bin.activeCount / 8, 0, 1);
      const onset = clamp(bin.onsetCount / 4, 0, 1);
      let color = mixHex(
        theme.accent,
        theme.companion,
        clamp((bin.averageMidi - 42) / 40, 0, 1),
      );
      color = mixHex(color, theme.voice.pulse, onset * 0.26);
      color = mixHex(color, "#ffffff", 0.1 + (1 - density) * 0.12);
      fieldGradient.append(
        svgEl("stop", {
          offset: `${(index / (gradientBins.length - 1)) * 100}%`,
          "stop-color": color,
        }),
      );
    });
    defs.append(fieldGradient);

    const slit = svgEl("linearGradient", {
      id: `${prefix}-slit`,
      x1: "0",
      y1: "0",
      x2: "1",
      y2: "0",
    });
    slit.append(
      svgEl("stop", { offset: "0%", "stop-color": "rgba(255,255,255,0)" }),
      svgEl("stop", { offset: "44%", "stop-color": "rgba(255,255,255,.18)" }),
      svgEl("stop", { offset: "50%", "stop-color": "rgba(255,255,255,.84)" }),
      svgEl("stop", { offset: "55%", "stop-color": `${theme.accent}48` }),
      svgEl("stop", { offset: "100%", "stop-color": "rgba(255,255,255,0)" }),
    );
    defs.append(slit);

    const bg = svgEl("g", { class: "svg-background" });
    bg.append(
      svgEl("rect", {
        x: m.left,
        y: m.plotTop - 11,
        width: m.width - m.left - m.right,
        height: m.plotBottom - m.plotTop + 36,
        rx: 26,
        fill: `url(#${prefix}-field)`,
        opacity: 0.035,
      }),
    );
    const random = seeded(`${piece.sourceRevision}|prism-field|caustics`);
    for (let i = 0; i < 10; i++) {
      const x = m.left + random() * (m.width - m.left - m.right);
      const y = m.plotTop + random() * (m.plotBottom - m.plotTop);
      const localBin =
        bins[
          clamp(
            Math.floor(
              ((x - m.left) / (m.width - m.left - m.right)) * bins.length,
            ),
            0,
            bins.length - 1,
          )
        ];
      const density = clamp(localBin.activeCount / 8, 0, 1);
      const color = mixHex(theme.accent, theme.companion, random());
      bg.append(
        svgEl("circle", {
          cx: x.toFixed(2),
          cy: y.toFixed(2),
          r: (7 + random() * 16 + density * 14).toFixed(1),
          fill: color,
          opacity: (0.012 + random() * 0.012 + density * 0.02).toFixed(3),
          filter: `url(#${prefix}-blur)`,
        }),
      );
    }
    svg.append(bg);

    // Density becomes light scattering inside one atmosphere: seeded
    // caustic filaments, never a filled band with a hard floor.
    const filamentRandom = seeded(
      `${piece.sourceRevision}|prism-field|filaments`,
    );
    bins.forEach((bin) => {
      const x = xForBeat((bin.start + bin.end) / 2);
      const density = clamp(bin.activeCount / 8, 0, 1);
      const strands = 1 + Math.round(density * 2);
      for (let strand = 0; strand < strands; strand++) {
        const cy =
          m.plotTop +
          (m.plotBottom - m.plotTop) * (0.16 + filamentRandom() * 0.68);
        const span = 16 + density * 38 + filamentRandom() * 10;
        const drift = (filamentRandom() - 0.5) * 9;
        const d = `M ${(x - span / 2).toFixed(2)} ${cy.toFixed(2)} Q ${x.toFixed(2)} ${(cy - 5 - filamentRandom() * 9).toFixed(2)} ${(x + span / 2).toFixed(2)} ${(cy + drift).toFixed(2)}`;
        svg.append(
          svgEl("path", {
            d,
            stroke: `url(#${prefix}-field)`,
            "stroke-width": (0.5 + density * 1.3).toFixed(2),
            opacity: (0.06 + density * 0.16).toFixed(3),
            fill: "none",
            class: "svg-prism-caustic",
          }),
        );
      }
    });

    sectionLabelEntries(plan, surface === "desktop" ? 66 : 54).forEach(
      ({ section, index, startX, showLabel }) => {
        const group = svgEl("g", { class: "svg-form-seam" });
        const color = sectionColor(theme, index);
        if (section.startBeat > 0) {
          group.append(
            svgEl("rect", {
              x: startX - 3.5,
              y: m.top + 13,
              width: 7,
              height: m.plotBottom - m.top - 3,
              fill: color,
              opacity: 0.045,
            }),
          );
          group.append(
            svgEl("line", {
              x1: startX,
              y1: m.top + 14,
              x2: startX,
              y2: m.plotBottom + 9,
              stroke: color,
              "stroke-width": 0.55,
              opacity: 0.16,
              "stroke-dasharray": "2 5",
              "vector-effect": "non-scaling-stroke",
            }),
          );
        }
        if (showLabel) {
          const chipWidth = [...section.label].length * 9.2 + 11;
          group.append(
            svgEl("rect", {
              x: startX + 4,
              y: m.top + 9,
              width: chipWidth,
              height: 13.5,
              rx: 6.75,
              fill: color,
              opacity: 0.09,
            }),
          );
          group.append(
            svgEl(
              "text",
              {
                x: startX + 9.5,
                y: m.top + 19,
                class: "svg-form-label",
                fill: "#6d6878",
              },
              section.label,
            ),
          );
        } else {
          group.append(
            svgEl("circle", {
              cx: startX + 1,
              cy: m.top + 16,
              r: 1.8,
              fill: color,
              opacity: 0.55,
            }),
          );
          group.append(
            svgEl(
              "text",
              {
                x: startX + 6,
                y: m.top + 19,
                class: "svg-form-index",
                fill: color,
              },
              String(index + 1),
            ),
          );
        }
        refs.sectionFrames.set(section.id, group);
        svg.append(group);
      },
    );

    bins.forEach((bin, index) => {
      const onset = clamp(bin.onsetCount / 4, 0, 1);
      if (onset < 0.23) return;
      const x = xForBeat((bin.start + bin.end) / 2);
      const fieldY =
        m.plotTop +
        (m.plotBottom - m.plotTop) *
          (1 - clamp((bin.averageMidi - 42) / 40, 0, 1));
      const y = clamp(
        fieldY + (index % 2 ? 12 : -10),
        m.plotTop + 18,
        m.plotBottom - 10,
      );
      const size = 1.6 + onset * 3.2;
      const color = mixHex(
        theme.accent,
        theme.companion,
        clamp((bin.averageMidi - 45) / 38, 0, 1),
      );
      const d = `M ${x - size} ${y} L ${x} ${y - size * 0.62} L ${x + size} ${y} L ${x} ${y + size * 0.62} Z`;
      svg.append(
        svgEl("path", {
          d,
          fill: "none",
          stroke: color,
          "stroke-width": 0.55,
          opacity: 0.15 + 0.17 * onset,
          class: "svg-prism-glint",
        }),
      );
    });

    const baseLayer = svgEl("g");
    const playedLayer = svgEl("g", { "clip-path": `url(#${prefix}-heard)` });
    const nowLayer = svgEl("g", { "clip-path": `url(#${prefix}-now)` });
    piece.voices
      .filter((voice) => voice.id !== "pulse")
      .forEach((voice) => {
        buildVoicePhrases(voice.id, xForBeat, (midi) =>
          yForVoiceMidi(voice.id, midi),
        ).forEach((phrase) => {
          phrase.forEach((p) => {
            p.y = clamp(
              p.y + weaveFor(voice.id, p.x),
              m.plotTop + 6,
              m.plotBottom - 16,
            );
          });
          const d = smoothPath(phrase),
            average =
              phrase.reduce((sum, p) => sum + p.velocity, 0) / phrase.length,
            width = 1.05 + average * 2.55;
          baseLayer.append(
            svgEl("path", {
              d,
              stroke: theme.voice[voice.id],
              "stroke-width": width + 7,
              opacity: 0.032,
              filter: `url(#${prefix}-blur)`,
              class: "svg-prism-ribbon",
            }),
          );
          baseLayer.append(
            svgEl("path", {
              d,
              stroke: `url(#${prefix}-voice-${voice.id})`,
              "stroke-width": width,
              opacity: 0.52,
              class: "svg-prism-ribbon",
            }),
          );
          playedLayer.append(
            svgEl("path", {
              d,
              stroke: `url(#${prefix}-voice-${voice.id})`,
              "stroke-width": width + 0.45,
              opacity: 0.9,
              class: "svg-prism-ribbon",
            }),
          );
          nowLayer.append(
            svgEl("path", {
              d,
              stroke: `url(#${prefix}-voice-${voice.id})`,
              "stroke-width": width + 2.4,
              opacity: 0.7,
              filter: `url(#${prefix}-blur)`,
              class: "svg-prism-ribbon",
            }),
          );
          phrase
            .filter((_, i) => i % 3 === 0)
            .forEach((point) =>
              baseLayer.append(
                svgEl("circle", {
                  cx: point.x,
                  cy: point.y,
                  r: 1.05 + average * 1.45,
                  fill: theme.voice[voice.id],
                  opacity: 0.22,
                  class: "svg-prism-glint",
                }),
              ),
            );
        });
      });
    svg.append(baseLayer, playedLayer, nowLayer);

    piece.events
      .filter((event) => event.voiceId === "pulse")
      .forEach((event, index) => {
        const x = xForBeat(event.startBeat),
          y = m.plotBottom - 5 - (index % 3) * 2.1;
        svg.append(
          svgEl("line", {
            x1: x - 1.5,
            y1: y + 1.6,
            x2: x + 1.5,
            y2: y - 1.6,
            stroke: theme.voice.pulse,
            "stroke-width": 0.85,
            opacity: 0.34,
            class: "svg-prism-glint",
          }),
        );
      });

    piece.motifOccurrences.forEach((occurrence) => {
      const point = motifPoint(occurrence),
        color = theme.voice[occurrence.voiceId];
      const group = svgEl("g", {
        class: "svg-motif-occurrence",
        role: "button",
        tabindex: "0",
        "aria-label": copy.selectMotif(
          occurrence.motif,
          occurrence.occurrence,
          transformLabel(occurrence),
          occurrenceSectionLabel(occurrence),
        ),
        transform: `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`,
        "data-anchor": occurrence.anchor,
      });
      const glyphTurn = occurrence.transpose * 2.5;
      const glyphMirror = occurrence.inversion ? "scale(-1 1)" : "";
      const glyphGroup = svgEl("g", {
        transform: `rotate(${glyphTurn}) ${glyphMirror}`.trim(),
      });
      glyphGroup.append(
        svgEl("path", {
          d: motifGlyphPath(
            piece.motifDefinitions[occurrence.motif],
            occurrence,
            21,
            12,
          ),
          stroke: color,
          "stroke-width": 1.25,
          transform: "translate(-10.5 -6)",
          class: "svg-motif-glyph",
          "vector-effect": "non-scaling-stroke",
        }),
      );
      group.append(
        svgEl("line", {
          x1: 0,
          y1: 14.5,
          x2: 0,
          y2: 34,
          stroke: color,
          "stroke-width": 0.45,
          opacity: 0.5,
          "vector-effect": "non-scaling-stroke",
        }),
        svgEl("path", {
          d: "M 0 -16 C 8 -13.5 13.5 -8 16 0 C 13.5 8 8 13.5 0 16 C -8 13.5 -13.5 8 -16 0 C -13.5 -8 -8 -13.5 0 -16 Z",
          fill: "rgba(255,255,255,.26)",
          stroke: color,
          "stroke-width": 1,
          class: "svg-motif-ring",
          "vector-effect": "non-scaling-stroke",
        }),
        svgEl("path", {
          d: "M 0 -15.5 L 0 0 M 12.5 -6.5 L 0 0 M -12.5 6.5 L 0 0",
          stroke: color,
          "stroke-width": 0.4,
          opacity: 0.42,
          fill: "none",
          "vector-effect": "non-scaling-stroke",
        }),
        svgEl("circle", {
          cx: 0,
          cy: 0,
          r: 11,
          fill: "none",
          stroke: color,
          "stroke-width": 0.32,
          opacity: 0.26,
          "vector-effect": "non-scaling-stroke",
        }),
        glyphGroup,
      );
      installMotifInteraction(group, occurrence, refs);
      svg.append(group);
    });

    refs.playedWash = svgEl("rect", {
      x: plan.minX,
      y: m.top,
      width: 0,
      height: m.plotBottom - m.top + 18,
      rx: 16,
      fill: `url(#${prefix}-field)`,
      opacity: 0.022,
      "pointer-events": "none",
    });
    svg.insertBefore(refs.playedWash, baseLayer);
    refs.nowBand = svgEl("rect", {
      x: plan.minX - 22,
      y: m.top - 4,
      width: 44,
      height: m.plotBottom - m.top + 28,
      rx: 18,
      fill: `url(#${prefix}-slit)`,
      opacity: 0,
      filter: `url(#${prefix}-blur)`,
      "pointer-events": "none",
    });
    svg.insertBefore(refs.nowBand, baseLayer);
    instance.motifBaseFill = "rgba(255,255,255,.28)";
    instance.motifSelectedFill = `${theme.accent}22`;

    const prismAxis = svgEl("g", { "pointer-events": "none" });
    prismAxis.append(
      svgEl("line", {
        x1: 0,
        y1: m.top - 4,
        x2: 0,
        y2: m.plotBottom + 16,
        stroke: theme.accent,
        "stroke-width": 4.4,
        opacity: 0.14,
        filter: `url(#${prefix}-blur)`,
        "vector-effect": "non-scaling-stroke",
      }),
      svgEl("line", {
        x1: 0,
        y1: m.top - 4,
        x2: 0,
        y2: m.plotBottom + 16,
        stroke: "#2b2940",
        "stroke-width": 0.75,
        opacity: 0.8,
        "vector-effect": "non-scaling-stroke",
      }),
      svgEl("line", {
        x1: 0,
        y1: m.top - 4,
        x2: 0,
        y2: m.plotBottom + 16,
        stroke: theme.accent,
        "stroke-width": 0.4,
        opacity: 0.75,
        "vector-effect": "non-scaling-stroke",
      }),
    );
    const prismAxisHandle = svgEl("g", {
      transform: `translate(0 ${m.top - 6})`,
      "pointer-events": "none",
    });
    prismAxisHandle.append(
      svgEl("path", {
        d: "M 0 -7 C 3.6 -6 6 -3.6 7 0 C 6 3.6 3.6 6 0 7 C -3.6 6 -6 3.6 -7 0 C -6 -3.6 -3.6 -6 0 -7 Z",
        fill: theme.accent,
        stroke: "white",
        "stroke-width": 1.1,
        "vector-effect": "non-scaling-stroke",
      }),
      svgEl("circle", { cx: 0, cy: 0, r: 1.7, fill: "white" }),
    );
    installPlayhead(instance, plan, {
      line: prismAxis,
      handle: prismAxisHandle,
      timeY: m.top - 31,
      timeFill: "#2b2940",
    });
    updateFigure(instance);
  }

  function nocturnePlanFor(surface) {
    const m = layoutFor(surface, "nocturne-ink");
    const plotWidth = m.width - m.left - m.right;
    const xForBeat = (beat) =>
      m.left + (clamp(beat, 0, durationBeats) / durationBeats) * plotWidth;
    const beatForX = (x) =>
      clamp(((x - m.left) / plotWidth) * durationBeats, 0, durationBeats);
    // Per-voice ink bands: register is local deviation around each voice's
    // own center; bass is a broad low wash, never a chart baseline.
    const voiceBand = (voiceId) => {
      const positions = { lead: 0.24, echo: 0.52, bass: 0.78 };
      return (
        m.plotTop + (m.plotBottom - m.plotTop) * (positions[voiceId] ?? 0.5)
      );
    };
    const yForVoiceMidi = (voiceId, midi) => {
      const reference = voiceId === "bass" ? 38 : voiceId === "echo" ? 72 : 67;
      return clamp(
        voiceBand(voiceId) - (midi - reference) * 1.0,
        m.plotTop + 8,
        m.plotBottom - 14,
      );
    };
    const yForMidi = (midi) => yForVoiceMidi("lead", midi);
    // Mineral incisions hover 36 px above their trace (floating-mark law),
    // tethered only by a faint dotted incision when separation could confuse.
    const motifPoint = (occurrence) => ({
      x: xForBeat(occurrence.startBeat + occurrence.durationBeats / 2),
      y: yForVoiceMidi(occurrence.voiceId, occurrence.registerMidi) - 36,
      traceY: yForVoiceMidi(occurrence.voiceId, occurrence.registerMidi),
    });
    return {
      m,
      xForBeat,
      beatForX,
      yForMidi,
      yForVoiceMidi,
      motifPoint,
      minX: m.left,
      maxX: m.width - m.right,
    };
  }

  function renderNocturneFigure(instance) {
    const { theme, surface, svg, refs } = instance;
    const plan = nocturnePlanFor(surface);
    const { m, xForBeat, yForVoiceMidi, motifPoint } = plan;
    const prefix = prepareFigure(instance, plan);
    const defs = addSharedFigureDefs(instance, prefix, theme, plan);
    // Light shaft for the cursor: light falling from the surface into depth.
    const shaft = svgEl("linearGradient", {
      id: `${prefix}-shaft`,
      x1: "0",
      y1: "0",
      x2: "0",
      y2: "1",
    });
    shaft.append(
      svgEl("stop", {
        offset: "0",
        "stop-color": "#cfe0e0",
        "stop-opacity": 0.17,
      }),
      svgEl("stop", {
        offset: ".72",
        "stop-color": "#cfe0e0",
        "stop-opacity": 0.035,
      }),
      svgEl("stop", {
        offset: "1",
        "stop-color": "#cfe0e0",
        "stop-opacity": 0,
      }),
    );
    defs.append(shaft);

    // The field is deep water, not a darkened page; pools rise as slow
    // currents where the music concentrates, and marine snow drifts through.
    const background = svgEl("g", { class: "svg-background" });
    background.append(
      svgEl("rect", {
        x: 0,
        y: 0,
        width: m.width,
        height: m.height,
        fill: "#0e181e",
      }),
    );
    densityBins(surface === "desktop" ? 46 : 34).forEach((bin) => {
      const strength = clamp(bin.activeCount / 8, 0, 1);
      if (strength < 0.18) return;
      const x = xForBeat(bin.start),
        w = Math.max(10, xForBeat(bin.end) - x);
      background.append(
        svgEl("rect", {
          x: x - 6,
          y: m.plotTop - 14,
          width: w + 12,
          height: m.plotBottom - m.plotTop + 30,
          rx: 16,
          fill: "#17303a",
          opacity: (0.16 + strength * 0.34).toFixed(3),
          filter: `url(#${prefix}-blur)`,
        }),
      );
    });
    const snow = seeded(`${piece.sourceRevision}|nocturne-snow|${surface}`);
    for (let i = 0; i < 34; i++) {
      const sx = m.left + snow() * (m.width - m.left - m.right),
        sy = m.plotTop - 6 + snow() * (m.plotBottom - m.plotTop + 16);
      background.append(
        svgEl("circle", {
          cx: sx.toFixed(1),
          cy: sy.toFixed(1),
          r: (0.4 + snow() * 0.9).toFixed(2),
          fill: "#cfd8d4",
          opacity: (0.04 + snow() * 0.08).toFixed(3),
        }),
      );
    }
    svg.append(background);

    // Authored sections as wells: the field darkens, the entry edge sharpens,
    // the caption sits in mineral silver; crowded spans fall back to numerals.
    piece.sections.forEach((section, index) => {
      const startX = xForBeat(section.startBeat),
        endX = xForBeat(section.endBeat);
      const group = svgEl("g");
      group.append(
        svgEl("rect", {
          x: startX,
          y: m.plotTop - 10,
          width: endX - startX,
          height: m.plotBottom - m.plotTop + 22,
          fill: "#000",
          opacity: 0.18,
        }),
      );
      if (section.startBeat > 0) {
        group.append(
          svgEl("line", {
            x1: startX,
            y1: m.plotTop - 10,
            x2: startX,
            y2: m.plotBottom + 12,
            stroke: "#cfd3d6",
            "stroke-width": 0.7,
            opacity: 0.3,
            "vector-effect": "non-scaling-stroke",
          }),
        );
      }
      const crowded = endX - startX < 64;
      group.append(
        svgEl(
          "text",
          {
            x: startX + 5,
            y: m.plotTop + 2,
            class: crowded ? "svg-form-index" : "svg-form-label",
            fill: "#c9c3b2",
            opacity: 0.85,
          },
          crowded ? romanNumeral(index + 1) : section.label,
        ),
      );
      refs.sectionFrames.set(section.id, group);
      svg.append(group);
    });

    // Voices as brush traces: wet sustained strokes, dry onset flicks.
    // Played music settles — it gains ink depth instead of glowing.
    const baseLayer = svgEl("g");
    const playedLayer = svgEl("g", { "clip-path": `url(#${prefix}-heard)` });
    const nowLayer = svgEl("g", { "clip-path": `url(#${prefix}-now)` });
    const bandOpacity = { lead: 0.4, echo: 0.22, bass: 0.26 };
    const tidePhase = { lead: 0, echo: 1.7, bass: 3.1 };
    ["lead", "echo", "bass"].forEach((voiceId) => {
      const moments = groupedVoiceMoments(voiceId);
      if (!moments.length) return;
      // Traces ride a slow tidal drift: the sea moves the ink, not the music.
      const tide = (x) => Math.sin(x * 0.018 + tidePhase[voiceId]) * 2.2;
      const points = [];
      moments.forEach((moment) => {
        const x1 = xForBeat(moment.startBeat),
          x2 = xForBeat(moment.startBeat + moment.durationBeats);
        points.push({
          x: x1,
          y: yForVoiceMidi(voiceId, moment.midi) + tide(x1),
          velocity: moment.velocity,
        });
        points.push({
          x: x2,
          y:
            yForVoiceMidi(voiceId, moment.midi) +
            (voiceId === "echo" ? 1.1 : 0) +
            tide(x2),
          velocity: moment.velocity * 0.9,
        });
      });
      const outline = pressureOutline(
        points,
        (point) =>
          (voiceId === "bass" ? 1.6 : 1.05) +
          point.velocity * (voiceId === "bass" ? 3.4 : 2.6),
      );
      baseLayer.append(
        svgEl("path", {
          d: outline,
          fill: theme.voice[voiceId],
          stroke: "none",
          opacity: bandOpacity[voiceId],
          class: "svg-nocturne-trace",
        }),
      );
      playedLayer.append(
        svgEl("path", {
          d: outline,
          fill: theme.voice[voiceId],
          stroke: "none",
          opacity: Math.min(1, bandOpacity[voiceId] + 0.42).toFixed(2),
          class: "svg-nocturne-trace svg-voice-played",
        }),
      );
      nowLayer.append(
        svgEl("path", {
          d: outline,
          fill: voiceId === "bass" ? theme.companion : theme.accent,
          stroke: "none",
          opacity: 0.55,
          class: "svg-nocturne-trace svg-voice-now",
        }),
      );
      moments.forEach((moment, nodeIndex) => {
        if (voiceId !== "lead" && nodeIndex % 2) return;
        const x = xForBeat(moment.startBeat),
          y = yForVoiceMidi(voiceId, moment.midi);
        const size = 1.4 + moment.velocity * 2;
        baseLayer.append(
          svgEl("line", {
            x1: x.toFixed(2),
            y1: (y - size).toFixed(2),
            x2: (x + 0.8).toFixed(2),
            y2: (y + size).toFixed(2),
            stroke: theme.voice[voiceId],
            "stroke-width": 0.7,
            opacity: 0.4,
            class: "svg-nocturne-onset",
            "vector-effect": "non-scaling-stroke",
          }),
        );
      });
    });
    svg.append(baseLayer, playedLayer, nowLayer);

    // Pulse: free-floating cut marks, no ground line (note 03 ruling 2).
    piece.events
      .filter((event) => event.voiceId === "pulse")
      .forEach((event, index) => {
        const x = xForBeat(event.startBeat),
          y = m.plotBottom - 10 - (index % 3) * 3.5;
        svg.append(
          svgEl("line", {
            x1: x.toFixed(2),
            y1: (y - 3.4).toFixed(2),
            x2: x.toFixed(2),
            y2: (y + 3.4).toFixed(2),
            stroke: theme.voice.pulse,
            "stroke-width": 0.8,
            opacity: 0.4,
            class: "svg-nocturne-onset",
            "vector-effect": "non-scaling-stroke",
          }),
        );
      });

    // Motif signatures: mineral incisions floating clear of their trace.
    piece.motifOccurrences.forEach((occurrence) => {
      const point = motifPoint(occurrence),
        color = "#cfd3d6";
      if (Math.abs(point.traceY - point.y) > 10) {
        svg.append(
          svgEl("line", {
            x1: point.x,
            y1: point.y + 11,
            x2: point.x,
            y2: point.traceY - 6,
            stroke: color,
            "stroke-width": 0.5,
            opacity: 0.18,
            "stroke-dasharray": "1 3",
            "vector-effect": "non-scaling-stroke",
          }),
        );
      }
      const group = svgEl("g", {
        class: "svg-motif-occurrence",
        role: "button",
        tabindex: "0",
        "aria-label": copy.selectMotif(
          occurrence.motif,
          occurrence.occurrence,
          transformLabel(occurrence),
          occurrenceSectionLabel(occurrence),
        ),
        transform: `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${(occurrence.transpose * 2.5).toFixed(2)})${occurrence.inversion ? " scale(-1 1)" : ""}`,
        "data-anchor": occurrence.anchor,
      });
      group.append(
        svgEl("path", {
          d: "M 0 -11 C 4.6 -8.2 6.6 -3.2 6.6 0 C 6.6 3.2 4.6 8.2 0 11 C -4.6 8.2 -6.6 3.2 -6.6 0 C -6.6 -3.2 -4.6 -8.2 0 -11 Z",
          fill: "rgba(207,211,214,.1)",
          stroke: color,
          "stroke-width": 1.05,
          class: "svg-motif-ring",
          "vector-effect": "non-scaling-stroke",
        }),
        svgEl("path", {
          d: "M 0 -7.5 L 0 7.5 M -3.4 -2.5 L 3.4 2.5",
          stroke: color,
          "stroke-width": 0.42,
          opacity: 0.45,
          fill: "none",
          "vector-effect": "non-scaling-stroke",
        }),
      );
      installMotifInteraction(group, occurrence, refs);
      svg.append(group);
    });

    refs.playedWash = svgEl("rect", {
      x: plan.minX,
      y: m.top,
      width: 0,
      height: m.plotBottom - m.top + 18,
      fill: "#000",
      opacity: 0,
      "pointer-events": "none",
    });
    svg.insertBefore(refs.playedWash, baseLayer);
    refs.nowBand = svgEl("rect", {
      x: plan.minX - 20,
      y: m.top - 4,
      width: 40,
      height: m.plotBottom - m.top + 26,
      rx: 14,
      fill: "rgba(207,211,214,.05)",
      opacity: 0,
      filter: `url(#${prefix}-blur)`,
      "pointer-events": "none",
    });
    svg.insertBefore(refs.nowBand, baseLayer);
    instance.motifBaseFill = "rgba(207,211,214,.1)";
    instance.motifSelectedFill = "rgba(207,211,214,.32)";

    // Temporal cursor: a narrow luminous incision with a notched slip handle.
    const nocturneAxis = svgEl("g", { "pointer-events": "none" });
    nocturneAxis.append(
      svgEl("rect", {
        x: -14,
        y: m.top - 4,
        width: 28,
        height: m.plotBottom - m.top + 20,
        fill: `url(#${prefix}-shaft)`,
        filter: `url(#${prefix}-blur)`,
      }),
      svgEl("line", {
        x1: 0,
        y1: m.top - 4,
        x2: 0,
        y2: m.plotBottom + 16,
        stroke: "#e8e4d6",
        "stroke-width": 3.6,
        opacity: 0.16,
        filter: `url(#${prefix}-blur)`,
        "vector-effect": "non-scaling-stroke",
      }),
      svgEl("line", {
        x1: 0,
        y1: m.top - 4,
        x2: 0,
        y2: m.plotBottom + 16,
        stroke: "#e8e4d6",
        "stroke-width": 0.8,
        opacity: 0.9,
        "vector-effect": "non-scaling-stroke",
      }),
    );
    installPlayhead(instance, plan, {
      line: nocturneAxis,
      handle: svgEl("path", {
        d: `M -4 ${m.top - 13} L 4 ${m.top - 13} L 0 ${m.top - 6} Z`,
        fill: "#e8e4d6",
        "pointer-events": "none",
      }),
      timeY: m.top - 31,
      timeFill: "#2a2e35",
    });
    updateFigure(instance);
  }

  function herbariumPlanFor(surface) {
    const m = layoutFor(surface, "herbarium");
    const plotWidth = m.width - m.left - m.right;
    const xForBeat = (beat) =>
      m.left + (clamp(beat, 0, durationBeats) / durationBeats) * plotWidth;
    const beatForX = (x) =>
      clamp(((x - m.left) / plotWidth) * durationBeats, 0, durationBeats);
    // One pressed plant: stem above, fern branches mid, roots below.
    const voiceBand = (voiceId) => {
      const positions = { lead: 0.26, echo: 0.54, bass: 0.8 };
      return (
        m.plotTop + (m.plotBottom - m.plotTop) * (positions[voiceId] ?? 0.5)
      );
    };
    const yForVoiceMidi = (voiceId, midi) => {
      const reference = voiceId === "bass" ? 38 : voiceId === "echo" ? 72 : 67;
      return clamp(
        voiceBand(voiceId) - (midi - reference) * 1.0,
        m.plotTop + 8,
        m.plotBottom - 12,
      );
    };
    const yForMidi = (midi) => yForVoiceMidi("lead", midi);
    // Sprig signatures hover 30 px above their fibre (floating-mark law),
    // tethered by a dotted collector's thread when separation could confuse.
    const motifPoint = (occurrence) => ({
      x: xForBeat(occurrence.startBeat + occurrence.durationBeats / 2),
      y: yForVoiceMidi(occurrence.voiceId, occurrence.registerMidi) - 30,
      stemY: yForVoiceMidi(occurrence.voiceId, occurrence.registerMidi),
    });
    return {
      m,
      xForBeat,
      beatForX,
      yForMidi,
      yForVoiceMidi,
      voiceBand,
      motifPoint,
      minX: m.left,
      maxX: m.width - m.right,
    };
  }

  function renderHerbariumFigure(instance) {
    const { theme, surface, svg, refs } = instance;
    const plan = herbariumPlanFor(surface);
    const { m, xForBeat, yForVoiceMidi, voiceBand, motifPoint } = plan;
    const desktop = surface === "desktop";
    const prefix = prepareFigure(instance, plan);
    const defs = addSharedFigureDefs(instance, prefix, theme, plan);

    // The sheet: warm paper, a hairline mount, a small plate index.
    const background = svgEl("g", { class: "svg-background" });
    background.append(
      svgEl("rect", {
        x: 0,
        y: 0,
        width: m.width,
        height: m.height,
        fill: "#f4efe3",
      }),
    );
    background.append(
      svgEl("rect", {
        x: m.left - 13,
        y: m.plotTop - 16,
        width: m.width - m.left - m.right + 26,
        height: m.plotBottom - m.plotTop + 42,
        fill: "none",
        stroke: "#4a503a",
        "stroke-width": 0.8,
        opacity: 0.35,
        "vector-effect": "non-scaling-stroke",
      }),
    );
    background.append(
      svgEl(
        "text",
        {
          x: m.width - m.right + 6,
          y: m.plotTop - 22,
          class: "svg-form-index",
          fill: "#77745f",
          opacity: 0.9,
          "text-anchor": "end",
        },
        "Pl. I",
      ),
    );
    // Density buds: pressed flower buds gather where the music concentrates.
    const budRand = seeded(`${piece.sourceRevision}|herbarium-buds|${surface}`);
    densityBins(desktop ? 40 : 30).forEach((bin) => {
      const strength = clamp(bin.activeCount / 8, 0, 1);
      if (strength < 0.3) return;
      const x = xForBeat((bin.start + bin.end) / 2);
      const y =
        voiceBand("lead") + (budRand() > 0.5 ? -1 : 1) * (26 + budRand() * 14);
      const size = 2.2 + strength * 2.6;
      background.append(
        svgEl("path", {
          d: `M 0 ${(-size).toFixed(2)} C ${(size * 0.8).toFixed(2)} ${(-size * 0.3).toFixed(2)} ${(size * 0.55).toFixed(2)} ${(size * 0.7).toFixed(2)} 0 ${size.toFixed(2)} C ${(-size * 0.55).toFixed(2)} ${(size * 0.7).toFixed(2)} ${(-size * 0.8).toFixed(2)} ${(-size * 0.3).toFixed(2)} 0 ${(-size).toFixed(2)} Z`,
          transform: `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(budRand() * 36 - 18).toFixed(1)})`,
          fill: theme.companion,
          opacity: (0.1 + strength * 0.16).toFixed(3),
        }),
      );
    });
    svg.append(background);

    // Authored sections as growth stages: a hairline at each boundary and a
    // small collector label ticket pressed along the lower mount edge.
    piece.sections.forEach((section, index) => {
      const startX = xForBeat(section.startBeat),
        endX = xForBeat(section.endBeat);
      const group = svgEl("g");
      if (section.startBeat > 0) {
        group.append(
          svgEl("line", {
            x1: startX,
            y1: m.plotTop - 14,
            x2: startX,
            y2: m.plotBottom + 14,
            stroke: "#4a503a",
            "stroke-width": 0.7,
            opacity: 0.55,
            "vector-effect": "non-scaling-stroke",
          }),
        );
      }
      const crowded = endX - startX < 64;
      const labelX = startX + 6,
        labelY = m.plotBottom + 22;
      const ticket = svgEl("g");
      ticket.append(
        svgEl("rect", {
          x: labelX - 4,
          y: labelY - 9,
          width: crowded ? 16 : section.label.length * 11 + 12,
          height: 15,
          rx: 1.5,
          fill: "#fbf8ef",
          stroke: "#4a503a",
          "stroke-width": 0.6,
          opacity: 0.95,
        }),
      );
      ticket.append(
        svgEl(
          "text",
          {
            x: labelX + (crowded ? 4 : section.label.length * 5.5 + 2),
            y: labelY + 2,
            class: "svg-form-index",
            fill: "#4a503a",
            "text-anchor": "middle",
          },
          crowded ? romanNumeral(index + 1) : section.label,
        ),
      );
      group.append(ticket);
      refs.sectionFrames.set(section.id, group);
      svg.append(group);
    });

    // Voices as pressed fibres. Played music is pressed flatter and darker —
    // an herbarium sheet gains patina, never glow.
    const baseLayer = svgEl("g");
    const playedLayer = svgEl("g", { "clip-path": `url(#${prefix}-heard)` });
    const nowLayer = svgEl("g", { "clip-path": `url(#${prefix}-now)` });
    const fibreOpacity = { lead: 0.72, echo: 0.58, bass: 0.45 };
    ["lead", "echo", "bass"].forEach((voiceId) => {
      const moments = groupedVoiceMoments(voiceId);
      if (!moments.length) return;
      const points = [];
      moments.forEach((moment) => {
        const x1 = xForBeat(moment.startBeat),
          x2 = xForBeat(moment.startBeat + moment.durationBeats);
        points.push({
          x: x1,
          y: yForVoiceMidi(voiceId, moment.midi),
          velocity: moment.velocity,
        });
        points.push({
          x: x2,
          y: yForVoiceMidi(voiceId, moment.midi) + (voiceId === "echo" ? 1 : 0),
          velocity: moment.velocity * 0.9,
        });
      });
      const outline = pressureOutline(
        points,
        (point) =>
          (voiceId === "bass" ? 1.6 : 1.15) +
          point.velocity * (voiceId === "bass" ? 3.2 : 2.4),
      );
      baseLayer.append(
        svgEl("path", {
          d: outline,
          fill: theme.voice[voiceId],
          stroke: "none",
          opacity: fibreOpacity[voiceId],
        }),
      );
      playedLayer.append(
        svgEl("path", {
          d: outline,
          fill: theme.voice[voiceId],
          stroke: "none",
          opacity: Math.min(1, fibreOpacity[voiceId] + 0.28).toFixed(2),
          class: "svg-voice-played",
        }),
      );
      nowLayer.append(
        svgEl("path", {
          d: outline,
          fill: voiceId === "bass" ? theme.companion : theme.accent,
          stroke: "none",
          opacity: 0.55,
          class: "svg-voice-now",
        }),
      );
      if (voiceId === "lead") {
        // Pressed leaves alternate off the stem — the plant's main body.
        moments.forEach((moment, i) => {
          if (i % 3) return;
          const x = xForBeat(moment.startBeat + moment.durationBeats / 2),
            y = yForVoiceMidi("lead", moment.midi);
          const side = i % 2 ? 1 : -1,
            lx = x + 5.5,
            ly = y + side * 6.5;
          baseLayer.append(
            svgEl("line", {
              x1: x.toFixed(2),
              y1: y.toFixed(2),
              x2: lx.toFixed(2),
              y2: ly.toFixed(2),
              stroke: theme.voice.lead,
              "stroke-width": 0.6,
              opacity: 0.45,
              "vector-effect": "non-scaling-stroke",
            }),
          );
          baseLayer.append(
            svgEl("ellipse", {
              cx: lx.toFixed(2),
              cy: ly.toFixed(2),
              rx: 4.8,
              ry: 2,
              transform: `rotate(${side * 32} ${lx.toFixed(2)} ${ly.toFixed(2)})`,
              fill: theme.voice.lead,
              opacity: 0.34,
            }),
          );
        });
      }
      if (voiceId === "echo") {
        // The fern is a branch of the plant, not a parallel band: each new
        // echo phrase grows a curved branch out of the lead stem, then
        // leaflets vein off the branch fibre itself.
        let prevEnd = -Infinity;
        moments.forEach((moment, i) => {
          const gap = moment.startBeat - prevEnd;
          prevEnd = moment.startBeat + moment.durationBeats;
          if (i === 0 || gap > 1) {
            const xE = xForBeat(moment.startBeat),
              yE = yForVoiceMidi("echo", moment.midi);
            const xS = Math.max(m.left + 2, xE - (7 + (i % 3) * 4)),
              yS = voiceBand("lead");
            baseLayer.append(
              svgEl("path", {
                d: `M ${xS.toFixed(2)} ${yS.toFixed(2)} Q ${((xS + xE) / 2 + 7).toFixed(2)} ${((yS + yE) / 2).toFixed(2)} ${xE.toFixed(2)} ${yE.toFixed(2)}`,
                fill: "none",
                stroke: theme.voice.echo,
                "stroke-width": 0.85,
                opacity: 0.55,
                "vector-effect": "non-scaling-stroke",
              }),
            );
          }
          if (i % 2) return;
          const x = xForBeat(moment.startBeat + moment.durationBeats / 2),
            y = yForVoiceMidi("echo", moment.midi);
          const up = i % 4 ? -1 : 1;
          baseLayer.append(
            svgEl("line", {
              x1: x.toFixed(2),
              y1: y.toFixed(2),
              x2: (x + 5).toFixed(2),
              y2: (y + up * 7).toFixed(2),
              stroke: theme.voice.echo,
              "stroke-width": 0.7,
              opacity: 0.5,
              "vector-effect": "non-scaling-stroke",
            }),
          );
        });
      }
      if (voiceId === "bass") {
        const rootRand = seeded(
          `${piece.sourceRevision}|herbarium-roots|${surface}`,
        );
        // Roots are spaced by beats, not by index: at long-air scale the
        // bass fibre has 4× the moments, and a root per two moments would
        // read as a grass lawn instead of a root system.
        let lastRootBeat = -Infinity;
        moments.forEach((moment, i) => {
          if (moment.startBeat - lastRootBeat < 16) return;
          lastRootBeat = moment.startBeat;
          const x = xForBeat(moment.startBeat),
            y = yForVoiceMidi("bass", moment.midi);
          if (desktop) {
            // Roots keep growing downward from the bass fibre, with a
            // secondary rootlet forking off midway.
            const depth = Math.min(18 + rootRand() * 22, m.plotBottom + 24 - y),
              sway = rootRand() * 9 - 4.5;
            baseLayer.append(
              svgEl("path", {
                d: `M ${x.toFixed(2)} ${y.toFixed(2)} C ${(x + sway).toFixed(2)} ${(y + depth * 0.45).toFixed(2)} ${(x - sway).toFixed(2)} ${(y + depth * 0.7).toFixed(2)} ${(x + sway * 0.5).toFixed(2)} ${(y + depth).toFixed(2)}`,
                fill: "none",
                stroke: theme.voice.bass,
                "stroke-width": 0.8,
                opacity: 0.55,
                "vector-effect": "non-scaling-stroke",
              }),
            );
            if (depth > 16) {
              const fy = y + depth * 0.5,
                fx = x + sway * 0.3,
                side = rootRand() > 0.5 ? 1 : -1;
              baseLayer.append(
                svgEl("path", {
                  d: `M ${fx.toFixed(2)} ${fy.toFixed(2)} Q ${(fx + side * 5).toFixed(2)} ${(fy + depth * 0.18).toFixed(2)} ${(fx + side * (6 + rootRand() * 5)).toFixed(2)} ${(fy + depth * 0.34).toFixed(2)}`,
                  fill: "none",
                  stroke: theme.voice.bass,
                  "stroke-width": 0.55,
                  opacity: 0.42,
                  "vector-effect": "non-scaling-stroke",
                }),
              );
            }
          } else {
            // Compressed surfaces get node ticks instead of a root system
            // (note 03 addendum, ruling 6).
            baseLayer.append(
              svgEl("line", {
                x1: x.toFixed(2),
                y1: (y - 3).toFixed(2),
                x2: x.toFixed(2),
                y2: (y + 3).toFixed(2),
                stroke: theme.voice.bass,
                "stroke-width": 0.8,
                opacity: 0.4,
                "vector-effect": "non-scaling-stroke",
              }),
            );
          }
        });
      }
    });
    svg.append(baseLayer, playedLayer, nowLayer);

    // Pulse: node dots riding the stem, like buds waiting to bloom.
    piece.events
      .filter((event) => event.voiceId === "pulse")
      .forEach((event, index) => {
        const x = xForBeat(event.startBeat),
          y = voiceBand("lead") + (index % 2 ? 5.5 : -5.5);
        svg.append(
          svgEl("circle", {
            cx: x.toFixed(2),
            cy: y.toFixed(2),
            r: 1.5,
            fill: theme.voice.pulse,
            opacity: 0.5,
          }),
        );
      });

    // Motif signatures: sprig cuttings pressed above their fibre. The sprig
    // curl is drawn from the transformed atoms themselves, so each family
    // and each transform presses a different silhouette.
    piece.motifOccurrences.forEach((occurrence) => {
      const point = motifPoint(occurrence),
        color = theme.companion;
      if (Math.abs(point.stemY - point.y) > 10) {
        svg.append(
          svgEl("line", {
            x1: point.x,
            y1: point.y + 9,
            x2: point.x,
            y2: point.stemY - 5,
            stroke: theme.accent,
            "stroke-width": 0.5,
            opacity: 0.25,
            "stroke-dasharray": "1 3",
            "vector-effect": "non-scaling-stroke",
          }),
        );
      }
      const group = svgEl("g", {
        class: "svg-motif-occurrence",
        role: "button",
        tabindex: "0",
        "aria-label": copy.selectMotif(
          occurrence.motif,
          occurrence.occurrence,
          transformLabel(occurrence),
          occurrenceSectionLabel(occurrence),
        ),
        transform: `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${(occurrence.transpose * 2).toFixed(2)})`,
        "data-anchor": occurrence.anchor,
      });
      group.append(
        svgEl("ellipse", {
          cx: 0,
          cy: 0,
          rx: 12.5,
          ry: 9.5,
          fill: instance.motifBaseFill ?? "rgba(163,104,95,.12)",
          stroke: color,
          "stroke-width": 0.9,
          class: "svg-motif-ring",
          "vector-effect": "non-scaling-stroke",
        }),
        svgEl("path", {
          d: motifGlyphPath(
            piece.motifDefinitions[occurrence.motif],
            occurrence,
            14,
            10,
          ),
          stroke: theme.accent,
          "stroke-width": 1.1,
          transform: "translate(-7 -5)",
          class: "svg-motif-glyph",
          "vector-effect": "non-scaling-stroke",
        }),
        svgEl("circle", {
          cx: -4,
          cy: -2.5,
          r: 1.2,
          fill: color,
          opacity: 0.8,
        }),
        svgEl("circle", { cx: 4.5, cy: 2, r: 1, fill: color, opacity: 0.6 }),
      );
      installMotifInteraction(group, occurrence, refs);
      svg.append(group);
    });

    refs.playedWash = svgEl("rect", {
      x: plan.minX,
      y: m.top,
      width: 0,
      height: m.plotBottom - m.top + 18,
      fill: "#6a7a58",
      opacity: 0,
      "pointer-events": "none",
    });
    svg.insertBefore(refs.playedWash, baseLayer);
    refs.nowBand = svgEl("rect", {
      x: plan.minX - 20,
      y: m.top - 4,
      width: 40,
      height: m.plotBottom - m.top + 26,
      rx: 14,
      fill: "rgba(106,122,88,.07)",
      opacity: 0,
      filter: `url(#${prefix}-blur)`,
      "pointer-events": "none",
    });
    svg.insertBefore(refs.nowBand, baseLayer);
    instance.motifBaseFill = "rgba(163,104,95,.12)";
    instance.motifSelectedFill = "rgba(163,104,95,.4)";

    // Temporal cursor: a specimen pin — a fine dark rule with a round
    // rose pin head, and a time tag tied beneath it.
    const pin = svgEl("g", { "pointer-events": "none" });
    pin.append(
      svgEl("line", {
        x1: 0,
        y1: m.top - 6,
        x2: 0,
        y2: m.plotBottom + 16,
        stroke: "#3a4433",
        "stroke-width": 0.9,
        opacity: 0.85,
        "vector-effect": "non-scaling-stroke",
      }),
    );
    installPlayhead(instance, plan, {
      line: pin,
      handle: svgEl("circle", {
        cx: 0,
        cy: m.top - 11,
        r: 3.4,
        fill: "#a3685f",
        stroke: "#f7f3e8",
        "stroke-width": 1.2,
        "pointer-events": "none",
      }),
      timeY: m.top - 31,
      timeFill: "#3a4433",
    });
    updateFigure(instance);
  }

  function buildLanguageSwitch() {
    const button = htmlEl("button", "refrain-language");
    button.type = "button";
    button.setAttribute("aria-label", copy.language);
    button.innerHTML = `<span lang="en" data-active="${input.locale === "en"}">EN</span><span aria-hidden="true"> / </span><span lang="zh-CN" data-active="${input.locale === "zh-CN"}">中文</span>`;
    button.addEventListener("click", () =>
      callbacks.onLocaleChange(input.locale === "en" ? "zh-CN" : "en"),
    );
    return button;
  }

  function buildThemeSwitch(theme) {
    const select = document.createElement("select");
    select.className = "refrain-theme";
    select.setAttribute("aria-label", copy.appearance);
    Object.values(themes).forEach((choice) => {
      const option = document.createElement("option");
      option.value = choice.id;
      option.textContent = choice.label;
      select.append(option);
    });
    select.value = theme.id;
    select.addEventListener("change", () =>
      callbacks.onThemeChange(select.value),
    );
    return select;
  }

  function buildMCP(theme) {
    const root = htmlEl(
      "article",
      `refrain-surface ${theme.className} mcp-piece`,
    );
    configureThemeRoot(root, theme);
    root.setAttribute(
      "aria-label",
      `${piece.title}, ${theme.label} MCP Canvas`,
    );
    const header = htmlEl(
      "header",
      `mcp-header${theme.id === "paper-sonata" ? " paper-mcp-header" : ""}`,
    );
    if (theme.id === "paper-sonata") {
      const index = htmlEl("div", "paper-folio-index", "R");
      index.append(htmlEl("span", "", "folio"));
      const content = htmlEl("div");
      const mark = htmlEl("p", "product-mark");
      mark.innerHTML = "Refrain <span>hums an air.</span>";
      content.append(
        mark,
        htmlEl("h2", "piece-title", piece.title),
        htmlEl("p", "piece-caption", piece.caption),
      );
      header.append(index, content);
    } else {
      const mark = htmlEl("p", "product-mark");
      mark.innerHTML = "Refrain <span>hums an air.</span>";
      header.append(
        mark,
        htmlEl("h2", "piece-title", piece.title),
        htmlEl("p", "piece-caption", piece.caption),
      );
    }
    const figure = buildFigure(theme, "mcp");
    const transport = buildTransport(theme, "mcp");
    const details = buildDetails(theme);
    const languageBar = htmlEl("div", "mcp-language-bar");
    languageBar.append(buildThemeSwitch(theme), buildLanguageSwitch());
    root.append(languageBar, header, figure.shell, transport, details);
    presentations.push({
      root,
      theme,
      surface: "mcp",
      figure: figure.instance,
    });
    return root;
  }

  function buildPageTopbar(theme) {
    const bar = htmlEl("div", "air-page-topbar");
    bar.append(htmlEl("div", "air-page-brand", "Refrain"));
    const controls = htmlEl("div", "air-page-controls");
    controls.append(buildThemeSwitch(theme), buildLanguageSwitch());
    bar.append(controls);
    return bar;
  }

  function buildPageHero(theme) {
    const hero = htmlEl("header", "page-hero");
    if (theme.id === "paper-sonata")
      hero.append(htmlEl("p", "product-mark", copy.manuscript));
    if (theme.id === "herbarium")
      hero.append(htmlEl("p", "product-mark", copy.pressedSheet));
    const returnVoices = new Set(
      piece.motifOccurrences.map((item) => item.voiceId),
    ).size;
    const motifFamilies = new Set(
      piece.motifOccurrences.map((item) => item.motif),
    ).size;
    hero.append(
      htmlEl("h2", "piece-title", piece.title),
      htmlEl("p", "piece-caption", piece.caption),
      htmlEl(
        "p",
        "lineage-note",
        piece.motifOccurrences.length
          ? motifFamilies > 1
            ? `${copy.families(motifFamilies)} · ${copy.appearances(piece.motifOccurrences.length)} · ${copy.acrossVoices(returnVoices)}`
            : `@${piece.motifOccurrences[0]?.motif ?? "motif"} · ${copy.appearances(piece.motifOccurrences.length)} · ${copy.acrossVoices(returnVoices)}`
          : copy.noMotifDefined,
      ),
    );
    return hero;
  }

  function buildSectionJumps() {
    const nav = htmlEl(
      "nav",
      `section-jumps${piece.sections.length ? "" : " empty"}`,
    );
    nav.setAttribute("aria-label", copy.jumps);
    piece.sections.forEach((section, index) => {
      const span = section.endBeat - section.startBeat;
      const button = htmlEl("button", "", section.label);
      button.type = "button";
      button.dataset.section = section.id;
      button.style.setProperty("--span", String(span));
      button.title = `${section.label} · ${copy.beats(section.startBeat, section.endBeat)}`;
      button.setAttribute(
        "aria-label",
        copy.jump(section.label, section.startBeat),
      );
      button.addEventListener("click", () => seekTo(section.startBeat));
      nav.append(button);
    });
    return nav;
  }

  function buildPassagePanel() {
    const panel = htmlEl("section", "page-panel passage-panel");
    const heading = htmlEl("h3", "", copy.passage);
    const text = htmlEl("p", "passage-copy");
    const facts = htmlEl("div", "passage-facts");
    panel.append(heading, text, facts);
    return { root: panel, heading, text, facts };
  }

  function buildMotifPanel(theme) {
    if (!piece.motifOccurrences.length) return null;
    const panel = htmlEl("section", "page-panel motif-panel");
    panel.dataset.density =
      piece.motifOccurrences.length > 12 ? "high" : "normal";
    const motifFamilies = new Set(
      piece.motifOccurrences.map((item) => item.motif),
    ).size;
    panel.append(
      htmlEl(
        "h3",
        "",
        motifFamilies > 1
          ? `${copy.families(motifFamilies)} · ${copy.appearances(piece.motifOccurrences.length)}`
          : `@${piece.motifOccurrences[0]?.motif ?? "motif"} · ${copy.appearances(piece.motifOccurrences.length)}`,
      ),
      htmlEl("p", "", copy.motifCopy),
    );
    const transit = htmlEl("div", "motif-transit");
    const ticks = [];
    piece.motifOccurrences.forEach((occurrence) => {
      const tick = htmlEl("button");
      tick.type = "button";
      tick.dataset.anchor = occurrence.anchor;
      tick.style.left =
        (
          ((occurrence.startBeat + occurrence.durationBeats / 2) /
            durationBeats) *
          100
        ).toFixed(2) + "%";
      tick.style.setProperty("--gem", theme.voice[occurrence.voiceId]);
      tick.title = `@${occurrence.motif} · ${occurrenceSectionLabel(occurrence)} · ${transformLabel(occurrence)}`;
      tick.setAttribute(
        "aria-label",
        copy.selectMotif(
          occurrence.motif,
          occurrence.occurrence,
          transformLabel(occurrence),
          occurrenceSectionLabel(occurrence),
        ),
      );
      tick.append(htmlEl("i"));
      tick.addEventListener("click", () => selectOccurrence(occurrence.anchor));
      transit.append(tick);
      ticks.push(tick);
    });
    const list = htmlEl("div", "motif-list");
    const rows = [];
    piece.motifOccurrences.forEach((occurrence) => {
      const row = htmlEl("div", "motif-row");
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.dataset.anchor = occurrence.anchor;
      row.title = `@${occurrence.motif} · ${occurrenceSectionLabel(occurrence)} · ${transformLabel(occurrence)}`;
      const gem = htmlEl("i", "motif-gem");
      gem.style.setProperty("--gem", theme.voice[occurrence.voiceId]);
      const content = htmlEl("div");
      content.innerHTML = `<strong>@${occurrence.motif}</strong><span>${occurrenceSectionLabel(occurrence)} · ${transformLabel(occurrence)}</span>`;
      const time = htmlEl("em");
      time.innerHTML = `<b>#${occurrence.occurrence}</b>${formatTime(occurrence.startBeat * beatSeconds)}`;
      row.append(gem, content, time);
      row.addEventListener("click", () => selectOccurrence(occurrence.anchor));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectOccurrence(occurrence.anchor);
        }
      });
      list.append(row);
      rows.push(row);
    });
    panel.append(transit, list);
    return { root: panel, rows, ticks };
  }

  function buildAirPage(theme, surface) {
    const mobile = surface === "mobile";
    const root = htmlEl(
      "article",
      `refrain-surface ${theme.className} air-page ${mobile ? "air-page--mobile" : "air-page--desktop"}`,
    );
    configureThemeRoot(root, theme);
    root.setAttribute(
      "aria-label",
      `${piece.title}, ${theme.label} Air Page ${mobile ? "mobile" : "desktop"}`,
    );
    const topbar = buildPageTopbar(theme);
    const hero = buildPageHero(theme);
    const figure = buildFigure(theme, surface);
    const transport = buildTransport(theme, surface);
    const jumps = buildSectionJumps();
    const lower = htmlEl("div", "page-lower");
    const passage = buildPassagePanel();
    const motif = buildMotifPanel(theme);
    lower.append(passage.root);
    if (motif) lower.append(motif.root);
    else lower.classList.add("single");
    const details = buildDetails(theme);
    root.append(topbar, transport);
    if (theme.id === "paper-sonata") {
      const spread = htmlEl("div", "paper-page-spread");
      const editorial = htmlEl("div", "paper-editorial");
      editorial.append(hero);
      const stage = htmlEl("div", "paper-stage");
      stage.append(figure.shell);
      spread.append(editorial, stage);
      root.append(spread, jumps, lower, details);
    } else {
      root.append(hero, figure.shell, jumps, lower, details);
    }
    presentations.push({
      root,
      theme,
      surface,
      figure: figure.instance,
      passage,
      motif,
      jumps,
    });
    return root;
  }

  function updateFigure(instance) {
    const { refs, xForBeat, m } = instance;
    if (!refs.playheadGroup) return;
    const x = xForBeat(state.positionBeat);
    const heardWidth = clamp(
      x - (instance.m?.left ?? 0),
      0,
      (instance.m?.width ?? 0) -
        (instance.m?.left ?? 0) -
        (instance.m?.right ?? 0),
    );
    refs.heardClipRect?.setAttribute("width", String(heardWidth));
    refs.playedWash?.setAttribute("width", String(heardWidth));
    refs.nowClipRect?.setAttribute("x", String(x - 20));
    refs.nowClipRect?.setAttribute(
      "width",
      state.playing || state.dragging ? "40" : "0",
    );
    refs.nowBand?.setAttribute(
      "x",
      String(x - (instance.theme.id === "paper-sonata" ? 4 : 26)),
    );
    refs.nowBand?.setAttribute(
      "opacity",
      state.playing || state.dragging ? "1" : "0",
    );
    refs.playheadGroup.setAttribute(
      "transform",
      `translate(${x.toFixed(2)} 0)`,
    );
    refs.playheadGroup.setAttribute(
      "aria-valuenow",
      state.positionBeat.toFixed(2),
    );
    refs.playheadGroup.setAttribute(
      "aria-valuetext",
      copy.timeOf(
        formatTime(state.positionBeat * beatSeconds),
        formatTime(durationSeconds),
      ),
    );
    refs.timeText.textContent = formatTime(state.positionBeat * beatSeconds);
    const now = currentOccurrence();
    const selected = piece.motifOccurrences.find(
      (item) => item.anchor === state.selectedAnchor,
    );
    refs.motifs.forEach((group, anchor) => {
      const occurrence = piece.motifOccurrences.find(
        (item) => item.anchor === anchor,
      );
      const isCurrent = now?.anchor === anchor;
      const isSelected = state.selectedAnchor === anchor;
      group.classList.toggle("current", isCurrent);
      group.classList.toggle("selected", isSelected);
      group.classList.toggle(
        "related",
        Boolean(
          selected &&
          occurrence?.motif === selected.motif &&
          anchor !== state.selectedAnchor,
        ),
      );
      const isInteractive = motifFigureAnchorIsInteractive({
        dense: piece.motifOccurrences.length > SELEN_V21_DENSE_MOTIF_THRESHOLD,
        landmark: group.dataset.landmark !== "false",
        current: isCurrent,
        selected: isSelected,
      });
      group.setAttribute("tabindex", isInteractive ? "0" : "-1");
      if (isInteractive) group.removeAttribute("aria-hidden");
      else group.setAttribute("aria-hidden", "true");
      const ring = group.querySelector(".svg-motif-ring");
      if (ring)
        ring.setAttribute(
          "fill",
          isSelected ? instance.motifSelectedFill : instance.motifBaseFill,
        );
    });
    const activeSection = currentSection();
    refs.sectionFrames?.forEach((shape, id) => {
      const current = Boolean(activeSection && id === activeSection.id);
      shape.setAttribute(
        "opacity",
        current ? "1" : instance.theme.id === "paper-sonata" ? ".72" : ".58",
      );
    });
    updateSelectionStrip(instance.selection);
  }

  function updateSelectionStrip(selection) {
    const occurrence = piece.motifOccurrences.find(
      (item) => item.anchor === state.selectedAnchor,
    );
    if (!occurrence) {
      selection.root.dataset.visible = "false";
      return;
    }
    selection.title.textContent = `@${occurrence.motif} · ${copy.occurrence(occurrence.occurrence)}`;
    selection.meta.textContent = `${occurrenceSectionLabel(occurrence)} · ${piece.voices.find((v) => v.id === occurrence.voiceId)?.label ?? occurrence.voiceId} · ${transformLabel(occurrence)} · ${copy.beats(occurrence.startBeat, occurrence.startBeat + occurrence.durationBeats)}`;
    selection.root.dataset.visible = "true";
  }

  function updateTransport(transport) {
    const preparing = !state.playing && state.preparation;
    transport.play.setAttribute(
      "aria-label",
      preparing
        ? copy.player.preparing
        : state.playing
          ? copy.pause
          : copy.play,
    );
    transport.play.toggleAttribute("data-busy", Boolean(preparing));
    transport.play.innerHTML = state.playing
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5.5" width="3.5" height="13" rx="1" fill="currentColor"/><rect x="13.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" fill="currentColor"/></svg>';
    transport.current.textContent = formatTime(
      state.positionBeat * beatSeconds,
    );
    transport.total.textContent = formatTime(durationSeconds);
    transport.sectionNow.textContent = preparing
      ? copy.preparingProgress(
          state.preparation.completedAssets,
          state.preparation.totalAssets,
          (state.preparation.completedBytes / 1048576).toFixed(0),
        )
      : (currentSection()?.label ?? copy.continuous);
    transport.seek.value = String(state.positionBeat);
    transport.seek.style.setProperty(
      "--progress",
      `${(state.positionBeat / durationBeats) * 100}%`,
    );
  }

  function updatePresentation(presentation) {
    const activeSection = currentSection();
    if (presentation.jumps)
      presentation.jumps.querySelectorAll("button").forEach((button) => {
        const current = Boolean(
          activeSection && button.dataset.section === activeSection.id,
        );
        button.dataset.current = String(current);
        if (current) button.setAttribute("aria-current", "true");
        else button.removeAttribute("aria-current");
      });
    if (presentation.passage) {
      const passage = currentPassageWindow();
      presentation.passage.heading.textContent = passage.authored
        ? `${copy.now} · ${passage.label}`
        : copy.now;
      const activeVoices = piece.voices.filter((voice) =>
        piece.events.some(
          (event) =>
            event.voiceId === voice.id &&
            event.startBeat < passage.endBeat &&
            event.startBeat + event.soundingDurationBeats > passage.startBeat,
        ),
      );
      const occurrence = piece.motifOccurrences.find(
        (item) =>
          item.startBeat >= passage.startBeat &&
          item.startBeat < passage.endBeat,
      );
      presentation.passage.text.textContent = `${copy.activeVoices(activeVoices.length)} ${
        occurrence
          ? copy.passageMotif(
              occurrence.motif,
              transformLabel(occurrence),
              piece.voices.find((v) => v.id === occurrence.voiceId)?.label ??
                occurrence.voiceId,
            )
          : ""
      }`;
      presentation.passage.facts.textContent = `${copy.beats(passage.startBeat, passage.endBeat)} · ${occurrence ? `@${occurrence.motif} · ${copy.occurrence(occurrence.occurrence)}` : copy.noMotif}`;
    }
    if (presentation.motif) {
      presentation.motif.rows.forEach(
        (row) =>
          (row.dataset.selected = String(
            row.dataset.anchor === state.selectedAnchor,
          )),
      );
      if (presentation.motif.ticks)
        presentation.motif.ticks.forEach(
          (tick) =>
            (tick.dataset.selected = String(
              tick.dataset.anchor === state.selectedAnchor,
            )),
        );
    }
  }

  function updateAll() {
    figures.forEach(updateFigure);
    transports.forEach(updateTransport);
    presentations.forEach(updatePresentation);
  }

  const product =
    input.surface === "mcp"
      ? buildMCP(theme)
      : buildAirPage(theme, input.surface);
  const highMotifDensity =
    piece.motifOccurrences.length > SELEN_V21_DENSE_MOTIF_THRESHOLD;
  product.dataset.motifDensity = highMotifDensity ? "high" : "normal";
  if (highMotifDensity) {
    const landmarks = motifLandmarkAnchors(piece);
    product
      .querySelectorAll(".air-figure .svg-motif-occurrence[data-anchor]")
      .forEach((group) => {
        group.dataset.landmark = String(landmarks.has(group.dataset.anchor));
      });
  }
  const detailsBody = product.querySelector(".details-body");
  if (detailsBody && input.selectionOptions.length) {
    const exactSelection = htmlEl("div", "exact-selection");
    const label = htmlEl("label");
    label.append(htmlEl("span", "", copy.exactSelection));
    const select = document.createElement("select");
    select.setAttribute("aria-label", copy.exactSelection);
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = copy.chooseSelection;
    select.append(placeholder);
    input.selectionOptions.forEach((option, index) => {
      const element = document.createElement("option");
      element.value = String(index);
      element.textContent = `${copy[option.kind]} · ${option.label}`;
      select.append(element);
    });
    label.append(select);
    const actions = htmlEl("div", "exact-selection__actions");
    const actionButtons = [
      ["copy", copy.copyRequest],
      ["download", copy.exportSelection],
      ...(input.canReturnSelection ? [["return", copy.send]] : []),
    ];
    actionButtons.forEach(([action, text]) => {
      const button = htmlEl("button", "", text);
      button.type = "button";
      button.disabled = true;
      button.addEventListener("click", async () => {
        const option =
          select.value === ""
            ? undefined
            : input.selectionOptions[Number(select.value)];
        if (!option) return;
        await callbacks.onExactSelectionAction?.(
          option.kind,
          option.anchor,
          action,
        );
      });
      actions.append(button);
    });
    select.addEventListener("change", () => {
      const option =
        select.value === ""
          ? undefined
          : input.selectionOptions[Number(select.value)];
      actions.querySelectorAll("button").forEach((button) => {
        button.disabled = !option;
      });
      callbacks.onSelectionChange(
        option?.kind === "motif" ? option.anchor : undefined,
      );
    });
    exactSelection.append(label, actions);
    detailsBody.append(exactSelection);
  }
  if (callbacks.onExportArtifact) {
    const save = htmlEl("div", "artifact-save");
    const artifactButton = htmlEl("button", "", copy.exportArtifact);
    artifactButton.type = "button";
    artifactButton.addEventListener("click", () =>
      callbacks.onExportArtifact?.(),
    );
    save.append(artifactButton);
    product.querySelector(".product-details")?.before(save);
  }
  if (detailsBody && callbacks.onExportSource) {
    const actions = htmlEl("div", "artifact-actions");
    if (callbacks.onExportSource) {
      const sourceButton = htmlEl("button", "", copy.exportSource);
      sourceButton.type = "button";
      sourceButton.addEventListener("click", () =>
        callbacks.onExportSource?.(),
      );
      actions.append(sourceButton);
    }
    detailsBody.append(actions);
  }
  product.lang = input.locale;
  root.replaceChildren(product);
  updateAll();

  return {
    update(nextState) {
      state.playing = nextState.playing;
      state.positionBeat = clamp(nextState.positionBeat, 0, durationBeats);
      state.selectedAnchor = nextState.selectedAnchor ?? null;
      state.preparation = nextState.preparation ?? null;
      updateAll();
    },
    destroy() {
      root.replaceChildren();
    },
  };
}
