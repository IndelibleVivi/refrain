import { compileAnyAir } from "@refrain/compiler/any";
import type { CompiledEvent } from "@refrain/compiler";
import { createListeningReport } from "@refrain/audio-engine";
import { parseRefrainArtifact } from "@refrain/renderer/portable";

export function readMusic(input: unknown) {
  const parsed = parseRefrainArtifact(input);
  if (
    !parsed.ok &&
    typeof input === "object" &&
    input !== null &&
    String((input as { format?: unknown }).format).startsWith(
      "refrain-artifact@",
    )
  )
    throw new Error(parsed.errors.join("\n"));
  const artifact = parsed.ok ? parsed.artifact : undefined;
  const result = compileAnyAir(artifact?.source ?? input);
  if (!result.source || !result.compiled)
    throw new Error(
      result.diagnostics.map((d) => `${d.path}: ${d.message}`).join("\n"),
    );
  return {
    source: result.source,
    compiled: result.compiled,
    diagnostics: result.diagnostics,
    artifact,
  };
}

type Music = ReturnType<typeof readMusic>;
export interface InspectionScope {
  section?: string;
  voice?: string;
}

function scopeFor(music: Music, scope: InspectionScope) {
  const section =
    scope.section === undefined
      ? undefined
      : music.compiled.sections.find((s) => s.id === scope.section);
  if (scope.section !== undefined && !section)
    throw new Error(`Unknown section ${scope.section}.`);
  if (
    scope.voice !== undefined &&
    !music.source.voices.some((v) => v.id === scope.voice)
  )
    throw new Error(`Unknown voice ${scope.voice}.`);
  const startBeat = section?.startBeat ?? 0;
  const endBeat = section?.endBeat ?? music.compiled.durationBeats;
  // Include authored sustains entering the window; sample/reverb tails need audio evidence.
  const events = music.compiled.events.filter(
    (e) =>
      (scope.voice === undefined || e.voiceId === scope.voice) &&
      e.startBeat < endBeat &&
      e.startBeat + Math.max(e.durationBeats, e.soundingDurationBeats) >
        startBeat,
  );
  return { startBeat, endBeat, events };
}

function peakOverlap(
  events: readonly CompiledEvent[],
  start: number,
  end: number,
) {
  const boundaries = events
    .flatMap((e) => {
      const a = Math.max(start, e.startBeat);
      const b = Math.min(end, e.startBeat + e.soundingDurationBeats);
      return b > a
        ? [
            [a, 1],
            [b, -1],
          ]
        : [];
    })
    .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  let current = 0,
    peak = 0;
  for (const [, delta] of boundaries) {
    current += delta!;
    peak = Math.max(peak, current);
  }
  return peak;
}

function range(values: number[]) {
  return values.length
    ? { min: Math.min(...values), max: Math.max(...values) }
    : null;
}

