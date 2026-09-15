import { useEffect, useMemo, useRef, useState } from "react";
import type { AnyAirArtifact, SelenV21ThemeId } from "@refrain/renderer";
import {
  AirRenderer,
  LanguageSwitch,
  useRefrainLocale,
  uiCopy,
  type UiMessageKey,
  decodeInlinePresentationRef,
  parseArtifactBytes,
  PRESENTATION_REF_FORMAT,
  REFRAIN_ARTIFACT_MEDIA_TYPE,
  type PresentationRefV0,
  parseSharedAppearance,
} from "@refrain/renderer";
import {
  decodePresentationHash,
  verifyArtifactForPresentation,
  verifyPresentationEnvelope,
} from "./presentation-envelope.js";
import {
  demoPublishedArtifacts,
  demoShareRecipient,
  demoWorks,
  firstAir,
  hasDemoSound,
  publishedDemoAir,
} from "./first-air.js";
import { firstListenCopy } from "./first-listen-copy.js";
import {
  PlaybackQueue,
  cyclePlaybackMode,
  readPlaybackMode,
  type PlaybackMode,
} from "./playback-queue.js";

const VISUAL_THEMES = new Set<SelenV21ThemeId>([
  "paper-sonata",
  "prism",
  "nocturne-ink",
  "herbarium",
]);
const PLAYBACK_MODE_STORAGE_KEY = "refrain:playback-mode@0";
const DEFAULT_TRY_PUBLIC_PLAYER_URL =
  "https://indeliblevivi.github.io/refrain/";
const PLAYBACK_MODE_ICONS: Record<PlaybackMode, string> = {
  sequential: "→",
  "repeat-all": "↻",
  shuffle: "⤨",
  "repeat-one": "↻¹",
};

function storedPlaybackMode(): PlaybackMode {
  try {
    return readPlaybackMode(
      window.localStorage.getItem(PLAYBACK_MODE_STORAGE_KEY),
    );
  } catch {
    return "sequential";
  }
}

function requestedVisualTheme(): SelenV21ThemeId | undefined {
  const requested = new URL(window.location.href).searchParams.get("theme");
  return requested && VISUAL_THEMES.has(requested as SelenV21ThemeId)
    ? (requested as SelenV21ThemeId)
    : undefined;
}

function publicPlayerUrl(): string | undefined {
  const configured = import.meta.env.VITE_REFRAIN_PUBLIC_PLAYER_URL?.trim();
  if (configured) return configured;
  const current = new URL(window.location.href);
  if (import.meta.env.MODE !== "try") return undefined;
  return current.protocol === "https:"
    ? new URL(".", current).href
    : DEFAULT_TRY_PUBLIC_PLAYER_URL;
}

