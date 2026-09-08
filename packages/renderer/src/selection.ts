import type { StructureViewModel } from "./view-model.js";
import type { RefrainArtifact } from "./types.js";

export const REFRAIN_SELECTION_FORMAT =
  "refrain-selection@0-experimental" as const;

export type RefrainSelectionKind = "motif" | "segment" | "section";

export const REFRAIN_SELECTION_HANDOFF_FORMAT =
  "refrain-selection-handoff@0-experimental" as const;

export interface RefrainSelection {
  format: typeof REFRAIN_SELECTION_FORMAT;
  sourceRevision: string;
  receiptId: string;
  kind: RefrainSelectionKind;
  anchor: string;
  voiceId?: string;
  timeRange: {
    startBeat: number;
    endBeat: number;
  };
}

export interface RefrainSelectionHandoff {
  format: typeof REFRAIN_SELECTION_HANDOFF_FORMAT;
  selection: RefrainSelection;
  parentArtifact: RefrainArtifact;
}

export function createRefrainSelection(
  viewModel: StructureViewModel,
  kind: RefrainSelectionKind,
  anchor: string,
): RefrainSelection {
  if (kind === "motif") {
    const occurrence = viewModel.motifOccurrences.find(
      (item) => item.anchor === anchor,
    );
    if (!occurrence) throw new Error(`Unknown motif anchor ${anchor}.`);
    return {
      format: REFRAIN_SELECTION_FORMAT,
      sourceRevision: viewModel.sourceRevision,
      receiptId: viewModel.receiptId,
      kind,
      anchor,
      voiceId: occurrence.voiceId,
      timeRange: {
        startBeat: occurrence.startBeat,
        endBeat: occurrence.startBeat + occurrence.durationBeats,
      },
    };
  }
  if (kind === "segment") {
    const segment = viewModel.segments.find((item) => item.anchor === anchor);
    if (!segment) throw new Error(`Unknown segment anchor ${anchor}.`);
    return {
      format: REFRAIN_SELECTION_FORMAT,
      sourceRevision: viewModel.sourceRevision,
      receiptId: viewModel.receiptId,
      kind,
      anchor,
      voiceId: segment.voiceId,
      timeRange: { startBeat: segment.startBeat, endBeat: segment.endBeat },
    };
  }
  const section = viewModel.sections.find((item) => item.anchor === anchor);
  if (!section) throw new Error(`Unknown section anchor ${anchor}.`);
  return {
    format: REFRAIN_SELECTION_FORMAT,
    sourceRevision: viewModel.sourceRevision,
    receiptId: viewModel.receiptId,
    kind,
    anchor,
    timeRange: { startBeat: section.startBeat, endBeat: section.endBeat },
  };
}

export function refrainSelectionIsValid(
  value: unknown,
): value is RefrainSelection {
  if (!value || typeof value !== "object") return false;
  const selection = value as Partial<RefrainSelection>;
  const range = selection.timeRange as
    Partial<RefrainSelection["timeRange"]> | undefined;
  return (
    selection.format === REFRAIN_SELECTION_FORMAT &&
    typeof selection.sourceRevision === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(selection.sourceRevision) &&
    typeof selection.receiptId === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(selection.receiptId) &&
    ["motif", "segment", "section"].includes(selection.kind ?? "") &&
    typeof selection.anchor === "string" &&
    selection.anchor.length > 0 &&
    (selection.voiceId === undefined ||
      typeof selection.voiceId === "string") &&
    typeof range?.startBeat === "number" &&
    Number.isFinite(range.startBeat) &&
    typeof range.endBeat === "number" &&
    Number.isFinite(range.endBeat) &&
    range.endBeat > range.startBeat
  );
}

export function stringifyRefrainSelection(selection: RefrainSelection): string {
  return `${JSON.stringify(selection, null, 2)}\n`;
}

export function selectionToAgentRequest(selection: RefrainSelection): string {
  return [
    `The user selected the exact ${selection.kind} anchor ${selection.anchor} in Refrain source ${selection.sourceRevision} (receipt ${selection.receiptId}), beats ${selection.timeRange.startBeat}–${selection.timeRange.endBeat}${selection.voiceId ? `, voice ${selection.voiceId}` : ""}.`,
    "Treat this exact selection as conversational context, not as an automatic request to call hum or generate a new air. Respond to what the user asked about the selection. Call hum only when the user asks for a musical response or a new musical response is clearly appropriate. For a new root, author current air@1-experimental. For a continuation, preserve the exact parent AIR generation and provide its complete source plus same-generation receipt; never downgrade a parent to AIR@0. If you claim quotation or variation, link this exact parent occurrence with explicit anchor evidence so Refrain can verify it.",
    `Selection JSON: ${JSON.stringify(selection)}`,
  ].join("\n\n");
}

export function createRefrainSelectionHandoff(
  selection: RefrainSelection,
  parentArtifact: RefrainArtifact,
): RefrainSelectionHandoff {
  if (
    parentArtifact.receipt.sourceRevision !== selection.sourceRevision ||
    parentArtifact.receipt.receiptId !== selection.receiptId
  )
    throw new Error(
      "Selection handoff authority does not match its exact parent artifact.",
    );
  return {
    format: REFRAIN_SELECTION_HANDOFF_FORMAT,
    selection,
    parentArtifact,
  };
}

export function selectionHandoffToAgentRequest(
  handoff: RefrainSelectionHandoff,
  audition?: { id: string; contentSha256: string },
): string {
  return [
    `The user selected the exact ${handoff.selection.kind} anchor ${handoff.selection.anchor} in Refrain.`,
    "Treat this selection as conversational context, not as an automatic request to call hum. The closed handoff below contains the exact parent source, same-generation receipt, and any attached exact performance binding. If the user asks for a continuation, use parentArtifact as the sole parent authority; never reconstruct it from prose or downgrade its AIR generation.",
    ...(audition
      ? [
          `The listener auditioned carried binding ${audition.id} (sha256:${audition.contentSha256}). This is listening context, not permission to change sound. When continuing that sound, explicitly set performance.bindingId to ${JSON.stringify(audition.id)}; do not rewrite the saved parent default.`,
        ]
      : []),
    `Refrain selection handoff JSON:\n${JSON.stringify(handoff)}`,
  ].join("\n\n");
}

export function stringifyRefrainSelectionHandoff(
  handoff: RefrainSelectionHandoff,
): string {
  return `${JSON.stringify(handoff, null, 2)}\n`;
}
