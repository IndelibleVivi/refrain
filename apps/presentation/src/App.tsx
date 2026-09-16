import { useEffect, useMemo, useRef, useState } from "react";
import {
  AirRenderer,
  LanguageSwitch,
  useRefrainLocale,
  uiCopy,
  decodeInlinePresentationRef,
  parseArtifactBytes,
  PRESENTATION_REF_FORMAT,
  REFRAIN_ARTIFACT_MEDIA_TYPE,
  parseSharedAppearance,
  type AnyAirArtifact,
  type SelenV21ThemeId,
  type UiMessageKey,
} from "@refrain/renderer";
import { portableArtifactForView } from "@refrain/renderer/artifact-document";
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
  type QueueDecision,
} from "./playback-queue.js";
import {
  parsePlayerPlaylist,
  parsePlayerPlaylistBytes,
  stringifyPlayerPlaylist,
  type PlayerPlaylist,
  type PlayerPlaylistEntry,
} from "./player-playlist.js";

const MODE_KEY = "refrain:playback-mode@0";
const MODE_ICONS: Record<PlaybackMode, string> = {
  sequential: "→",
  "repeat-all": "↻",
  shuffle: "⤨",
  "repeat-one": "↻¹",
};
function storedMode(): PlaybackMode {
  try {
    return readPlaybackMode(localStorage.getItem(MODE_KEY));
  } catch {
    return "sequential";
  }
}
function requestedPresentation(): PlayerPlaylistEntry["presentation"] {
  const params = new URL(location.href).searchParams;
  const theme = params.get("theme");
  const appearance = parseSharedAppearance(params);
  if (!theme && !appearance) return undefined;
  return {
    theme: ["paper-sonata", "prism", "nocturne-ink", "herbarium"].includes(
      theme ?? "",
    )
      ? (theme as SelenV21ThemeId)
      : "paper-sonata",
    ...(appearance ? { appearance } : {}),
  };
}
function publicPlayerUrl(): string | undefined {
  const configured = import.meta.env.VITE_REFRAIN_PUBLIC_PLAYER_URL?.trim();
  if (configured) return configured;
  if (import.meta.env.MODE !== "try") return undefined;
  return location.protocol === "https:"
    ? new URL(".", location.href).href
    : "https://indeliblevivi.github.io/refrain/";
}
function entryForView(
  view: AnyAirArtifact,
  id: string = crypto.randomUUID(),
): PlayerPlaylistEntry {
  return {
    id,
    artifact: portableArtifactForView(view),
    ...(view.performanceBinding
      ? { bindingId: view.performanceBinding.id }
      : {}),
  };
}
function demoPlaylist(): PlayerPlaylist {
  return {
    format: "refrain-playlist@0-experimental",
    title: "First airs",
    entries: demoWorks.map((work) => {
      const result = firstAir(work.id);
      if (!result.ok) throw new Error(result.message);
      return {
        ...entryForView(result.artifact, work.id),
        presentation: { theme: "paper-sonata" },
      };
    }),
  };
}

