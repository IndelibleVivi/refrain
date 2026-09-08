import type { SelenV21Piece } from "./selen-v21-model.js";

export const SELEN_V21_DENSE_MOTIF_THRESHOLD = 12;

export function motifFigureAnchorIsInteractive(input: {
  dense: boolean;
  landmark: boolean;
  current: boolean;
  selected: boolean;
}): boolean {
  return !input.dense || input.landmark || input.current || input.selected;
}

function sectionAtBeat(piece: SelenV21Piece, beat: number) {
  return piece.sections.find(
    (section) => beat >= section.startBeat && beat < section.endBeat,
  );
}

/**
 * Keeps one exact occurrence per motif family and authored section. Sources
 * without sections use four equal time windows. The omitted occurrences stay
 * available to selection and are only suppressed in the whole-form figure.
 */
export function motifLandmarkAnchors(piece: SelenV21Piece): Set<string> {
  const anchors = new Set<string>();
  const clusters = new Set<string>();

  for (const occurrence of piece.motifOccurrences) {
    const section = sectionAtBeat(piece, occurrence.startBeat);
    const timeWindow = Math.min(
      3,
      Math.floor((occurrence.startBeat / piece.durationBeats) * 4),
    );
    const cluster = `${occurrence.motif}|${section?.id ?? `window-${timeWindow}`}`;
    if (clusters.has(cluster)) continue;
    clusters.add(cluster);
    anchors.add(occurrence.anchor);
  }

  return anchors;
}