function ledger(events: readonly CompiledEvent[], expression = false) {
  return events
    .map((e) =>
      JSON.stringify(
        expression
          ? [
              e.midi,
              e.startBeat,
              e.durationBeats,
              e.velocity,
              e.gainDb,
              e.pan,
              e.gate,
              e.articulation,
              e.soundingDurationBeats,
            ]
          : [e.midi, e.startBeat, e.durationBeats],
      ),
    )
    .sort();
}
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export function inspectMusic(
  input: unknown,
  scope: InspectionScope = {},
  comparison?: unknown,
) {
  const music = readMusic(input);
  const window = scopeFor(music, scope);
  const voices = music.source.voices
    .filter((v) => scope.voice === undefined || v.id === scope.voice)
    .map((v) => {
      const events = window.events.filter((e) => e.voiceId === v.id);
      return {
        id: v.id,
        role: v.role,
        instrument: v.instrument,
        gainDb: v.gainDb ?? 0,
        pan: v.pan ?? 0,
        events: events.length,
        attacks: events.filter((e) => e.startBeat >= window.startBeat).length,
        carryIn: events.filter((e) => e.startBeat < window.startBeat).length,
        register: range(events.map((e) => e.midi)),
        velocity: range(events.map((e) => e.velocity)),
        gate: range(events.map((e) => e.gate)),
        peakSoundingNotes: peakOverlap(
          events,
          window.startBeat,
          window.endBeat,
        ),
      };
    });
  const compare =
    comparison === undefined
      ? undefined
      : (() => {
          const before = readMusic(comparison);
          const old = scopeFor(before, scope);
          const ids = [
            ...new Set(
              [...before.source.voices, ...music.source.voices].map(
                (v) => v.id,
              ),
            ),
          ].filter((id) => scope.voice === undefined || id === scope.voice);
          const bindings = (m: Music) =>
            m.artifact && "performanceBindings" in m.artifact
              ? {
                  selected: m.artifact.defaultBindingId,
                  bindings: m.artifact.performanceBindings.map((b) => [
                    b.id,
                    b.contentSha256,
                  ]),
                }
              : null;
          return {
            direction: "comparison-to-input",
            timingUnchanged: equal(
              [
                before.compiled.tempo,
                "conductor" in before.source
                  ? before.source.conductor
                  : before.compiled.meter,
                before.compiled.durationBeats,
              ],
              [
                music.compiled.tempo,
                "conductor" in music.source
                  ? music.source.conductor
                  : music.compiled.meter,
                music.compiled.durationBeats,
              ],
            ),
            bindingsUnchanged: equal(bindings(before), bindings(music)),
            voices: ids.map((id) => {
              const a = old.events.filter((e) => e.voiceId === id),
                b = window.events.filter((e) => e.voiceId === id);
              const av = before.source.voices.find((v) => v.id === id),
                bv = music.source.voices.find((v) => v.id === id);
              const present = av !== undefined && bv !== undefined;
              // Scope membership can change when only a gate changes. Compare the
              // union of the two windows' note identities against both full ledgers.
              const selectedNotes = new Set([...ledger(a), ...ledger(b)]);
              const noteWindow = (m: Music) =>
                ledger(
                  m.compiled.events.filter(
                    (e) =>
                      e.voiceId === id && selectedNotes.has(ledger([e])[0]!),
                  ),
                );
              return {
                id,
                beforeEvents: a.length,
                afterEvents: b.length,
                notesUnchanged:
                  present && equal(noteWindow(before), noteWindow(music)),
                expressionUnchanged:
                  present &&
                  equal(ledger(a, true), ledger(b, true)) &&
                  av.gainDb === bv.gainDb &&
                  av.pan === bv.pan,
                instrumentUnchanged: present && av.instrument === bv.instrument,
                roleUnchanged: present && av.role === bv.role,
              };
            }),
          };
        })();
  const sections = music.compiled.sections.map((s) => ({
    ...s,
    events: music.compiled.events.filter(
      (e) => e.startBeat >= s.startBeat && e.startBeat < s.endBeat,
    ).length,
    peakSoundingNotes: peakOverlap(
      music.compiled.events,
      s.startBeat,
      s.endBeat,
    ),
  }));
  const occurrences = music.compiled.motifOccurrences.filter(
    (o) =>
      (scope.voice === undefined || o.voiceId === scope.voice) &&
      o.startBeat < window.endBeat &&
      o.startBeat + o.durationBeats > window.startBeat,
  );
  return {
    ok: true,
    title: music.source.title,
    sourceFormat: music.source.format,
    diagnostics: music.diagnostics,
    wholePiece: createListeningReport(music.compiled).structural,
    scope: {
      ...scope,
      startBeat: window.startBeat,
      endBeat: window.endBeat,
      peakSoundingNotes: peakOverlap(
        window.events,
        window.startBeat,
        window.endBeat,
      ),
    },
    sections: sections.slice(0, 32),
    omittedSections: Math.max(0, sections.length - 32),
    voices,
    motifOccurrences: occurrences
      .slice(0, 32)
      .map(({ material: _material, ...occurrence }) => occurrence),
    omittedMotifOccurrences: Math.max(0, occurrences.length - 32),
    ...(compare ? { compare } : {}),
    evidence:
      "Authored structure and expression only; no audio render, masking score, or listening acceptance.",
  };
}
