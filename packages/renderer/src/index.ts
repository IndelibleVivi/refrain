export { AirRenderer } from "./AirRenderer.js";
export { LanguageSwitch, useRefrainLocale } from "./locale.js";
export { uiCopy, resolveRefrainLocale } from "./ui-copy.js";
export type { RefrainLocale, UiMessageKey } from "./ui-copy.js";
export {
  evidenceIdOf,
  MAX_PRESENTATION_FRAGMENT_CHARS,
  receiptIdOf,
  receiptIdentityJson,
  receiptIntegrityErrors,
  receiptIntegrityIsValid,
  receiptShapeIsValid,
  SHA256_ID,
  sourceReceiptIntegrityErrors,
  sourceRevisionOf,
} from "./identity.js";
export type { ReceiptIntegrityError } from "./identity.js";
export {
  APPEARANCE_PREFERENCES_FORMAT,
  DEFAULT_BACKGROUND_OPACITY,
  MAX_APPEARANCE_IMAGE_BYTES,
  MAX_BACKGROUND_BLUR_PX,
  MAX_BACKGROUND_OPACITY,
  SELEN_V21_APPEARANCE_DEFAULTS,
  appearanceForTheme,
  isRasterAppearanceImage,
  normalizePortableAppearance,
  parseAppearancePreferences,
  parseSharedAppearance,
} from "./appearance.js";
export type {
  AppearanceImageMetadata,
  AppearancePreferences,
  PortableShareAppearance,
  ResolvedAppearance,
  ThemeAppearance,
} from "./appearance.js";
export {
  checkPublishedAssets,
  planInlineShare,
  publicPlayerBase,
} from "./share-policy.js";
export type {
  AssetStamp,
  ShareFailureReason,
  SharePlan,
  ShareRecipientCapabilities,
} from "./share-policy.js";
export { deliverShareLink } from "./share-delivery.js";
export type { ShareDeliveryOutcome, SharePlatform } from "./share-delivery.js";
export { prepareCurrentAirShare } from "./current-air-share.js";
export type { ShareDeployment } from "./current-air-share.js";
export {
  createRefrainArtifact,
  createRefrainArtifactV2,
  createRefrainArtifactV3,
  LEGACY_REFRAIN_ARTIFACT_FORMAT,
  parseRefrainArtifact,
  REFRAIN_ARTIFACT_FORMAT,
  REFRAIN_ARTIFACT_V2_FORMAT,
  REFRAIN_ARTIFACT_V3_FORMAT,
  refrainArtifactShapeIsValid,
  stringifyRefrainArtifact,
} from "./portable.js";
export type {
  CreateRefrainArtifactV2Input,
  CreateRefrainArtifactV3Input,
  RefrainArtifactParseResult,
} from "./portable.js";
export {
  artifactBytesOf,
  createInlinePresentationRef,
  decodeInlinePresentationRef,
  parseArtifactBytes,
  PRESENTATION_REF_FORMAT,
  REFRAIN_ARTIFACT_MEDIA_TYPE,
  type InlinePresentationResult,
  type PresentationRefV0,
} from "./presentation-ref.js";
export {
  createRefrainSelection,
  REFRAIN_SELECTION_FORMAT,
  refrainSelectionIsValid,
  selectionToAgentRequest,
  createRefrainSelectionHandoff,
  selectionHandoffToAgentRequest,
  stringifyRefrainSelectionHandoff,
  REFRAIN_SELECTION_HANDOFF_FORMAT,
  stringifyRefrainSelection,
} from "./selection.js";
export {
  buildStructureDetailWindow,
  buildStructureViewModel,
  MAX_DETAIL_EVENTS,
  MAX_STRUCTURE_ITEMS,
  MAX_WHOLE_FORM_BINS,
} from "./view-model.js";
export type {
  AirArtifact,
  AirArtifactV1,
  AnyAirArtifact,
  AirLineage,
  AirReceipt,
  ContinuationRelation,
  DownloadArtifact,
  DownloadArtifactOutcome,
  LegacyPresentationEnvelope,
  LegacyRefrainArtifact,
  MotifLinkEvidence,
  MotifTransformEvidence,
  MusicalRelationVerification,
  PresentationEnvelope,
  PresentationEnvelopeV2,
  ProjectionReference,
  RefrainArtifact,
  RefrainArtifactV1,
  RefrainArtifactV2,
  RefrainArtifactV3,
  RendererAssetConfig,
  RendererPlaybackCommand,
  RendererPlaybackEndedEvent,
  RefrainRendererProps,
  VerifiedMotifLink,
} from "./types.js";
export type {
  RefrainSelection,
  RefrainSelectionHandoff,
  RefrainSelectionKind,
} from "./selection.js";
export type { SelenV21ThemeId } from "./selen-v21-model.js";
export type {
  StructureHarmonySpan,
  StructureDetailWindow,
  StructureSection,
  StructureViewModel,
  StructureVoice,
  AirVisualFacts,
  VisualDensityBin,
  VisualVoiceDensity,
} from "./view-model.js";
