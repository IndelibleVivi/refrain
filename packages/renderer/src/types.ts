import type { ReactNode } from "react";
import type { AirSource, Diagnostic } from "@refrain/air-schema";
import type { AirSourceV1 } from "@refrain/air-schema/v1";
import type { CompiledAir } from "@refrain/compiler";
import type { CompiledAirV1 } from "@refrain/compiler/v1";
import type { RenderReceipt } from "@refrain/audio-engine/receipt";
import type {
  PerformanceBinding,
  PerformanceBindingRuntimeStatus,
} from "@refrain/soundpack";
import type { PerformanceBindingV1 } from "@refrain/soundpack/vnext";
import type { RenderReceiptV3 } from "@refrain/audio-engine/receipt";
import type { RefrainSelection, RefrainSelectionHandoff } from "./selection.js";
import type { SelenV21ThemeId } from "./selen-v21-model.js";
import type { AirReceiptV1 } from "./v1.js";
import type { RefrainLocale, UiMessageKey } from "./ui-copy.js";
import type { PortableShareAppearance } from "./appearance.js";
import type { ShareDeployment } from "./current-air-share.js";

export type ContinuationRelation =
  "revise" | "extend" | "reply" | "variation" | "quote";

export interface AirLineage {
  relation: ContinuationRelation;
  parentSourceRevision: string;
  parentReceiptId: string;
  parentAirId: string;
}

export interface MotifTransformEvidence {
  transpose: number;
  stretch: number;
  invert: boolean;
  retrograde: boolean;
}

export interface MotifLinkEvidence {
  parent: string;
  child: string;
  parentAnchor: string;
  childAnchor: string;
  transform: MotifTransformEvidence;
}

export type VerifiedMotifLink = MotifLinkEvidence;

export interface MusicalRelationVerification {
  contract: "musical-relation@0-experimental";
  status: "not_applicable" | "declared" | "verified";
  motifLinks: VerifiedMotifLink[];
  prefix?: {
    parentEventCount: number;
    childEventCount: number;
    parentDurationBeats: number;
    childDurationBeats: number;
  };
  evidenceId?: string;
}

export interface AirReceipt {
  format: "refrain-receipt@0-experimental";
  sourceRevision: string;
  airId: string;
  receiptId: string;
  sourceFormat: AirSource["format"];
  verification: MusicalRelationVerification;
  lineage?: AirLineage;
}

export interface AirArtifact {
  /** Full portable document; playback fields are a projection of it. */
  portableArtifact?: RefrainArtifact;
  source: AirSource;
  compiled: CompiledAir;
  diagnostics: Diagnostic[];
  receipt: AirReceipt;
  performanceBinding?: PerformanceBinding | PerformanceBindingV1;
  performanceStatus?: PerformanceBindingRuntimeStatus;
  caption?: string;
  presentation?: { url: string };
}

export interface LegacyPresentationEnvelope {
  format: "refrain-presentation@0-experimental";
  source: AirSource;
  receipt: AirReceipt;
  caption?: string;
}

export interface PresentationEnvelope {
  format: "refrain-presentation@1-experimental";
  source: AirSource;
  receipt: AirReceipt;
  performanceBinding: PerformanceBinding;
  caption?: string;
}

export interface PresentationEnvelopeV2 {
  format: "refrain-presentation@2-experimental";
  source: AirSourceV1;
  receipt: AirReceiptV1;
  performanceBinding?: PerformanceBinding;
  performanceStatus: PerformanceBindingRuntimeStatus;
  caption?: string;
}

export interface LegacyRefrainArtifact {
  format: "refrain-artifact@0-experimental";
  source: AirSource;
  receipt: AirReceipt;
  caption?: string;
}

export interface ProjectionReference {
  format: "refrain-projection-reference@0-experimental";
  kind: "midi" | "native-wav" | "audition-matched-wav";
  filename: string;
  renderReceiptId: string;
}

