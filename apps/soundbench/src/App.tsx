import {
  lazy,
  Suspense,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { canonicalAirJson } from "@refrain/air-schema";
import type {
  AudioEngineMode,
  BrowserAudioEngine,
} from "@refrain/audio-engine/browser";
import { createPerformancePlan } from "@refrain/audio-engine/performance";
import { compileAir, type CompiledAir } from "@refrain/compiler";
import {
  G3A_AUDITION_SOUND_PROFILE,
  DEFAULT_RENDER_SCENE,
  INSTRUMENTS,
  SOUND_REGISTRY,
  candidateById,
  candidatesForInstrument,
  createPerformanceBinding,
  soundProfileWithCandidates,
  type PerformanceBinding,
} from "@refrain/soundpack";
import returningHome from "../../../fixtures/valid/returning-home.air.json?raw";
import smallHours from "../../../fixtures/valid/small-hours.air.json?raw";
import playful from "../../../fixtures/valid/playful.air.json?raw";
import chamberReply from "../../../fixtures/valid/chamber-reply.air.json?raw";
import rainWindow from "../../../fixtures/valid/rain-window.air.json?raw";
import acousticEnsemble from "../../../fixtures/valid/acoustic-ensemble.air.json?raw";
import expressiveReturn from "../../../fixtures/valid/expressive-return.air.json?raw";
import sectionalReturn from "../../../fixtures/valid/sectional-return.air.json?raw";
import harshSynth from "../../../fixtures/negative-listening/harsh-synth-001.air.json?raw";
import warmPianoReference from "../../../fixtures/listening-candidates/warm-piano-reference.air.json?raw";
import harpReference from "../../../fixtures/listening-candidates/harp-reference.air.json?raw";
import marimbaReference from "../../../fixtures/listening-candidates/marimba-reference.air.json?raw";
import softPercussionReference from "../../../fixtures/listening-candidates/soft-percussion-reference.air.json?raw";
import chamberStringsLoopReference from "../../../fixtures/listening-candidates/chamber-strings-loop-reference.air.json?raw";
import verifiedVariation from "../../../fixtures/relationships/valid/verified-variation.json?raw";
import verifiedExtension from "../../../fixtures/relationships/valid/verified-extension.json?raw";
import falseVariation from "../../../fixtures/relationships/invalid/false-variation.json?raw";
import changedPrefix from "../../../fixtures/relationships/invalid/changed-prefix.json?raw";

const fixtures = [
  ["returning-home", returningHome],
  ["small-hours", smallHours],
  ["playful", playful],
  ["chamber-reply", chamberReply],
  ["rain-window", rainWindow],
  ["acoustic-ensemble", acousticEnsemble],
  ["expressive-return", expressiveReturn],
  ["sectional-return", sectionalReturn],
  ["warm-piano-reference", warmPianoReference],
  ["harp-reference", harpReference],
  ["marimba-reference", marimbaReference],
  ["soft-percussion-reference", softPercussionReference],
  ["chamber-strings-loop-reference", chamberStringsLoopReference],
  ["harsh-synth-001", harshSynth],
] as const;

const relationshipFixtures = [
  ["verified-variation", verifiedVariation],
  ["verified-extension", verifiedExtension],
  ["false-variation", falseVariation],
  ["changed-prefix", changedPrefix],
] as const;

const CompiledInspector = lazy(() => import("./CompiledInspector.js"));

type EngineState = "idle" | "loading" | "ready" | "playing" | "error";

export function App() {
  const [selected, setSelected] = useState<(typeof fixtures)[number][0]>(
    fixtures[0][0],
  );
  const [source, setSource] = useState(fixtures[0][1]);
  const [engineState, setEngineState] = useState<EngineState>("idle");
  const [engineError, setEngineError] = useState<string>();
  const [masterGain, setMasterGain] = useState(-9);
  const [forcedMode, setForcedMode] = useState<"auto" | AudioEngineMode>(
    "auto",
  );
  const [mutedVoices, setMutedVoices] = useState<Set<string>>(new Set());
  const [soloVoices, setSoloVoices] = useState<Set<string>>(new Set());
  const [candidateSelections, setCandidateSelections] = useState<
    Record<string, string>
  >({});
  const [playbackEvidence, setPlaybackEvidence] = useState<string>(
    "No browser playback measured yet.",
  );
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [metrics, setMetrics] = useState<{
    state: "idle" | "rendering" | "ready" | "error";
    peak?: number;
    firstSoundSeconds?: number;
    message?: string;
  }>({ state: "idle" });
  const [evidenceFixture, setEvidenceFixture] = useState<
    (typeof relationshipFixtures)[number][0]
  >(relationshipFixtures[0][0]);
  const engine = useRef<BrowserAudioEngine | undefined>(undefined);
  const result = useMemo(() => compileAir(source), [source]);
  const errors = result.diagnostics.filter((item) => item.severity === "error");
  const observations = result.diagnostics.filter(
    (item) => item.severity !== "error",
  );
  const selectedSoundProfile = useMemo(
    () =>
      soundProfileWithCandidates(
        G3A_AUDITION_SOUND_PROFILE,
        candidateSelections,
        "soundbench-current-selection",
      ),
    [candidateSelections],
  );
  const selectedPerformanceBinding = useMemo(
    () =>
      createPerformanceBinding({
        id: "soundbench-current@0",
        soundProfile: selectedSoundProfile,
        renderScene: DEFAULT_RENDER_SCENE,
        permittedOverrides: ["masterGainDb"],
        overrides:
          masterGain === DEFAULT_RENDER_SCENE.masterGainDb
            ? {}
            : { masterGainDb: masterGain },
      }),
    [masterGain, selectedSoundProfile],
  );
  const audibleCompiled = useMemo<CompiledAir | undefined>(() => {
    if (!result.compiled) return undefined;
    const soloing = soloVoices.size > 0;
    return {
      ...result.compiled,
      events: result.compiled.events.filter(
        (event) =>
          !mutedVoices.has(event.voiceId) &&
          (!soloing || soloVoices.has(event.voiceId)),
      ),
    };
  }, [result.compiled, mutedVoices, soloVoices]);

  const selectFixture = (name: (typeof fixtures)[number][0], text: string) => {
    engine.current?.stop();
    setEngineState(engine.current ? "ready" : "idle");
    setSelected(name);
    setSource(text);
    setMutedVoices(new Set());
    setSoloVoices(new Set());
    setMetrics({ state: "idle" });
    setPlaybackEvidence("No browser playback measured yet.");
    setInspectorOpen(false);
  };

  const getEngine = async () => {
    if (engine.current) return engine.current;
    setEngineState("loading");
    setEngineError(undefined);
    try {
      const { BrowserAudioEngine: Engine } =
        await import("@refrain/audio-engine/browser");
      engine.current = await Engine.create({
        soundBankUrl: "/soundpacks/GeneralUser-GS.sf2",
        assetBaseUrl: "",
        workletUrl: "/spessasynth_processor.min.js",
        performanceBinding: selectedPerformanceBinding,
        ...(forcedMode === "auto" ? {} : { forceMode: forcedMode }),
      });
      setEngineState("ready");
      return engine.current;
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Audio engine failed to start.";
      setEngineError(message);
      setEngineState("error");
      throw cause;
    }
  };

  const play = async () => {
    if (!audibleCompiled) return;
    const audio = await getEngine();
    setEngineState("loading");
    const receipt = await audio.play(
      audibleCompiled,
      selectedPerformanceBinding,
    );
    if (!receipt) return;
    setPlaybackEvidence(
      `binding ${receipt.performanceBindingId} sha256:${receipt.performanceBindingSha256.slice(0, 12)} · ${receipt.mode} · ${receipt.assetLoads
        .map(
          (asset) =>
            `${asset.assetId} ${asset.cache} ${asset.bytes} B sha256:${asset.sha256.slice(0, 12)} verified load ${asset.loadMs.toFixed(1)} ms decode ${asset.decodeMs.toFixed(1)} ms`,
        )
        .join(" · ")} · first sound ${receipt.firstSoundDelayMs.toFixed(1)} ms`,
    );
    setEngineState("playing");
    window.setTimeout(
      () => {
        setEngineState((current) =>
          current === "playing" ? "ready" : current,
        );
      },
      Math.ceil(audibleCompiled.durationSeconds * 1000),
    );
  };

  const stop = () => {
    engine.current?.stop();
    setEngineState(engine.current ? "ready" : "idle");
  };

  const audition = async (id: string, candidateId?: string) => {
    const audio = await getEngine();
    setEngineState("loading");
    const definition = INSTRUMENTS.find((item) => item.id === id)!;
    const resolvedCandidateId =
      candidateId ??
      G3A_AUDITION_SOUND_PROFILE.selections[id]?.candidateChain[0]?.id;
    const candidate = resolvedCandidateId
      ? candidateById.get(resolvedCandidateId)
      : undefined;
    if (!candidate || candidate.instrumentId !== id)
      throw new Error(`Unknown candidate for ${id}.`);
    const middle =
      candidate.mapping.type === "sample-map"
        ? (candidate.mapping.regions.find(
            (region) => region.trigger === "attack",
          )?.pitch.rootMidi ??
          Math.round((definition.midiMin + definition.midiMax) / 2))
        : (definition.supportedNotes?.[0] ??
          Math.round((definition.midiMin + definition.midiMax) / 2));
    const receipt = await audio.audition(
      id,
      middle,
      candidate.id,
      selectedPerformanceBinding,
    );
    if (receipt) {
      setPlaybackEvidence(
        `${candidate.id} · binding ${receipt.performanceBindingId} sha256:${receipt.performanceBindingSha256.slice(0, 12)} · ${receipt.assetLoads
          .map(
            (asset) =>
              `${asset.cache} ${asset.bytes} B sha256:${asset.sha256.slice(0, 12)} verified load ${asset.loadMs.toFixed(1)} ms decode ${asset.decodeMs.toFixed(1)} ms`,
          )
          .join(
            " · ",
          )} · first sound ${receipt.firstSoundDelayMs.toFixed(1)} ms`,
      );
    }
    setEngineState("playing");
    window.setTimeout(() => setEngineState("ready"), 2200);
  };

  const selectCandidate = (instrumentId: string, candidateId: string) => {
    engine.current?.stop();
    const defaultCandidateId =
      G3A_AUDITION_SOUND_PROFILE.selections[instrumentId]?.candidateChain[0]
        ?.id;
    setCandidateSelections((current) => {
      const next = { ...current };
      if (candidateId === defaultCandidateId) delete next[instrumentId];
      else next[instrumentId] = candidateId;
      return next;
    });
    setEngineState(engine.current ? "ready" : "idle");
    setMetrics({ state: "idle" });
  };

  const loadRenderAssets = async (
    compiled: CompiledAir,
    performanceBinding: PerformanceBinding,
  ) => {
    const started = performance.now();
    const plan = createPerformancePlan(compiled, {
      performanceBinding,
    });
    const samples: Record<string, ArrayBuffer> = {};
    let soundfont: ArrayBuffer | undefined;
    let assetBytes = 0;
    for (const required of plan.requiredAssets) {
      const response = await fetch(`/${required.localPath}`);
      if (!response.ok)
        throw new Error(`${required.assetId} HTTP ${response.status}.`);
      const bytes = await response.arrayBuffer();
      assetBytes += bytes.byteLength;
      if (required.kind === "soundfont") soundfont = bytes;
      else samples[required.assetId] = bytes;
    }
    return {
      bundle: {
        ...(soundfont ? { soundfont } : {}),
        samples,
      },
      plan,
      assetBytes,
      assetLoadMs: performance.now() - started,
    };
  };

  const changeMasterGain = (value: number) => {
    engine.current?.stop();
    setMasterGain(value);
    setEngineState(engine.current ? "ready" : "idle");
  };

  const changeForcedMode = async (value: "auto" | AudioEngineMode) => {
    engine.current?.stop();
    await engine.current?.destroy();
    engine.current = undefined;
    setForcedMode(value);
    setEngineState("idle");
  };

  const toggleVoice = (
    setter: Dispatch<SetStateAction<Set<string>>>,
    voiceId: string,
  ) => {
    engine.current?.stop();
    setter((current) => {
      const next = new Set(current);
      if (next.has(voiceId)) next.delete(voiceId);
      else next.add(voiceId);
      return next;
    });
    setEngineState(engine.current ? "ready" : "idle");
  };

  const renderMetrics = async () => {
    if (!audibleCompiled) return;
    setMetrics({ state: "rendering" });
    try {
      const { renderPcm } = await import("@refrain/audio-engine/pcm");
      const { bundle, plan, assetBytes } = await loadRenderAssets(
        audibleCompiled,
        selectedPerformanceBinding,
      );
      const pcm = await renderPcm(audibleCompiled, bundle, 44_100, {
        plan,
      });
      if (!pcm) throw new Error("PCM render was cancelled.");
      let peak = 0;
      let firstSample: number | undefined;
      for (let index = 0; index < pcm.left.length; index += 1) {
        const level = Math.max(
          Math.abs(pcm.left[index] ?? 0),
          Math.abs(pcm.right[index] ?? 0),
        );
        peak = Math.max(peak, level);
        if (firstSample === undefined && level > 0.00001) firstSample = index;
      }
      setMetrics({
        state: "ready",
        peak,
        ...(firstSample === undefined
          ? {}
          : { firstSoundSeconds: firstSample / pcm.sampleRate }),
      });
      setPlaybackEvidence(
        `${playbackEvidence} · offline assets ${assetBytes} B · peak ${peak.toFixed(5)}`,
      );
    } catch (cause) {
      setMetrics({
        state: "error",
        message: cause instanceof Error ? cause.message : "PCM render failed.",
      });
    }
  };

  const exportListeningPacket = async () => {
    if (!audibleCompiled || !result.source) return;
    const stem = `${selected}-ab`;
    const { AUDITION_PEAK_MATCH_CONTRACT, encodePcmWav, renderPcm } =
      await import("@refrain/audio-engine/pcm");
    const { createAssetClosure, createRenderReceipt } =
      await import("@refrain/audio-engine/receipt");
    const sha256 = async (bytes: ArrayBuffer | Uint8Array) => {
      const input =
        bytes instanceof Uint8Array ? Uint8Array.from(bytes).buffer : bytes;
      const digest = await crypto.subtle.digest("SHA-256", input);
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    };
    const sourceRevision = `sha256:${await sha256(
      new TextEncoder().encode(canonicalAirJson(result.source)),
    )}`;
    const baselineAssets = await loadRenderAssets(
      audibleCompiled,
      createPerformanceBinding({
        id: "soundbench-fallback@0",
        soundProfile: G3A_AUDITION_SOUND_PROFILE,
        renderScene: DEFAULT_RENDER_SCENE,
        permittedOverrides: ["masterGainDb"],
        overrides:
          masterGain === DEFAULT_RENDER_SCENE.masterGainDb
            ? {}
            : { masterGainDb: masterGain },
      }),
    );
    const candidateAssets = await loadRenderAssets(
      audibleCompiled,
      selectedPerformanceBinding,
    );
    const renderMeasured = async (
      assets: Awaited<ReturnType<typeof loadRenderAssets>>,
    ) => {
      const started = performance.now();
      const pcm = await renderPcm(audibleCompiled, assets.bundle, 44_100, {
        plan: assets.plan,
      });
      if (!pcm) throw new Error("PCM render was cancelled.");
      const renderMs = performance.now() - started;
      let peak = 0;
      let firstSample: number | undefined;
      for (let index = 0; index < pcm.left.length; index += 1) {
        const level = Math.max(
          Math.abs(pcm.left[index] ?? 0),
          Math.abs(pcm.right[index] ?? 0),
        );
        peak = Math.max(peak, level);
        if (firstSample === undefined && level > 0.00001) firstSample = index;
      }
      return {
        pcm,
        outputAmplitude: {
          mode: "audition-peak-matched" as const,
          targetPeak: 1,
          contract: AUDITION_PEAK_MATCH_CONTRACT,
        },
        wav: encodePcmWav(pcm, {
          amplitude: {
            mode: "audition-peak-matched",
            targetPeak: 1,
            contract: AUDITION_PEAK_MATCH_CONTRACT,
          },
        }),
        metrics: {
          assetLoadMs: assets.assetLoadMs,
          renderMs,
          firstSoundSeconds:
            firstSample === undefined ? null : firstSample / pcm.sampleRate,
          peak,
        },
      };
    };
    const [baseline, candidate] = await Promise.all([
      renderMeasured(baselineAssets),
      renderMeasured(candidateAssets),
    ]);
    const [baselineSha256, candidateSha256] = await Promise.all([
      sha256(baseline.wav),
      sha256(candidate.wav),
    ]);
    const adaptationNotes = [
      ...(mutedVoices.size > 0
        ? [
            `Soundbench omitted muted voices: ${[...mutedVoices].sort().join(", ")}.`,
          ]
        : []),
      ...(soloVoices.size > 0
        ? [
            `Soundbench rendered only solo voices: ${[...soloVoices].sort().join(", ")}.`,
          ]
        : []),
    ];
    const download = (filename: string, bytes: ArrayBuffer, type: string) => {
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    };
    download(`${stem}-fallback.wav`, baseline.wav, "audio/wav");
    download(`${stem}-candidate.wav`, candidate.wav, "audio/wav");
    const packet = {
      format: "refrain-listening-packet@2-experimental",
      generatedAt: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent,
        measurement:
          "browser fetch plus offline 44.1 kHz render; not a network promise",
      },
      source: result.source,
      sourceRevision,
      comparison: {
        fallback: {
          performanceBinding: baselineAssets.plan.performanceBinding,
          soundProfile: baselineAssets.plan.soundProfile,
          renderScene: baselineAssets.plan.renderScene,
          candidates: baselineAssets.plan.voices.map((voice) => ({
            instrumentId: voice.instrument,
            candidateId: voice.candidateId,
            fallbackUsed: voice.fallbackUsed,
          })),
          assetClosure: createAssetClosure(baselineAssets.plan),
          metrics: baseline.metrics,
          audio: `${stem}-fallback.wav`,
          audioSha256: baselineSha256,
          renderReceipt: createRenderReceipt(baselineAssets.plan, {
            sourceRevision,
            adapter: "wav",
            sampleRate: 44_100,
            outputSha256: `sha256:${baselineSha256}`,
            verifiedAssets: baseline.pcm.verifiedAssets,
            outputAmplitude: baseline.outputAmplitude,
            adaptationNotes,
          }),
        },
        candidate: {
          performanceBinding: candidateAssets.plan.performanceBinding,
          soundProfile: candidateAssets.plan.soundProfile,
          renderScene: candidateAssets.plan.renderScene,
          candidates: candidateAssets.plan.voices.map((voice) => ({
            instrumentId: voice.instrument,
            candidateId: voice.candidateId,
            fallbackUsed: voice.fallbackUsed,
          })),
          assetClosure: createAssetClosure(candidateAssets.plan),
          metrics: candidate.metrics,
          audio: `${stem}-candidate.wav`,
          audioSha256: candidateSha256,
          renderReceipt: createRenderReceipt(candidateAssets.plan, {
            sourceRevision,
            adapter: "wav",
            sampleRate: 44_100,
            outputSha256: `sha256:${candidateSha256}`,
            verifiedAssets: candidate.pcm.verifiedAssets,
            outputAmplitude: candidate.outputAmplitude,
            adaptationNotes,
          }),
        },
      },
      lazyLoadEvidence: {
        candidateSoundfontBytesLoaded: candidateAssets.plan.requiredAssets
          .filter((asset) => asset.kind === "soundfont")
          .reduce((total, asset) => total + asset.bytes, 0),
        candidateRequiredAssets: candidateAssets.plan.requiredAssets.map(
          (asset) => asset.assetId,
        ),
      },
      browserPlaybackEvidence: playbackEvidence,
      mechanicalAcceptance: "rendered-and-measured",
      listeningAcceptance: "pending-faye",
      soundpack: {
        id: SOUND_REGISTRY.id,
        sha256: SOUND_REGISTRY.contentSha256,
        status: SOUND_REGISTRY.status,
      },
    };
    download(
      `${stem}.listening.json`,
      new TextEncoder().encode(`${JSON.stringify(packet, null, 2)}\n`).buffer,
      "application/json",
    );
  };

  const exportMidi = async () => {
    if (!result.compiled) return;
    const { encodeMidi } = await import("@refrain/audio-engine/midi");
    const plan = createPerformancePlan(result.compiled, {
      performanceBinding: selectedPerformanceBinding,
    });
    const midi = encodeMidi(result.compiled, plan);
    const bytes = midi.buffer.slice(
      midi.byteOffset,
      midi.byteOffset + midi.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([bytes], { type: "audio/midi" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selected}.mid`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  return (
    <main className="bench-shell">
      <header className="topbar">
        <div>
          <h1>Refrain · Audible Core</h1>
          <p>Functional engineering surface — not the production Canvas.</p>
        </div>
        <div className="engine-state" data-state={engineState}>
          <span aria-hidden="true" />
          {engineState}
          {engine.current ? ` · ${engine.current.mode}` : ""}
        </div>
      </header>

      <section className="bench-grid">
        <aside className="fixture-rail" aria-label="Listening fixtures">
          <h2>Fixtures</h2>
          <nav>
            {fixtures.map(([name, text]) => (
              <button
                key={name}
                className={selected === name ? "selected" : ""}
                onClick={() => selectFixture(name, text)}
                type="button"
              >
                {name}
              </button>
            ))}
          </nav>
          <label htmlFor="source">air@0-experimental source</label>
          <textarea
            id="source"
            spellCheck={false}
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        </aside>

        <section className="listening-stage" aria-label="Compiled structure">
          <div className="stage-heading">
            <div>
              <h2>{result.compiled?.title ?? "Source does not compile"}</h2>
              <p>
                {result.compiled
                  ? `${result.compiled.events.length} events · ${result.compiled.durationSeconds.toFixed(1)} s · ${result.compiled.motifOccurrences.length} motif occurrences`
                  : `${errors.length} blocking diagnostics`}
              </p>
            </div>
            <div className="transport">
              <button
                disabled={!result.compiled || engineState === "loading"}
                onClick={play}
                type="button"
              >
                {engineState === "loading"
                  ? "Preparing selected assets…"
                  : "Play"}
              </button>
              <button onClick={stop} type="button">
                Stop
              </button>
              <button
                disabled={!result.compiled}
                onClick={() => void exportMidi()}
                type="button"
              >
                Export MIDI
              </button>
              <label className="mode-select">
                A/B path
                <select
                  aria-label="Audio path"
                  value={forcedMode}
                  onChange={(event) =>
                    void changeForcedMode(
                      event.target.value as "auto" | AudioEngineMode,
                    )
                  }
                >
                  <option value="auto">Auto</option>
                  <option value="worklet">Worklet</option>
                  <option value="prerender">PCM prerender</option>
                </select>
              </label>
              <button
                disabled={!audibleCompiled || metrics.state === "rendering"}
                onClick={() => void renderMetrics()}
                type="button"
              >
                {metrics.state === "rendering"
                  ? "Rendering PCM…"
                  : "Measure PCM"}
              </button>
            </div>
          </div>

          {engineError ? <p className="engine-error">{engineError}</p> : null}

          <div className="gain-control">
            <label htmlFor="master">Master gain</label>
            <input
              id="master"
              type="range"
              min="-30"
              max="-6"
              step="1"
              value={masterGain}
              onChange={(event) => changeMasterGain(Number(event.target.value))}
            />
            <output>{masterGain} dB</output>
          </div>

          <section className="voice-controls" aria-label="Voice mute and solo">
            <header>
              <h3>Voice audition</h3>
              <p>
                audible {audibleCompiled?.events.length ?? 0} /{" "}
                {result.compiled?.events.length ?? 0} events
              </p>
            </header>
            <div>
              {result.source?.voices.map((voice) => (
                <span key={voice.id}>
                  <strong>{voice.id}</strong>
                  <button
                    className={mutedVoices.has(voice.id) ? "active" : ""}
                    onClick={() => toggleVoice(setMutedVoices, voice.id)}
                    type="button"
                  >
                    Mute
                  </button>
                  <button
                    className={soloVoices.has(voice.id) ? "active" : ""}
                    onClick={() => toggleVoice(setSoloVoices, voice.id)}
                    type="button"
                  >
                    Solo
                  </button>
                </span>
              ))}
            </div>
          </section>

          <section className="render-metrics" aria-live="polite">
            <strong>PCM evidence</strong>
            {metrics.state === "ready" ? (
              <span>
                peak {metrics.peak?.toFixed(5)} · first sound{" "}
                {metrics.firstSoundSeconds?.toFixed(4) ?? "none"} s · ceiling
                0.72
              </span>
            ) : (
              <span>{metrics.message ?? metrics.state}</span>
            )}
          </section>
          <section className="render-metrics" aria-live="polite">
            <strong>Browser asset evidence</strong>
            <span>{playbackEvidence}</span>
          </section>

          <button
            disabled={!result.source || !result.compiled}
            onClick={() => setInspectorOpen((current) => !current)}
            type="button"
          >
            {inspectorOpen ? "Close heavy inspector" : "Load heavy inspector"}
          </button>
          {inspectorOpen && result.source && result.compiled ? (
            <Suspense fallback={<p>Loading inspector…</p>}>
              <CompiledInspector
                compiled={result.compiled}
                source={result.source}
              />
            </Suspense>
          ) : null}
        </section>

        <aside className="instrument-rail" aria-label="Instrument audition">
          <h2>Instrument candidates</h2>
          <p>
            Same AIR, selectable fallback/candidate timbres. Listening
            acceptance remains Faye's decision.
          </p>
          <button
            disabled={
              !audibleCompiled || Object.keys(candidateSelections).length === 0
            }
            onClick={() => void exportListeningPacket()}
            type="button"
          >
            Export A/B listening packet
          </button>
          <ul>
            {INSTRUMENTS.map((instrument) => {
              const candidates = candidatesForInstrument(instrument.id);
              const defaultCandidateId =
                G3A_AUDITION_SOUND_PROFILE.selections[instrument.id]
                  ?.candidateChain[0]?.id;
              const selectedCandidateId =
                candidateSelections[instrument.id] ?? defaultCandidateId;
              const selectedCandidate = selectedCandidateId
                ? candidateById.get(selectedCandidateId)
                : undefined;
              return (
                <li key={instrument.id}>
                  <span>
                    <strong>{instrument.label}</strong>
                    <small>{selectedCandidate?.releaseStatus}</small>
                  </span>
                  <select
                    aria-label={`${instrument.label} candidate`}
                    value={selectedCandidateId}
                    onChange={(event) =>
                      selectCandidate(instrument.id, event.target.value)
                    }
                  >
                    {candidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.id}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={engineState === "loading"}
                    onClick={() =>
                      void audition(instrument.id, selectedCandidateId)
                    }
                    type="button"
                  >
                    Audition
                  </button>
                </li>
              );
            })}
          </ul>
          <section className="evidence-inspector">
            <h2>Verification evidence</h2>
            <select
              value={evidenceFixture}
              onChange={(event) =>
                setEvidenceFixture(
                  event.target
                    .value as (typeof relationshipFixtures)[number][0],
                )
              }
            >
              {relationshipFixtures.map(([name]) => (
                <option key={name}>{name}</option>
              ))}
            </select>
            <pre>
              {
                relationshipFixtures.find(
                  ([name]) => name === evidenceFixture,
                )?.[1]
              }
            </pre>
          </section>
        </aside>
      </section>

      <section className="diagnostics" aria-live="polite">
        <header>
          <h2>Diagnostics</h2>
          <p>
            {errors.length} errors · {observations.length} listening notes
          </p>
        </header>
        {result.diagnostics.length === 0 ? (
          <p className="empty">No diagnostics.</p>
        ) : (
          <ul>
            {result.diagnostics.map((item, index) => (
              <li
                key={`${item.code}-${item.path}-${index}`}
                data-severity={item.severity}
              >
                <code>{item.code}</code>
                <span>{item.path}</span>
                <p>{item.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
