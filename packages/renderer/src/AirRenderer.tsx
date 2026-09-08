import { useEffect, useMemo, useRef, useState } from "react";
import { stringifyAnyAir } from "@refrain/air-schema/any";
import type { BrowserAudioEngine } from "@refrain/audio-engine/browser";
import type {
  CompletePieceBrowserEngine,
  PlaybackEvidenceV0,
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
import type {
  DownloadArtifact,
  DownloadArtifactOutcome,
  RefrainRendererProps,
} from "./types.js";
import { buildStructureViewModel } from "./view-model.js";

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
  visualTheme = "paper-sonata",
  initialLocale,
  onLocaleChange,
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
  const [selectedTheme, setSelectedTheme] = useState(visualTheme);
  useEffect(() => setSelectedTheme(visualTheme), [visualTheme]);
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
  const stopStateTimer = useRef<number | undefined>(undefined);
  const actionGeneration = useRef(0);
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

  useEffect(() => {
    disposed.current = false;
    // React StrictMode deliberately runs setup -> cleanup -> setup once in
    // development. The cleanup disposes the identity slot, so the second
    // setup must reactivate that same identity before the first user gesture.
    void engineSlot.current!.replace(artifactIdentity);
    return () => {
      disposed.current = true;
      actionGeneration.current += 1;
      if (stopStateTimer.current !== undefined)
        window.clearTimeout(stopStateTimer.current);
      unsubscribeTransport.current?.();
      unsubscribeTransport.current = undefined;
      void engineSlot.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (renderedArtifactIdentity.current === artifactIdentity) return;
    renderedArtifactIdentity.current = artifactIdentity;
    actionGeneration.current += 1;
    if (stopStateTimer.current !== undefined) {
      window.clearTimeout(stopStateTimer.current);
      stopStateTimer.current = undefined;
    }
    unsubscribeTransport.current?.();
    unsubscribeTransport.current = undefined;
    void engineSlot.current!.replace(artifactIdentity);
    setPlayerState("idle");
    setTransportSeconds(0);
    setTransportDurationSeconds(artifact.compiled.durationSeconds);
    setPlaybackEvidence(undefined);
    setPlayerError(undefined);
    setSelectedAnchor(undefined);
    setSelectionStatus(undefined);
    setExportStatus(undefined);
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
    try {
      const audio = await getEngine();
      if (generation !== actionGeneration.current || disposed.current) return;
      setPlayerState("preparing");
      if (completePieceEngine(audio)) {
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
      if (generation !== actionGeneration.current || disposed.current) return;
      setPlayerState("error");
      setPlayerError(
        cause instanceof Error ? cause.message : "Audio playback failed.",
      );
    }
  };

  const stopCompletePiece = () => {
    actionGeneration.current += 1;
    const currentEngine = engineSlot.current!.current(artifactIdentity);
    currentEngine?.stop();
    setTransportSeconds(0);
    setPlayerState(currentEngine ? "ready" : "idle");
  };

  const restartCompletePiece = async () => {
    const generation = actionGeneration.current + 1;
    actionGeneration.current = generation;
    setTransportSeconds(0);
    const currentEngine = engineSlot.current!.current(artifactIdentity);
    if (!currentEngine) return;
    if (!completePieceEngine(currentEngine)) {
      currentEngine.stop();
      setPlayerState("ready");
      return;
    }
    try {
      setPlayerState("preparing");
      await currentEngine.restart();
      if (generation === actionGeneration.current && !disposed.current)
        setPlayerState("playing");
    } catch (cause) {
      if (generation !== actionGeneration.current || disposed.current) return;
      setPlayerState("error");
      setPlayerError(
        cause instanceof Error ? cause.message : "Restart failed.",
      );
    }
  };

  const seekCompletePiece = async (seconds: number) => {
    const generation = actionGeneration.current + 1;
    actionGeneration.current = generation;
    setTransportSeconds(seconds);
    if (!isCompletePiece) return;
    const slot = engineSlot.current!;
    const currentEngine = slot.current(artifactIdentity);
    const pendingEngine = currentEngine
      ? undefined
      : slot.pending(artifactIdentity);
    if (!currentEngine && !pendingEngine) return;
    try {
      setPlayerState("preparing");
      const audio = currentEngine ?? (await pendingEngine!);
      if (generation !== actionGeneration.current || disposed.current) return;
      if (!completePieceEngine(audio)) return;
      await audio.seek(seconds);
    } catch (cause) {
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
      <SelenV21Canvas
        artifactIdentity={artifactIdentity}
        locale={locale}
        callbacks={{
          onLocaleChange: (next) => {
            setLocale(next);
            onLocaleChange?.(next);
          },
          onThemeChange: setSelectedTheme,
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
        selectionOptions={selectionOptions}
        selectedAnchor={selectedAnchor}
        surface={surface}
        themeId={selectedTheme}
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