export function App() {
  const [locale, setLocale] = useRefrainLocale();
  const copy = uiCopy(locale);
  const welcome = firstListenCopy(locale);
  const [firstListen, setFirstListen] = useState(false);
  const [fileError, setFileError] = useState<string>();
  const [copyStatus, setCopyStatus] = useState<"copied" | "manual">();
  const revision = useRef(0);
  const playbackCommandSequence = useRef(0);
  const queue = useRef<PlaybackQueue | undefined>(undefined);
  if (!queue.current)
    queue.current = new PlaybackQueue(
      demoWorks.map((work) => work.id),
      { mode: storedPlaybackMode() },
    );
  const [queueSnapshot, setQueueSnapshot] = useState(() =>
    queue.current!.snapshot(),
  );
  const [activeDemoId, setActiveDemoId] = useState<string>();
  const activeDemoIdRef = useRef<string | undefined>(undefined);
  const [playbackCommand, setPlaybackCommand] = useState<{
    requestId: number;
    action: "start-at-zero";
    receiptId: string;
  }>();
  const [artifact, setArtifact] = useState<AnyAirArtifact>();
  const [message, setMessage] = useState<{
    key: UiMessageKey;
    detail?: string;
  }>({ key: "loadingAir" });
  const shareDeployment = useMemo(
    () => ({
      playerBaseUrl: publicPlayerUrl(),
      recipient: demoShareRecipient,
      publishedArtifacts: demoPublishedArtifacts,
    }),
    [],
  );

  const activateDemo = (id: string) => {
    const result = firstAir(id);
    if (!result.ok) return;
    activeDemoIdRef.current = id;
    setActiveDemoId(id);
    setPlaybackCommand(undefined);
    setArtifact(result.artifact);
    setFileError(undefined);
  };

  const chooseDemo = (id: string) => {
    revision.current += 1;
    queue.current!.select(id);
    setQueueSnapshot(queue.current!.snapshot());
    activateDemo(id);
  };

  const resetDemoQueue = (id = demoWorks[0]!.id) => {
    revision.current += 1;
    queue.current!.replaceEntries(
      demoWorks.map((work) => work.id),
      id,
    );
    setQueueSnapshot(queue.current!.snapshot());
    activateDemo(id);
  };

  const cycleMode = () => {
    const next = queue.current!.cycleMode();
    setQueueSnapshot(queue.current!.snapshot());
    try {
      window.localStorage.setItem(PLAYBACK_MODE_STORAGE_KEY, next);
    } catch {
      // A denied preference write does not block playback.
    }
  };

  const continueQueue = () => {
    const currentId = activeDemoIdRef.current;
    if (!currentId || queue.current!.snapshot().currentId !== currentId) return;
    const decision = queue.current!.next("ended");
    setQueueSnapshot(queue.current!.snapshot());
    if (decision.kind === "stop") return;
    const result = firstAir(decision.entryId);
    if (!result.ok) return;
    activeDemoIdRef.current = decision.entryId;
    setActiveDemoId(decision.entryId);
    setArtifact(result.artifact);
    setPlaybackCommand({
      requestId: ++playbackCommandSequence.current,
      action: "start-at-zero",
      receiptId: result.artifact.receipt.receiptId,
    });
  };

  useEffect(() => {
    let active = true;
    const loadHash = () => {
      const requestedRevision = ++revision.current;
      setArtifact(undefined);
      setFileError(undefined);
      setMessage({ key: "loadingAir" });
      const location = new URL(window.location.href);
      const catalogId = location.searchParams.get("catalog");
      const catalogArtifactSha256 = location.searchParams.get("artifact");
      const isFirstListen =
        !window.location.hash &&
        !location.searchParams.get("sessionHref") &&
        !catalogId &&
        !catalogArtifactSha256;
      setFirstListen(isFirstListen);
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const artifactSha256 = hash.get("artifact");
      const fragment = hash.get("bytes");
      const sessionHref = location.searchParams.get("sessionHref");
      const bindingId = location.searchParams.get("binding");
      const load = async () => {
        if (isFirstListen) return firstAir();
        if (catalogId || catalogArtifactSha256)
          return publishedDemoAir(
            catalogId ?? "",
            catalogArtifactSha256 ?? "",
            bindingId ?? undefined,
          );
        if (artifactSha256 && fragment) {
          const ref: PresentationRefV0 = {
            format: PRESENTATION_REF_FORMAT,
            artifactSha256,
            mediaType: REFRAIN_ARTIFACT_MEDIA_TYPE,
            delivery: { kind: "inline", fragment },
          };
          const decoded = decodeInlinePresentationRef(ref);
          return decoded.ok
            ? verifyArtifactForPresentation(
                decoded.artifact,
                bindingId ?? undefined,
              )
            : decoded;
        }
        if (sessionHref && artifactSha256) {
          const response = await fetch(sessionHref, { cache: "no-store" });
          if (!response.ok) {
            let reason = `HTTP ${response.status}`;
            try {
              const body = (await response.json()) as { reason?: unknown };
              if (typeof body.reason === "string") reason = body.reason;
            } catch {
              // The typed status is optional when an intermediary replaced it.
            }
            return {
              ok: false as const,
              message: reason,
              messageKey: "sessionUnavailable" as const,
            };
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          const parsed = parseArtifactBytes(bytes, artifactSha256);
          return parsed.ok
            ? verifyArtifactForPresentation(
                parsed.artifact,
                bindingId ?? undefined,
              )
            : parsed;
        }
        const decoded = decodePresentationHash(window.location.hash);
        if (decoded) return verifyPresentationEnvelope(decoded);
        return {
          ok: false as const,
          message: "",
          messageKey: "noAir" as const,
        };
      };
      void load()
        .then((result) => {
          if (!active || requestedRevision !== revision.current) return;
          if (result.ok) {
            if (isFirstListen) resetDemoQueue();
            else {
              activeDemoIdRef.current = undefined;
              setActiveDemoId(undefined);
              queue.current!.replaceEntries([]);
              setQueueSnapshot(queue.current!.snapshot());
              setPlaybackCommand(undefined);
              setArtifact(result.artifact);
            }
          } else
            setMessage({
              key: "messageKey" in result ? result.messageKey : "invalidFile",
              detail: result.message,
            });
        })
        .catch((cause: unknown) => {
          if (active && requestedRevision === revision.current)
            setMessage({
              key: "invalidFile",
              detail: cause instanceof Error ? cause.message : undefined,
            });
        });
    };
    loadHash();
    window.addEventListener("hashchange", loadHash);
    return () => {
      active = false;
      window.removeEventListener("hashchange", loadHash);
    };
  }, []);

  const openFile = async (file: File) => {
    const requestedRevision = ++revision.current;
    setFileError(undefined);
    try {
      const result = verifyArtifactForPresentation(
        JSON.parse(await file.text()),
      );
      if (requestedRevision !== revision.current) return;
      if (result.ok) {
        activeDemoIdRef.current = undefined;
        setActiveDemoId(undefined);
        queue.current!.replaceEntries([]);
        setQueueSnapshot(queue.current!.snapshot());
        setPlaybackCommand(undefined);
        setArtifact(result.artifact);
      } else setFileError(result.message);
    } catch (cause) {
      if (requestedRevision === revision.current)
        setFileError(cause instanceof Error ? cause.message : "Invalid JSON");
    }
  };
  const fileInput = (
    <label className="first-listen-file">
      {firstListen ? welcome.open : copy.openFile}
      <input
        accept=".json,.refrain.json,application/json,application/vnd.refrain+json"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void openFile(file);
          event.currentTarget.value = "";
        }}
        type="file"
      />
    </label>
  );
  const error = fileError ? (
    <p role="alert">
      {copy.invalidFile} <span lang="en">{fileError}</span>
    </p>
  ) : null;

  if (!artifact) {
    return (
      <main className="presentation-message" lang={locale}>
        <LanguageSwitch locale={locale} onChange={setLocale} />
        <p>Refrain hums an air.</p>
        <h1>{copy[message.key]}</h1>
        {message.detail ? <p lang="en">{message.detail}</p> : null}
        <p>
          {copy.openCommand}{" "}
          <code>node bin/refrain.mjs open path/to/file.air.json</code>
        </p>
        {fileInput}
        {error}
      </main>
    );
  }
  return (
    <main className="presentation-shell" lang={locale}>
      {firstListen ? (
        <header className="first-listen-intro">
          <p className="first-listen-mark">
            Refrain hums an air. <span>{welcome.label}</span>
          </p>
          <h1>{welcome.title}</h1>
          <p>{welcome.intro}</p>
          <div
            className="first-listen-works"
            aria-label={locale === "zh-CN" ? "选择作品" : "Choose a work"}
          >
            {demoWorks.map((work) => (
              <button
                type="button"
                key={work.id}
                aria-current={activeDemoId === work.id ? "true" : undefined}
                onClick={() => chooseDemo(work.id)}
              >
                {work.title}
              </button>
            ))}
          </div>
          <div className="first-listen-playlist-mode">
            <span>{welcome.playlist}</span>
            <button
              type="button"
              data-playback-mode={queueSnapshot.mode}
              aria-label={welcome.changePlaybackMode(
                welcome.playbackModes[queueSnapshot.mode],
                welcome.playbackModes[cyclePlaybackMode(queueSnapshot.mode)],
              )}
              title={welcome.playbackModes[queueSnapshot.mode]}
              onClick={cycleMode}
            >
              <span aria-hidden="true">
                {PLAYBACK_MODE_ICONS[queueSnapshot.mode]}
              </span>
              {welcome.playbackModes[queueSnapshot.mode]}
            </button>
          </div>
        </header>
      ) : null}
      <AirRenderer
        initialLocale={locale}
        onLocaleChange={setLocale}
        artifact={artifact}
        assets={
          firstListen || import.meta.env.MODE === "try"
            ? hasDemoSound(artifact)
              ? { assetBaseUrl: new URL(".", window.location.href).href }
              : {}
            : {
                soundBankUrl: "/soundpacks/GeneralUser-GS.sf2",
                assetBaseUrl: "",
                workletUrl: "/spessasynth_processor.min.js",
              }
        }
        surface="url"
        visualTheme={requestedVisualTheme()}
        visualAppearance={parseSharedAppearance(
          new URL(window.location.href).searchParams,
        )}
        playbackCommand={playbackCommand}
        onPlaybackEnded={continueQueue}
        shareDeployment={shareDeployment}
      />
      {firstListen ? (
        <footer className="first-listen-next">
          <section className="first-listen-keep">
            <h2>{welcome.keep}</h2>
            <p>{welcome.keepBody}</p>
            {fileInput}
            <button
              type="button"
              onClick={() => {
                ++revision.current;
                resetDemoQueue();
              }}
            >
              {welcome.reset}
            </button>
            {error}
            <p className="first-listen-note">{welcome.local}</p>
          </section>
          <section>
            <h2>{welcome.next}</h2>
            <p>{welcome.nextBody}</p>
            <a
              href="https://github.com/IndelibleVivi/refrain/blob/main/docs/MCP.md"
              target="_blank"
              rel="noreferrer"
            >
              {welcome.guide} ↗
            </a>
            <details className="first-listen-prompt">
              <summary>{welcome.promptLabel}</summary>
              <blockquote>{welcome.prompt}</blockquote>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(welcome.prompt).then(
                    () => setCopyStatus("copied"),
                    () => setCopyStatus("manual"),
                  );
                  if (!navigator.clipboard) setCopyStatus("manual");
                }}
              >
                {welcome.copy}
              </button>
              <p role="status">{copyStatus ? welcome[copyStatus] : ""}</p>
            </details>
          </section>
        </footer>
      ) : null}
    </main>
  );
}