export interface RefrainArtifactV1 {
  format: "refrain-artifact@1-experimental";
  source: AirSource;
  receipt: AirReceipt;
  performanceBindings: PerformanceBinding[];
  defaultBindingId?: string;
  renderReceipts?: RenderReceipt[];
  projections?: ProjectionReference[];
  caption?: string;
}

export interface RefrainArtifactV2 {
  format: "refrain-artifact@2-experimental";
  source: AirSource;
  receipt: AirReceipt;
  performanceBindings: PerformanceBindingV1[];
  defaultBindingId?: string;
  renderReceipts?: RenderReceiptV3[];
  projections?: ProjectionReference[];
  caption?: string;
}

export interface RefrainArtifactV3 {
  format: "refrain-artifact@3-experimental";
  source: AirSourceV1;
  receipt: AirReceiptV1;
  performanceBindings: Array<PerformanceBinding | PerformanceBindingV1>;
  defaultBindingId?: string;
  renderReceipts?: RenderReceiptV3[];
  projections?: ProjectionReference[];
  caption?: string;
}

export type RefrainArtifact =
  | LegacyRefrainArtifact
  | RefrainArtifactV1
  | RefrainArtifactV2
  | RefrainArtifactV3;

export interface AirArtifactV1 {
  /** Full portable document; playback fields are a projection of it. */
  portableArtifact?: RefrainArtifact;
  source: AirSourceV1;
  compiled: CompiledAirV1;
  diagnostics: Diagnostic[];
  receipt: AirReceiptV1;
  performanceBinding?: PerformanceBinding | PerformanceBindingV1;
  performanceStatus?: PerformanceBindingRuntimeStatus;
  caption?: string;
  presentation?: { url: string };
}

export type AnyAirArtifact = AirArtifact | AirArtifactV1;

export interface DownloadArtifact {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface DownloadArtifactOutcome {
  disposition: "downloaded" | "copied";
  message: string;
  messageKey?: UiMessageKey;
}

export interface RendererAssetConfig {
  soundBankUrl?: string;
  assetBaseUrl?: string;
  workletUrl?: string;
  unavailableReason?: string;
}

export interface RendererPlaybackCommand {
  readonly requestId: number;
  readonly action: "start-at-zero";
  readonly receiptId: string;
}

export interface RendererPlaybackEndedEvent {
  readonly identity: string;
  readonly runId: number;
  readonly reason: "natural";
}

/** Presentation-only queue controls; the Player retains queue authority. */
export interface RendererQueueControls {
  position: number;
  total: number;
  previousLabel: string;
  nextLabel: string;
  nextDisabled: boolean;
  mode: string;
  modeIcon: string;
  modeLabel: string;
  modeActionLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onCycleMode: () => void;
}

export interface RefrainRendererProps {
  /** URL Player navigation; never part of music or MCP payloads. */
  toolbarActions?: ReactNode;
  queueControls?: RendererQueueControls;
  initialLocale?: RefrainLocale;
  onLocaleChange?: (locale: RefrainLocale) => void;
  artifact: AnyAirArtifact;
  assets: RendererAssetConfig;
  onDownload?: (
    artifact: DownloadArtifact,
  ) => Promise<DownloadArtifactOutcome | void> | DownloadArtifactOutcome | void;
  onSelectionRequest?: (
    selection: RefrainSelection,
    request: string,
    handoff: RefrainSelectionHandoff,
  ) => Promise<void> | void;
  /** Consumed once; only a user-started queue continuation may create this. */
  playbackCommand?: RendererPlaybackCommand;
  onPlaybackEnded?: (event: RendererPlaybackEndedEvent) => void;
  /** Listening selection only; the full portable artifact remains unchanged. */
  onAuditionBindingChange?: (bindingId: string | undefined) => void;
  surface?: "url" | "mcp-canvas";
  visualTheme?: SelenV21ThemeId;
  /** Portable scalar presentation state; never includes local image bytes. */
  visualAppearance?: PortableShareAppearance;
  /** Build-owned public receiver capabilities for exact zero-upload sharing. */
  shareDeployment?: ShareDeployment;
}