export function App() {
  const [locale, setLocale] = useRefrainLocale();
  const copy = uiCopy(locale),
    welcome = firstListenCopy(locale),
    words = welcome.player;
  const revision = useRef(0),
    sequence = useRef(0);
  const queue = useRef<PlaybackQueue | undefined>(undefined);
  if (!queue.current)
    queue.current = new PlaybackQueue([], { mode: storedMode() });
  const [snapshot, setSnapshot] = useState(() => queue.current!.snapshot());
  const [playlist, setPlaylist] = useState<PlayerPlaylist>({
    format: "refrain-playlist@0-experimental",
    title: "",
    entries: [],
  });
  const playlistRef = useRef(playlist);
  playlistRef.current = playlist;
  const [artifact, setArtifact] = useState<AnyAirArtifact>();
  const [playbackCommand, setPlaybackCommand] = useState<{
    requestId: number;
    action: "start-at-zero";
    receiptId: string;
  }>();
  const [firstListen, setFirstListen] = useState(false);
  const [listOpen, setListOpen] = useState(() => window.innerWidth > 850),
    [helpOpen, setHelpOpen] = useState(false);
  const [fileError, setFileError] = useState<string>();
  const [copyStatus, setCopyStatus] = useState<"copied" | "manual">();
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
  const activeEntry = playlist.entries.find(
    (entry) => entry.id === snapshot.currentId,
  );

  const activate = (entry: PlayerPlaylistEntry | undefined, start = false) => {
    setPlaybackCommand(undefined);
    if (!entry) {
      setArtifact(undefined);
      setMessage({ key: "noAir" });
      return;
    }
    const result = verifyArtifactForPresentation(
      entry.artifact,
      entry.bindingId,
    );
    if (!result.ok) {
      setFileError(result.message);
      return;
    }
    setArtifact(result.artifact);
    if (start)
      setPlaybackCommand({
        requestId: ++sequence.current,
        action: "start-at-zero",
        receiptId: result.artifact.receipt.receiptId,
      });
  };
  const installPlaylist = (next: PlayerPlaylist) => {
    playlistRef.current = next;
    setPlaylist(next);
    queue.current!.replaceEntries(
      next.entries.map((entry) => entry.id),
      next.currentEntryId ?? next.entries[0]?.id,
    );
    const state = queue.current!.snapshot();
    setSnapshot(state);
    activate(next.entries.find((entry) => entry.id === state.currentId));
  };
  const choose = (id: string) => {
    ++revision.current;
    queue.current!.select(id);
    setSnapshot(queue.current!.snapshot());
    activate(playlistRef.current.entries.find((entry) => entry.id === id));
    setFileError(undefined);
    if (window.innerWidth <= 850) setListOpen(false);
  };
  const applyDecision = (decision: QueueDecision) => {
    setSnapshot(queue.current!.snapshot());
    if (decision.kind !== "stop")
      activate(
        playlistRef.current.entries.find(
          (entry) => entry.id === decision.entryId,
        ),
        true,
      );
  };
  const cycleMode = () => {
    const mode = queue.current!.cycleMode();
    setSnapshot(queue.current!.snapshot());
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* Preferences are optional. */
    }
  };
  const updateEntries = (entries: PlayerPlaylistEntry[]) => {
    const previous = queue.current!.snapshot().currentId;
    const { currentEntryId: _current, ...base } = playlistRef.current;
    const next = { ...base, entries };
    playlistRef.current = next;
    setPlaylist(next);
    queue.current!.replaceEntries(entries.map((entry) => entry.id));
    const state = queue.current!.snapshot();
    setSnapshot(state);
    if (previous !== state.currentId)
      activate(entries.find((entry) => entry.id === state.currentId));
  };
  const move = (index: number, offset: number) => {
    const entries = [...playlistRef.current.entries],
      target = index + offset;
    if (target < 0 || target >= entries.length) return;
    [entries[index], entries[target]] = [entries[target]!, entries[index]!];
    updateEntries(entries);
  };

  useEffect(() => {
    let active = true;
    const loadLocation = async () => {
      const request = ++revision.current,
        url = new URL(location.href);
      const hash = new URLSearchParams(url.hash.slice(1));
      setArtifact(undefined);
      setFileError(undefined);
      setMessage({ key: "loadingAir" });
      const apply = (next: PlayerPlaylist) => {
        if (active && request === revision.current) installPlaylist(next);
      };
      try {
        const catalog = url.searchParams.get("catalog"),
          catalogHash = url.searchParams.get("artifact");
        const sessionHref = url.searchParams.get("sessionHref"),
          playlistHref = url.searchParams.get("playlistHref");
        const binding = url.searchParams.get("binding") ?? undefined;
        const root =
          !url.hash &&
          !catalog &&
          !catalogHash &&
          !sessionHref &&
          !playlistHref;
        setFirstListen(root);
        if (root) {
          apply(demoPlaylist());
          return;
        }
        if (playlistHref) {
          const endpoint = new URL(playlistHref, url);
          if (endpoint.origin !== url.origin)
            throw new Error("Playlist delivery must use this Player’s origin.");
          const response = await fetch(endpoint, { cache: "no-store" });
          if (!response.ok)
            throw new Error(
              "Playlist unavailable (HTTP " + response.status + ").",
            );
          const parsed = parsePlayerPlaylistBytes(
            new Uint8Array(await response.arrayBuffer()),
            hash.get("playlist") ?? "",
          );
          if (!parsed.ok) throw new Error(parsed.message);
          apply(parsed.playlist);
          return;
        }
        const load = async () => {
          if (catalog || catalogHash)
            return publishedDemoAir(catalog ?? "", catalogHash ?? "", binding);
          const digest = hash.get("artifact"),
            fragment = hash.get("bytes");
          if (digest && fragment) {
            const decoded = decodeInlinePresentationRef({
              format: PRESENTATION_REF_FORMAT,
              artifactSha256: digest,
              mediaType: REFRAIN_ARTIFACT_MEDIA_TYPE,
              delivery: { kind: "inline", fragment },
            });
            return decoded.ok
              ? verifyArtifactForPresentation(decoded.artifact, binding)
              : decoded;
          }
          if (sessionHref && digest) {
            const endpoint = new URL(sessionHref, url);
            if (endpoint.origin !== url.origin)
              throw new Error(
                "Artifact delivery must use this Player’s origin.",
              );
            const response = await fetch(endpoint, { cache: "no-store" });
            if (!response.ok)
              return {
                ok: false as const,
                message: "HTTP " + response.status,
                messageKey: "sessionUnavailable" as const,
              };
            const parsed = parseArtifactBytes(
              new Uint8Array(await response.arrayBuffer()),
              digest,
            );
            return parsed.ok
              ? verifyArtifactForPresentation(parsed.artifact, binding)
              : parsed;
          }
          const decoded = decodePresentationHash(url.hash);
          return decoded
            ? verifyPresentationEnvelope(decoded)
            : { ok: false as const, message: "", messageKey: "noAir" as const };
        };
        const result = await load();
        if (!active || request !== revision.current) return;
        if (result.ok)
          apply({
            format: "refrain-playlist@0-experimental",
            title: result.artifact.source.title,
            entries: [
              {
                ...entryForView(result.artifact),
                ...(requestedPresentation()
                  ? { presentation: requestedPresentation() }
                  : {}),
              },
            ],
          });
        else
          setMessage({
            key: "messageKey" in result ? result.messageKey : "invalidFile",
            detail: result.message,
          });
      } catch (cause) {
        if (active && request === revision.current)
          setMessage({
            key: "invalidFile",
            detail: cause instanceof Error ? cause.message : String(cause),
          });
      }
    };
    void loadLocation();
    window.addEventListener("hashchange", loadLocation);
    return () => {
      active = false;
      window.removeEventListener("hashchange", loadLocation);
    };
  }, []);

  const openFiles = async (files: File[]) => {
    const request = ++revision.current;
    setFileError(undefined);
    try {
      const values: unknown[] = await Promise.all(
        files.map(async (file) => JSON.parse(await file.text()) as unknown),
      );
      if (request !== revision.current) return;
      if (
        values.length === 1 &&
        (values[0] as { format?: string })?.format ===
          "refrain-playlist@0-experimental"
      ) {
        const parsed = parsePlayerPlaylist(values[0]);
        if (!parsed.ok) throw new Error(parsed.message);
        installPlaylist(parsed.playlist);
      } else {
        const added = values.map((value) => {
          const result = verifyArtifactForPresentation(value);
          if (!result.ok) throw new Error(result.message);
          return entryForView(result.artifact);
        });
        const parsed = parsePlayerPlaylist({
          ...playlistRef.current,
          entries: [...playlistRef.current.entries, ...added],
          currentEntryId: added[0]?.id,
        });
        if (!parsed.ok) throw new Error(parsed.message);
        installPlaylist(parsed.playlist);
      }
      setFirstListen(false);
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : "Invalid JSON");
    }
  };
  const savePlaylist = () => {
    const { currentEntryId: _current, ...base } = playlist;
    const text = stringifyPlayerPlaylist({
      ...base,
      ...(snapshot.currentId ? { currentEntryId: snapshot.currentId } : {}),
    });
    const url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      (playlist.title.replace(/[^\p{L}\p{N}._-]+/gu, "-") || "playlist") +
      ".refrain-playlist.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  const fileInput = (
    <label className="player-file">
      ＋ {words.add}
      <input
        accept=".json,.refrain.json,application/json,application/vnd.refrain+json"
        aria-label={welcome.open}
        multiple
        type="file"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          if (files.length) void openFiles(files);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );

  return (
    <main className="presentation-shell" lang={locale}>
      <header className="player-masthead">
        <div className="player-wordmark">
          Refrain <span>hums an air.</span>
        </div>
        <nav aria-label={words.player}>
          <button
            type="button"
            aria-expanded={listOpen}
            aria-controls="player-playlist"
            onClick={() => setListOpen(!listOpen)}
          >
            {words.playlist} <span>{playlist.entries.length}</span>
          </button>
          <button
            type="button"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen(!helpOpen)}
          >
            {words.help}
          </button>
        </nav>
      </header>
      {firstListen ? <p className="player-welcome">{words.welcome}</p> : null}
      <div className="player-layout" data-list-open={listOpen}>
        <aside
          className="player-playlist"
          id="player-playlist"
          aria-label={words.playlist}
        >
          <div className="player-list-heading">
            <span>{words.playlist}</span>
            <span>{String(playlist.entries.length).padStart(2, "0")}</span>
          </div>
          <input
            className="player-list-title"
            aria-label={words.title}
            maxLength={200}
            placeholder={words.untitled}
            value={playlist.title}
            onChange={(event) =>
              setPlaylist({ ...playlist, title: event.currentTarget.value })
            }
          />
          <ol>
            {playlist.entries.map((entry, index) => (
              <li key={entry.id} data-current={entry.id === snapshot.currentId}>
                <button
                  className="player-entry"
                  type="button"
                  aria-label={entry.artifact.source.title}
                  aria-current={
                    entry.id === snapshot.currentId ? "true" : undefined
                  }
                  onClick={() => choose(entry.id)}
                >
                  <span className="player-entry-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{entry.artifact.source.title}</span>
                </button>
                <div className="player-entry-actions">
                  <button
                    type="button"
                    disabled={index === 0}
                    aria-label={words.up + " · " + entry.artifact.source.title}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === playlist.entries.length - 1}
                    aria-label={
                      words.down + " · " + entry.artifact.source.title
                    }
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={
                      words.remove + " · " + entry.artifact.source.title
                    }
                    onClick={() =>
                      updateEntries(
                        playlist.entries.filter((item) => item.id !== entry.id),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {!playlist.entries.length ? <p>{words.empty}</p> : null}
          <div className="player-list-actions">
            {fileInput}
            <button type="button" onClick={savePlaylist}>
              {words.save}
            </button>
          </div>
          <p className="player-local-note">{words.local}</p>
        </aside>
        <section className="player-stage" aria-label={words.player}>
          {fileError ? (
            <p role="alert" className="player-error">
              {copy.invalidFile} <span lang="en">{fileError}</span>
            </p>
          ) : null}
          {artifact ? (
            <>
              <div className="player-queue-controls">
                <div>
                  <button
                    type="button"
                    aria-label={words.previous}
                    onClick={() => applyDecision(queue.current!.previous())}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    aria-label={words.next}
                    onClick={() => applyDecision(queue.current!.next("next"))}
                    disabled={
                      snapshot.mode === "sequential" &&
                      snapshot.currentId === snapshot.entries.at(-1)
                    }
                  >
                    →
                  </button>
                  <span>
                    {snapshot.entries.indexOf(snapshot.currentId ?? "") + 1} /{" "}
                    {snapshot.entries.length}
                  </span>
                </div>
                <button
                  type="button"
                  data-playback-mode={snapshot.mode}
                  aria-label={welcome.changePlaybackMode(
                    welcome.playbackModes[snapshot.mode],
                    welcome.playbackModes[cyclePlaybackMode(snapshot.mode)],
                  )}
                  onClick={cycleMode}
                >
                  <span aria-hidden="true">{MODE_ICONS[snapshot.mode]}</span>{" "}
                  {welcome.playbackModes[snapshot.mode]}
                </button>
              </div>
              <AirRenderer
                key={activeEntry?.id}
                initialLocale={locale}
                onLocaleChange={setLocale}
                artifact={artifact}
                assets={
                  firstListen || import.meta.env.MODE === "try"
                    ? hasDemoSound(artifact)
                      ? { assetBaseUrl: new URL(".", location.href).href }
                      : {}
                    : {
                        soundBankUrl: "/soundpacks/GeneralUser-GS.sf2",
                        assetBaseUrl: "",
                        workletUrl: "/spessasynth_processor.min.js",
                      }
                }
                surface="url"
                visualTheme={activeEntry?.presentation?.theme}
                visualAppearance={activeEntry?.presentation?.appearance}
                playbackCommand={playbackCommand}
                onPlaybackEnded={() =>
                  applyDecision(queue.current!.next("ended"))
                }
                shareDeployment={shareDeployment}
                onAuditionBindingChange={(bindingId) =>
                  setPlaylist((current) => ({
                    ...current,
                    entries: current.entries.map((entry) =>
                      entry.id === snapshot.currentId
                        ? { ...entry, bindingId }
                        : entry,
                    ),
                  }))
                }
              />
            </>
          ) : (
            <div className="presentation-message">
              <LanguageSwitch locale={locale} onChange={setLocale} />
              <h1>{copy[message.key]}</h1>
              {message.detail ? <p>{message.detail}</p> : null}
              <p>{words.empty}</p>
              <button type="button" onClick={() => setListOpen(true)}>
                {words.playlist}
              </button>
            </div>
          )}
        </section>
      </div>
      {helpOpen ? (
        <section className="player-help">
          <h2>{welcome.next}</h2>
          <p>{welcome.nextBody}</p>
          <a
            href="https://github.com/IndelibleVivi/refrain/blob/main/docs/GETTING-STARTED.md"
            target="_blank"
            rel="noreferrer"
          >
            {welcome.guide} ↗
          </a>
          <details>
            <summary>{welcome.promptLabel}</summary>
            <blockquote>{welcome.prompt}</blockquote>
            <button
              type="button"
              onClick={() => {
                if (!navigator.clipboard) setCopyStatus("manual");
                else
                  void navigator.clipboard.writeText(welcome.prompt).then(
                    () => setCopyStatus("copied"),
                    () => setCopyStatus("manual"),
                  );
              }}
            >
              {welcome.copy}
            </button>
            <p role="status">{copyStatus ? welcome[copyStatus] : ""}</p>
          </details>
          <p>{welcome.local}</p>
          <button
            type="button"
            onClick={() => {
              ++revision.current;
              setFileError(undefined);
              installPlaylist(demoPlaylist());
              setFirstListen(true);
            }}
          >
            {words.examples}
          </button>
        </section>
      ) : null}
      <footer className="player-footer">{words.footer}</footer>
    </main>
  );
}
