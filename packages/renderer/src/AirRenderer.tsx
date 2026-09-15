import { useEffect, useMemo, useRef, useState } from "react";
import { stringifyAnyAir } from "@refrain/air-schema/any";
import type { BrowserAudioEngine } from "@refrain/audio-engine/browser";
import type {
  CompletePieceBrowserEngine,
  PlaybackEvidenceV0,
  PreparationProgressV0,
} from "@refrain/audio-engine/complete-browser";
import { createExecutionBundle } from "@refrain/audio-engine/execution";
import { SelenV21Canvas } from "./SelenV21Canvas.js";
import { useRefrainLocale } from "./locale.js";
import { uiCopy, type UiMessageKey } from "./ui-copy.js";
import { stringifyRefrainArtifact } from "./portable.js";
import {
  carriedBindings,
  portableArtifactForView,
  withAuditionBinding,
} from "./artifact-document.js";
import type { RefrainArtifact } from "./types.js";
import type { PerformanceBinding } from "@refrain/soundpack";
import {
  createRefrainSelectionHandoff,
  createRefrainSelection,
  selectionHandoffToAgentRequest,
  stringifyRefrainSelectionHandoff,
  type RefrainSelectionKind,
} from "./selection.js";
import { buildSelenV21Piece } from "./selen-v21-model.js";
import { IdentityScopedEngineSlot } from "./identity-scoped-engine.js";
import { rendererPlaybackCapability } from "./playback-capability.js";
import {
  PlaybackCompletionGate,
  type PlaybackRun,
} from "./playback-completion.js";
import type {
  DownloadArtifact,
  DownloadArtifactOutcome,
  RefrainRendererProps,
} from "./types.js";
import { buildStructureViewModel } from "./view-model.js";
import { AppearanceControls } from "./AppearanceControls.js";
import { ShareControl } from "./ShareControl.js";
import {
  planPreparedCurrentAirShare,
  prepareCurrentAirShareContext,
} from "./current-air-share.js";
import {
  APPEARANCE_PREFERENCES_FORMAT,
  appearanceForTheme,
  isRasterAppearanceImage,
  parseAppearancePreferences,
  type AppearancePreferences,
  type PortableShareAppearance,
  type ResolvedAppearance,
  type ThemeAppearance,
} from "./appearance.js";
import {
  deleteAppearanceBackground,
  readAppearanceBackground,
  readStoredAppearancePreferences,
  writeAppearanceBackground,
  writeStoredAppearancePreferences,
} from "./appearance-storage.js";

type PlayerState =
  | "idle"
  | "loading"
  | "preparing"
  | "playing"
  | "paused"
  | "buffering"
  | "ready"
  | "error";

type ActiveAudioEngine = BrowserAudioEngine | CompletePieceBrowserEngine;
type UiNotice = { key?: UiMessageKey; detail?: string };

function completePieceEngine(
  value: ActiveAudioEngine,
): value is CompletePieceBrowserEngine {
  return "jumpToSection" in value;
}

function browserDownload(file: DownloadArtifact): void {
  const bytes = file.bytes.buffer.slice(
    file.bytes.byteOffset,
    file.bytes.byteOffset + file.bytes.byteLength,
  ) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function artifactStem(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "air"
  );
}

export function AirRenderer({
  artifact: suppliedArtifact,
  assets,
  onDownload,
  onSelectionRequest,
  surface = "url",
  visualTheme,
  visualAppearance,
  initialLocale,
  onLocaleChange,
  playbackCommand,
  onPlaybackEnded,
  shareDeployment,
}: RefrainRendererProps) {
  const document = useMemo(
    () => portableArtifactForView(suppliedArtifact),
    [suppliedArtifact],
  );
  const [audition, setAudition] = useState<{
    document: RefrainArtifact;
    bindingId: string;
  }>();
  const artifact = useMemo(
    () =>
      audition?.document === document
        ? withAuditionBinding(suppliedArtifact, audition.bindingId || undefined)
        : suppliedArtifact,
    [suppliedArtifact, document, audition],
  );
  const bindings = carriedBindings(document);
  const [locale, setLocale] = useRefrainLocale(initialLocale);
  const initialAppearancePreferences = useRef<
    AppearancePreferences | undefined
  >(undefined);
  if (!initialAppearancePreferences.current)
    initialAppearancePreferences.current =
      surface === "url" && typeof window !== "undefined"
        ? readStoredAppearancePreferences()
        : parseAppearancePreferences({
            format: APPEARANCE_PREFERENCES_FORMAT,
            themes: {},
          });
  const [appearancePreferences, setAppearancePreferences] =
    useState<AppearancePreferences>(initialAppearancePreferences.current);
  const appearancePreferencesRef = useRef(appearancePreferences);
  appearancePreferencesRef.current = appearancePreferences;
  const [selectedTheme, setSelectedTheme] = useState(
    visualTheme ??
      initialAppearancePreferences.current.selectedTheme ??
      "paper-sonata",
  );
  const [portableAppearanceActive, setPortableAppearanceActive] = useState(
    Boolean(visualAppearance),
  );
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string>();
  const backgroundImageUrlRef = useRef<string | undefined>(undefined);
  const backgroundLoadRevision = useRef(0);
  const appearanceMutationRevisions = useRef(
    new Map<typeof selectedTheme, number>(),
  );
  const desiredBackgrounds = useRef(
    new Map<typeof selectedTheme, Blob | undefined>(),
  );
  const [appearanceNotice, setAppearanceNotice] = useState<
    "saved" | "reset" | "invalid" | "failed"
  >();
  const [includeShareAppearance, setIncludeShareAppearance] = useState(true);
  const visualAppearanceKey = JSON.stringify(visualAppearance ?? null);
  useEffect(() => {
    if (visualTheme) setSelectedTheme(visualTheme);
    setPortableAppearanceActive(Boolean(visualAppearance));
  }, [visualTheme, visualAppearanceKey]);
  const copy = uiCopy(locale);
  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [playerError, setPlayerError] = useState<string>();
  const [transportSeconds, setTransportSeconds] = useState(0);
  const [transportDurationSeconds, setTransportDurationSeconds] = useState(
    artifact.compiled.durationSeconds,
  );
  const [playbackEvidence, setPlaybackEvidence] =
    useState<PlaybackEvidenceV0>();
  const [selectedAnchor, setSelectedAnchor] = useState<string>();
  const [selectionStatus, setSelectionStatus] = useState<UiNotice>();
  const [exportStatus, setExportStatus] = useState<UiNotice>();
  const performanceBinding = artifact.performanceBinding;
  const artifactIdentity = `${artifact.receipt.receiptId}:${performanceBinding?.contentSha256 ?? "unbound"}`;
  const engineSlot = useRef<
    IdentityScopedEngineSlot<ActiveAudioEngine> | undefined
  >(undefined);
  if (!engineSlot.current)
    engineSlot.current = new IdentityScopedEngineSlot(artifactIdentity);
  const unsubscribeTransport = useRef<(() => void) | undefined>(undefined);
  const unsubscribePreparation = useRef<(() => void) | undefined>(undefined);
  const [preparation, setPreparation] = useState<PreparationProgressV0>();
  const stopStateTimer = useRef<number | undefined>(undefined);
  const actionGeneration = useRef(0);
  const completionGate = useRef(new PlaybackCompletionGate());
  const completionRun = useRef<PlaybackRun | undefined>(undefined);
  const onPlaybackEndedRef = useRef(onPlaybackEnded);
  onPlaybackEndedRef.current = onPlaybackEnded;
  const consumedPlaybackCommand = useRef(0);
  const disposed = useRef(false);
  const renderedArtifactIdentity = useRef(artifactIdentity);
  const structure = useMemo(
    () =>
      buildStructureViewModel(
        artifact.source,
        artifact.compiled,
        artifact.receipt,
      ),
    [artifact],
  );
  const visualPiece = useMemo(
    () => buildSelenV21Piece(artifact, structure, { transportDurationSeconds }),
    [artifact, structure, transportDurationSeconds],
  );
  const selectionOptions = useMemo(
    () => [
      ...structure.sections.map((section) => ({
        kind: "section" as const,
        anchor: section.anchor,
        label: section.authoredLabel,
      })),
      ...structure.segments.map((segment) => ({
        kind: "segment" as const,
        anchor: segment.anchor,
        label: `${segment.voiceId}/${segment.segmentId} · #${segment.repeatIndex + 1}`,
      })),
      ...structure.motifOccurrences.map((occurrence) => ({
        kind: "motif" as const,
        anchor: occurrence.anchor,
        label: `@${occurrence.motif} · ${occurrence.voiceId} · #${occurrence.occurrence}`,
      })),
    ],
    [structure],
  );
  const isCompletePiece = Boolean(
    performanceBinding &&
    (performanceBinding.renderer.performancePlanFormat ===
      "performance-plan@3-experimental" ||
      performanceBinding.renderer.performancePlanFormat ===
        "performance-plan@4-experimental"),
  );
  const execution = useMemo(() => {
    if (!performanceBinding || !isCompletePiece) return {};
    try {
      return {
        bundle: createExecutionBundle(artifact.compiled, {
          sourceRevision: artifact.receipt.sourceRevision,
          performanceBinding,
        }),
      };
    } catch (cause) {
      return {
        error:
          cause instanceof Error
            ? cause.message
            : "The exact execution bundle could not be constructed.",
      };
    }
  }, [artifact, isCompletePiece, performanceBinding]);
  const playbackCapability = rendererPlaybackCapability({
    hasBinding: Boolean(performanceBinding),
    performanceStatus: artifact.performanceStatus,
    completePiece: isCompletePiece,
    assetRequirements: execution.bundle?.plan.assetRequirements,
    executionError: execution.error,
    assets,
  });
  const performanceUnavailable =
    playbackCapability.status === "unavailable"
      ? playbackCapability
      : undefined;
  const storedAppearance = useMemo(
    () => appearanceForTheme(appearancePreferences, selectedTheme),
    [appearancePreferences, selectedTheme],
  );
  const currentAppearance = useMemo<ThemeAppearance>(
    () => ({
      ...storedAppearance,
      ...(portableAppearanceActive && selectedTheme === visualTheme
        ? visualAppearance
        : {}),
    }),
    [
      portableAppearanceActive,
      selectedTheme,
      storedAppearance,
      visualAppearanceKey,
      visualTheme,
    ],
  );
  const resolvedAppearance = useMemo<ResolvedAppearance>(
    () => ({
      ...currentAppearance,
      ...(backgroundImageUrl ? { backgroundImageUrl } : {}),
    }),
    [backgroundImageUrl, currentAppearance],
  );
  const portableShareAppearance = useMemo<
    PortableShareAppearance | undefined
  >(() => {
    const { backgroundImage: _backgroundImage, ...portable } =
      currentAppearance;
    return Object.keys(portable).length ? portable : undefined;
  }, [currentAppearance]);
  const preparedShare = useMemo(
    () =>
      prepareCurrentAirShareContext({
        view: artifact,
        deployment: shareDeployment,
      }),
    [artifact, shareDeployment],
  );
  const sharePlan = useMemo(
    () =>
      planPreparedCurrentAirShare({
        prepared: preparedShare,
        theme: selectedTheme,
        ...(includeShareAppearance && portableShareAppearance
          ? { appearance: portableShareAppearance }
          : {}),
      }),
    [
      includeShareAppearance,
      portableShareAppearance,
      preparedShare,
      selectedTheme,
    ],
  );
  const backgroundMetadataKey = JSON.stringify(
    currentAppearance.backgroundImage ?? null,
  );

  const replaceBackgroundImageUrl = (next: string | undefined) => {
    const previous = backgroundImageUrlRef.current;
    if (previous && previous !== next) URL.revokeObjectURL(previous);
    backgroundImageUrlRef.current = next;
    setBackgroundImageUrl(next);
  };

  const persistAppearancePreferences = (next: AppearancePreferences) => {
    appearancePreferencesRef.current = next;
    setAppearancePreferences(next);
    if (surface !== "url") return true;
    try {
      writeStoredAppearancePreferences(next);
      return true;
    } catch {
      return false;
    }
  };

  const beginAppearanceMutation = (theme: typeof selectedTheme) => {
    const revision = (appearanceMutationRevisions.current.get(theme) ?? 0) + 1;
    appearanceMutationRevisions.current.set(theme, revision);
    return revision;
  };

  const appearanceMutationIsCurrent = (
    theme: typeof selectedTheme,
    revision: number,
  ) => appearanceMutationRevisions.current.get(theme) === revision;

  const reconcileBackgroundStorage = async (theme: typeof selectedTheme) => {
    const desired = desiredBackgrounds.current.get(theme);
    if (desired) await writeAppearanceBackground(theme, desired);
    else await deleteAppearanceBackground(theme);
  };

  const changeTheme = (nextTheme: typeof selectedTheme) => {
    setSelectedTheme(nextTheme);
    setPortableAppearanceActive(
      Boolean(visualAppearance) && nextTheme === visualTheme,
    );
    const next = parseAppearancePreferences({
      ...appearancePreferencesRef.current,
      selectedTheme: nextTheme,
    });
    setAppearanceNotice(
      persistAppearancePreferences(next) ? "saved" : "failed",
    );
  };

  const changeAppearance = (change: Partial<ThemeAppearance>) => {
    setPortableAppearanceActive(false);
    const preferences = appearancePreferencesRef.current;
    const next = parseAppearancePreferences({
      ...preferences,
      themes: {
        ...preferences.themes,
        [selectedTheme]: {
          ...appearanceForTheme(preferences, selectedTheme),
          ...change,
        },
      },
    });
    setAppearanceNotice(
      persistAppearancePreferences(next) ? "saved" : "failed",
    );
  };

  const setAppearanceImage = async (file: File) => {
    setPortableAppearanceActive(false);
    if (!isRasterAppearanceImage(file)) {
      setAppearanceNotice("invalid");
      return;
    }
    const targetTheme = selectedTheme;
    const mutation = beginAppearanceMutation(targetTheme);
    desiredBackgrounds.current.set(targetTheme, file);
    try {
      await writeAppearanceBackground(targetTheme, file);
      if (!appearanceMutationIsCurrent(targetTheme, mutation)) {
        await reconcileBackgroundStorage(targetTheme);
        return;
      }
      const preferences = appearancePreferencesRef.current;
      const next = parseAppearancePreferences({
        ...preferences,
        themes: {
          ...preferences.themes,
          [targetTheme]: {
            ...appearanceForTheme(preferences, targetTheme),
            backgroundImage: {
              name: file.name,
              mediaType: file.type,
              bytes: file.size,
            },
          },
        },
      });
      setAppearanceNotice(
        persistAppearancePreferences(next) ? "saved" : "failed",
      );
    } catch {
      if (appearanceMutationIsCurrent(targetTheme, mutation))
        setAppearanceNotice("failed");
    }
  };

  const removeAppearanceImage = async () => {
    setPortableAppearanceActive(false);
    const targetTheme = selectedTheme;
    const mutation = beginAppearanceMutation(targetTheme);
    desiredBackgrounds.current.set(targetTheme, undefined);
    try {
      await deleteAppearanceBackground(targetTheme);
      if (!appearanceMutationIsCurrent(targetTheme, mutation)) {
        await reconcileBackgroundStorage(targetTheme);
        return;
      }
      const preferences = appearancePreferencesRef.current;
      const { backgroundImage: _backgroundImage, ...withoutImage } =
        appearanceForTheme(preferences, targetTheme);
      const next = parseAppearancePreferences({
        ...preferences,
        themes: { ...preferences.themes, [targetTheme]: withoutImage },
      });
      setAppearanceNotice(
        persistAppearancePreferences(next) ? "saved" : "failed",
      );
    } catch {
      if (appearanceMutationIsCurrent(targetTheme, mutation))
        setAppearanceNotice("failed");
    }
  };

  const resetAppearance = async () => {
    setPortableAppearanceActive(false);
    const targetTheme = selectedTheme;
    const mutation = beginAppearanceMutation(targetTheme);
    desiredBackgrounds.current.set(targetTheme, undefined);
    try {
      if (
        appearanceForTheme(appearancePreferencesRef.current, targetTheme)
          .backgroundImage
      )
        await deleteAppearanceBackground(targetTheme);
      if (!appearanceMutationIsCurrent(targetTheme, mutation)) {
        await reconcileBackgroundStorage(targetTheme);
        return;
      }
      const preferences = appearancePreferencesRef.current;
      const next = parseAppearancePreferences({
        ...preferences,
        themes: { ...preferences.themes, [targetTheme]: {} },
      });
      setAppearanceNotice(
        persistAppearancePreferences(next) ? "reset" : "failed",
      );
    } catch {
      if (appearanceMutationIsCurrent(targetTheme, mutation))
        setAppearanceNotice("failed");
    }
  };

  useEffect(
    () => () => {
      backgroundLoadRevision.current += 1;
      if (backgroundImageUrlRef.current)
        URL.revokeObjectURL(backgroundImageUrlRef.current);
      backgroundImageUrlRef.current = undefined;
    },
    [],
  );

  useEffect(() => {
    const revision = ++backgroundLoadRevision.current;
    replaceBackgroundImageUrl(undefined);
    if (surface !== "url" || !currentAppearance.backgroundImage) return;
    void readAppearanceBackground(selectedTheme).then(
      (blob) => {
        if (revision !== backgroundLoadRevision.current) return;
        if (!blob) {
          setAppearanceNotice("failed");
          return;
        }
        const url = URL.createObjectURL(blob);
        if (revision !== backgroundLoadRevision.current) {
          URL.revokeObjectURL(url);
          return;
        }
        replaceBackgroundImageUrl(url);
      },
      () => {
        if (revision === backgroundLoadRevision.current)
          setAppearanceNotice("failed");
      },
    );
  }, [backgroundMetadataKey, selectedTheme, surface]);

  useEffect(() => {
    disposed.current = false;
    // React StrictMode deliberately runs setup -> cleanup -> setup once in
    // development. The cleanup disposes the identity slot, so the second
    // setup must reactivate that same identity before the first user gesture.
    void engineSlot.current!.replace(artifactIdentity);
    return () => {
      disposed.current = true;
      actionGeneration.current += 1;
      completionGate.current.cancel();
      completionRun.current = undefined;
      if (stopStateTimer.current !== undefined)
        window.clearTimeout(stopStateTimer.current);
      unsubscribeTransport.current?.();
      unsubscribeTransport.current = undefined;
      unsubscribePreparation.current?.();
      unsubscribePreparation.current = undefined;
      void engineSlot.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (renderedArtifactIdentity.current === artifactIdentity) return;
    renderedArtifactIdentity.current = artifactIdentity;
    actionGeneration.current += 1;
    completionGate.current.cancel();
    completionRun.current = undefined;
    if (stopStateTimer.current !== undefined) {
      window.clearTimeout(stopStateTimer.current);
      stopStateTimer.current = undefined;
    }
    unsubscribeTransport.current?.();
    unsubscribeTransport.current = undefined;
    unsubscribePreparation.current?.();
    unsubscribePreparation.current = undefined;
    void engineSlot.current!.replace(artifactIdentity);
    setPlayerState("idle");
    setTransportSeconds(0);
    setTransportDurationSeconds(artifact.compiled.durationSeconds);
    setPlaybackEvidence(undefined);
    setPlayerError(undefined);
    setSelectedAnchor(undefined);
    setSelectionStatus(undefined);
    setExportStatus(undefined);
    setPreparation(undefined);
  }, [artifactIdentity, artifact.compiled.durationSeconds]);

  const getEngine = async (): Promise<ActiveAudioEngine> => {
    if (performanceUnavailable) {
      throw new Error(performanceUnavailable.message);
    }
    if (!performanceBinding)
      throw new Error("No exact performance binding is attached.");
    const current = engineSlot.current!.current(artifactIdentity);
    if (current) return current;
    setPlayerState("loading");
    setPlayerError(undefined);
    try {
      const created = await engineSlot.current!.get(
        artifactIdentity,
        async (signal) => {
          if (signal.aborted) throw signal.reason;
          return isCompletePiece
            ? import("@refrain/audio-engine/complete-browser").then(
                ({ CompletePieceBrowserEngine: Engine }) => {
                  const bundle = execution.bundle;
                  if (!bundle)
                    throw new Error(
                      execution.error ?? "The execution bundle is unavailable.",
                    );
                  return Engine.create(bundle, {
                    ...(assets.soundBankUrl
                      ? { soundBankUrl: assets.soundBankUrl }
                      : {}),
                    ...(assets.assetBaseUrl !== undefined
                      ? { assetBaseUrl: assets.assetBaseUrl }
                      : {}),
                    ...(assets.workletUrl
                      ? { workletUrl: assets.workletUrl }
                      : {}),
                  });
                },
              )
            : import("@refrain/audio-engine/browser").then(
                ({ BrowserAudioEngine: Engine }) =>
                  Engine.create({
                    soundBankUrl: assets.soundBankUrl,
                    assetBaseUrl: assets.assetBaseUrl,
                    workletUrl: assets.workletUrl,
                    performanceBinding:
                      performanceBinding as PerformanceBinding,
                  }),
              );
        },
      );
      if (!engineSlot.current!.isCurrent(artifactIdentity, created))
        throw new Error("The requested audio engine is no longer current.");
      if (completePieceEngine(created)) {
        setTransportDurationSeconds(created.bundle.plan.renderDurationSeconds);
        unsubscribeTransport.current = created.subscribeTransport(
          (snapshot) => {
            setTransportSeconds(snapshot.positionFrame / snapshot.sampleRate);
            const run = completionRun.current;
            if (run) {
              const ended = completionGate.current.observe(run, snapshot);
              if (ended) {
                completionRun.current = undefined;
                onPlaybackEndedRef.current?.(ended);
              }
            }
            setPlayerState(
              snapshot.status === "playing"
                ? "playing"
                : snapshot.status === "paused"
                  ? "paused"
                  : snapshot.status === "preparing"
                    ? "preparing"
                    : snapshot.status === "buffering"
                      ? "buffering"
                      : snapshot.status === "error"
                        ? "error"
                        : "ready",
            );
          },
        );
        unsubscribePreparation.current = created.subscribePreparation(
          (progress) => {
            setPreparation(progress.active ? progress : undefined);
          },
        );
      }
      setPlayerState("ready");
      return created;
    } catch (cause) {
      if (
        !disposed.current &&
        engineSlot.current!.owns(artifactIdentity) &&
        !(cause instanceof Error && cause.name === "AbortError")
      ) {
        setPlayerState("error");
        setPlayerError(
          cause instanceof Error
            ? cause.message
            : "Audio engine failed to start.",
        );
      }
      throw cause;
    }
  };

  const togglePlayback = async () => {
    if (playerState === "playing") {
      actionGeneration.current += 1;
      completionGate.current.cancel();
      completionRun.current = undefined;
      if (stopStateTimer.current !== undefined) {
        window.clearTimeout(stopStateTimer.current);
        stopStateTimer.current = undefined;
      }
      const currentEngine = engineSlot.current!.current(artifactIdentity);
      if (currentEngine && completePieceEngine(currentEngine)) {
        currentEngine.pause();
        setPlayerState("paused");
      } else {
        currentEngine?.stop();
        setPlayerState("ready");
      }
      return;
    }
    if (playerState === "preparing" || playerState === "buffering") return;
    const generation = actionGeneration.current + 1;
    actionGeneration.current = generation;
    let playbackRun: PlaybackRun | undefined;
    try {
      const audio = await getEngine();
      if (generation !== actionGeneration.current || disposed.current) return;
      setPlayerState("preparing");
      if (completePieceEngine(audio)) {
        playbackRun = completionGate.current.begin(artifactIdentity);
        completionRun.current = playbackRun;
        if (playerState === "paused") await audio.resume();
        else {
          setPlaybackEvidence(await audio.playAt(transportSeconds));
        }
        if (generation !== actionGeneration.current || disposed.current) return;
        setPlayerState("playing");
        return;
      }
      const receipt = await audio.play(
        artifact.compiled,
        performanceBinding as PerformanceBinding,
      );
      if (generation !== actionGeneration.current || disposed.current) return;
      if (!receipt) {
        setPlayerState("ready");
        return;
      }
      setPlayerState("playing");
      if (stopStateTimer.current !== undefined)
        window.clearTimeout(stopStateTimer.current);
      stopStateTimer.current = window.setTimeout(
        () => {
          if (generation === actionGeneration.current) {
            stopStateTimer.current = undefined;
            setPlayerState("ready");
          }
        },
        Math.ceil(receipt.durationSeconds * 1000),
      );
    } catch (cause) {
      if (playbackRun) completionGate.current.cancel(playbackRun);
      if (completionRun.current === playbackRun)
        completionRun.current = undefined;
      if (generation !== actionGeneration.current || disposed.current) return;
      setPlayerState("error");
      setPlayerError(
        cause instanceof Error ? cause.message : "Audio playback failed.",
      );
    }
  };

  const startPlaybackAtZero = async () => {
    const generation = actionGeneration.current + 1;
    actionGeneration.current = generation;
    completionGate.current.cancel();
    completionRun.current = undefined;
    setTransportSeconds(0);
    let playbackRun: PlaybackRun | undefined;
    try {
      const audio = await getEngine();
      if (generation !== actionGeneration.current || disposed.current) return;
      setPlayerState("preparing");
      if (completePieceEngine(audio)) {
        playbackRun = completionGate.current.begin(artifactIdentity);
        completionRun.current = playbackRun;
        setPlaybackEvidence(await audio.playAt(0));
      } else {
        audio.stop();
        const receipt = await audio.play(
          artifact.compiled,
          performanceBinding as PerformanceBinding,
        );
        if (!receipt) {
          setPlayerState("ready");
          return;
        }
      }
      if (generation !== actionGeneration.current || disposed.current) return;
      setPlayerState("playing");
    } catch (cause) {
      if (playbackRun) completionGate.current.cancel(playbackRun);
      if (completionRun.current === playbackRun)
        completionRun.current = undefined;
      if (generation !== actionGeneration.current || disposed.current) return;
      setPlayerState("error");
      setPlayerError(
        cause instanceof Error ? cause.message : "Playback failed to start.",
      );
    }
  };

  useEffect(() => {
    if (!playbackCommand) return;
    if (playbackCommand.requestId <= consumedPlaybackCommand.current) return;
    consumedPlaybackCommand.current = playbackCommand.requestId;
    if (
      playbackCommand.action !== "start-at-zero" ||
      playbackCommand.receiptId !== artifact.receipt.receiptId
    )
      return;
    void startPlaybackAtZero();
  }, [
    artifact.receipt.receiptId,
    artifactIdentity,
    playbackCommand?.action,
    playbackCommand?.receiptId,
    playbackCommand?.requestId,
  ]);

  const stopCompletePiece = () => {
    actionGeneration.current += 1;
    completionGate.current.cancel();
    completionRun.current = undefined;
    const currentEngine = engineSlot.current!.current(artifactIdentity);
    currentEngine?.stop();
    setTransportSeconds(0);
    setPlayerState(currentEngine ? "ready" : "idle");
  };

  const restartCompletePiece = async () => {
    if (!engineSlot.current!.current(artifactIdentity)) {
      actionGeneration.current += 1;
      completionGate.current.cancel();
      completionRun.current = undefined;
      setTransportSeconds(0);
      setPlayerState("idle");
      return;
    }
    await startPlaybackAtZero();
  };

  const seekCompletePiece = async (seconds: number) => {
    const wasPlaying = playerState === "playing";
    const generation = actionGeneration.current + 1;
    actionGeneration.current = generation;
    completionGate.current.cancel();
    completionRun.current = undefined;
    setTransportSeconds(seconds);
    if (!isCompletePiece) return;
    const slot = engineSlot.current!;
    const currentEngine = slot.current(artifactIdentity);
    const pendingEngine = currentEngine
      ? undefined
      : slot.pending(artifactIdentity);
    if (!currentEngine && !pendingEngine) return;
    let playbackRun: PlaybackRun | undefined;
    try {
      setPlayerState("preparing");
      const audio = currentEngine ?? (await pendingEngine!);
      if (generation !== actionGeneration.current || disposed.current) return;
      if (!completePieceEngine(audio)) return;
      if (wasPlaying) {
        playbackRun = completionGate.current.begin(artifactIdentity);
        completionRun.current = playbackRun;
      }
      await audio.seek(seconds);
    } catch (cause) {
      if (playbackRun) completionGate.current.cancel(playbackRun);
      if (completionRun.current === playbackRun)
        completionRun.current = undefined;
      if (generation !== actionGeneration.current || disposed.current) return;
      setPlayerState("error");
      setPlayerError(cause instanceof Error ? cause.message : "Seek failed.");
    }
  };

  const exportSource = async (): Promise<DownloadArtifactOutcome | void> => {
    const bytes = new TextEncoder().encode(stringifyAnyAir(artifact.source));
    const file: DownloadArtifact = {
      filename: `${artifactStem(artifact.source.title)}.air.json`,
      mimeType: "application/json",
      bytes,
    };
    if (onDownload) return onDownload(file);
    browserDownload(file);
  };

  const portableArtifactForCurrent = () => document;

  const exportPortableArtifact =
    async (): Promise<DownloadArtifactOutcome | void> => {
      const portable = portableArtifactForCurrent();
      const file: DownloadArtifact = {
        filename: `${artifactStem(artifact.source.title)}.refrain.json`,
        mimeType: "application/json",
        bytes: new TextEncoder().encode(stringifyRefrainArtifact(portable)),
      };
      if (onDownload) return onDownload(file);
      browserDownload(file);
    };

  const requestExport = async (kind: "artifact" | "source") => {
    try {
      setPlayerError(undefined);
      setExportStatus(undefined);
      const outcome =
        kind === "artifact"
          ? await exportPortableArtifact()
          : await exportSource();
      setExportStatus({
        key: outcome
          ? outcome.messageKey
          : kind === "artifact"
            ? "artifactDownloaded"
            : "sourceDownloaded",
        ...(outcome && !outcome.messageKey ? { detail: outcome.message } : {}),
      });
    } catch (cause) {
      setPlayerError(cause instanceof Error ? cause.message : "Export failed.");
    }
  };

  const runSelectionAction = async (
    kind: RefrainSelectionKind,
    anchor: string,
    action: "primary" | "copy" | "download" | "return",
  ): Promise<boolean> => {
    if (kind === "motif") setSelectedAnchor(anchor);
    const exactSelection = createRefrainSelection(structure, kind, anchor);
    const handoff = createRefrainSelectionHandoff(
      exactSelection,
      portableArtifactForCurrent(),
    );
    const request = selectionHandoffToAgentRequest(handoff, performanceBinding);
    try {
      if (action === "download") {
        const file: DownloadArtifact = {
          filename: `${artifactStem(artifact.source.title)}.${kind}.selection-handoff.json`,
          mimeType: "application/json",
          bytes: new TextEncoder().encode(
            stringifyRefrainSelectionHandoff(handoff),
          ),
        };
        let outcome: DownloadArtifactOutcome | void = undefined;
        if (onDownload) outcome = await onDownload(file);
        else browserDownload(file);
        setSelectionStatus({
          key: outcome ? outcome.messageKey : "selectionDownloaded",
          ...(outcome && !outcome.messageKey
            ? { detail: outcome.message }
            : {}),
        });
      } else if (
        action === "return" ||
        (action === "primary" && onSelectionRequest)
      ) {
        if (!onSelectionRequest)
          throw new Error("This host cannot return a selection to chat.");
        await onSelectionRequest(exactSelection, request, handoff);
        setSelectionStatus({ key: "selectionReturned" });
      } else {
        await navigator.clipboard.writeText(request);
        setSelectionStatus({ key: "requestCopied" });
      }
      return true;
    } catch (cause) {
      setSelectionStatus({
        key: "operationFailed",
        ...(cause instanceof Error ? { detail: cause.message } : {}),
      });
      return false;
    }
  };

  const visualPositionBeat = transportSeconds * (artifact.compiled.tempo / 60);

  return (
    <div
      className="refrain-renderer"
      lang={locale}
      data-player-state={playerState}
      data-playback-adapter={playbackEvidence?.adapter}
      data-opening-assets={playbackEvidence?.openingAssets.length}
      data-surface={surface}
      data-llm={`Viewing the air ${artifact.source.title}; source revision ${artifact.receipt.sourceRevision}; receipt ${artifact.receipt.receiptId}; performance binding ${performanceBinding ? `${performanceBinding.id} sha256:${performanceBinding.contentSha256}` : "unbound"}; performance ${performanceUnavailable ? `unavailable: ${performanceUnavailable.message}` : "available"}; musical relation ${artifact.receipt.verification.status}; ${artifact.compiled.motifOccurrences.length} motif occurrences.`}
    >
      {bindings.length > 1 ? (
        <div className="refrain-renderer__performance">
          <label>
            <span>{copy.auditionSound}</span>
            <select
              aria-label={copy.auditionSound}
              value={performanceBinding?.id ?? ""}
              onChange={(event) =>
                setAudition({ document, bindingId: event.currentTarget.value })
              }
            >
              <option value="">{copy.chooseSound}</option>
              {bindings.map((binding) => (
                <option key={binding.id} value={binding.id}>
                  {binding.id}
                </option>
              ))}
            </select>
          </label>
          <p>{copy.auditionOnly}</p>
        </div>
      ) : null}
      {surface === "url" ? (
        <>
          <AppearanceControls
            appearance={currentAppearance}
            locale={locale}
            theme={selectedTheme}
            notice={
              appearanceNotice === "saved"
                ? copy.appearanceSaved
                : appearanceNotice === "reset"
                  ? copy.appearanceReset
                  : appearanceNotice === "invalid"
                    ? copy.invalidBackground
                    : appearanceNotice === "failed"
                      ? copy.appearanceFailed
                      : undefined
            }
            onChange={changeAppearance}
            onImage={(file) => void setAppearanceImage(file)}
            onRemoveImage={() => void removeAppearanceImage()}
            onReset={() => void resetAppearance()}
          />
          <ShareControl
            hasLocalBackground={Boolean(currentAppearance.backgroundImage)}
            includeAppearance={includeShareAppearance}
            locale={locale}
            onIncludeAppearanceChange={setIncludeShareAppearance}
            plan={sharePlan}
            title={artifact.source.title}
          />
        </>
      ) : null}
      <SelenV21Canvas
        artifactIdentity={artifactIdentity}
        locale={locale}
        callbacks={{
          onLocaleChange: (next) => {
            setLocale(next);
            onLocaleChange?.(next);
          },
          onThemeChange: changeTheme,
          onExportArtifact: () => requestExport("artifact"),
          onExportSource: () => requestExport("source"),
          onRestartPlayback: () => restartCompletePiece(),
          onSeekBeat: (beat) =>
            seekCompletePiece(beat * (60 / artifact.compiled.tempo)),
          onSelectionAction: (anchor) =>
            runSelectionAction("motif", anchor, "primary"),
          onExactSelectionAction: async (kind, anchor, action) => {
            await runSelectionAction(kind, anchor, action);
          },
          onSelectionChange: (anchor) => {
            setSelectedAnchor(anchor);
            setSelectionStatus(undefined);
          },
          onStopPlayback: stopCompletePiece,
          onTogglePlayback: togglePlayback,
        }}
        canReturnSelection={Boolean(onSelectionRequest)}
        playbackEnabled={!performanceUnavailable}
        piece={visualPiece}
        playing={playerState === "playing"}
        positionBeat={visualPositionBeat}
        preparation={
          playerState === "loading" ||
          playerState === "preparing" ||
          playerState === "buffering"
            ? (preparation ?? null)
            : null
        }
        selectionOptions={selectionOptions}
        selectedAnchor={selectedAnchor}
        surface={surface}
        themeId={selectedTheme}
        appearance={resolvedAppearance}
      />
      {playerError ? (
        <p className="refrain-renderer__notice" role="alert">
          {copy.operationFailed} <span lang="en">{playerError}</span>
        </p>
      ) : null}
      {performanceUnavailable ? (
        <p className="refrain-renderer__notice" role="status">
          {copy.performanceUnavailable}{" "}
          {performanceUnavailable.reason === "performance-binding-missing" ? (
            copy.missingBinding
          ) : performanceUnavailable.reason === "sample-origin-missing" ? (
            copy.missingSamples
          ) : performanceUnavailable.reason === "soundfont-origin-missing" ? (
            copy.missingSoundfont
          ) : (
            <span lang="en">{performanceUnavailable.message}</span>
          )}
        </p>
      ) : null}
      {selectionStatus ? (
        <p className="refrain-renderer__notice" role="status">
          {selectionStatus.key ? copy[selectionStatus.key] : null}{" "}
          {selectionStatus.detail}
        </p>
      ) : null}
      {exportStatus ? (
        <p className="refrain-renderer__notice" role="status">
          {exportStatus.key ? copy[exportStatus.key] : null}{" "}
          {exportStatus.detail}
        </p>
      ) : null}
      {!performanceUnavailable ? (
        <span className="refrain-renderer__live" aria-live="polite">
          {copy.player[playerState]}
        </span>
      ) : null}
    </div>
  );
}
