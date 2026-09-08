import type { AirSource } from "@refrain/air-schema";
import type { CompiledAir } from "@refrain/compiler";

export default function CompiledInspector({
  source,
  compiled,
}: {
  source: AirSource;
  compiled: CompiledAir;
}) {
  const realizationSegments = source.voices.flatMap((voice) =>
    "realize" in voice && Array.isArray(voice.realize)
      ? voice.realize.map((segment) => ({ voiceId: voice.id, segment }))
      : [],
  );
  return (
    <>
      <div className="inspector-grid">
        <section>
          <h3>Harmony</h3>
          {source.harmony?.length ? (
            source.harmony.map((plan) => (
              <p key={plan.id}>
                <code>{plan.id}</code>{" "}
                {plan.chords
                  .map((chord) => `${chord.symbol}·${chord.beats}`)
                  .join(" → ")}
              </p>
            ))
          ) : (
            <p>Literal source; no harmony plan.</p>
          )}
        </section>
        <section>
          <h3>Realization segments</h3>
          {realizationSegments.length ? (
            realizationSegments.map(({ voiceId, segment }) => (
              <p key={`${voiceId}:${segment.id}`}>
                <code>
                  {voiceId}/{segment.id}
                </code>{" "}
                {segment.kind} · {segment.section ?? "—"} · ×
                {segment.repeat ?? 1}
              </p>
            ))
          ) : (
            <p>Literal voice mode.</p>
          )}
        </section>
      </div>

      <div className="event-table-wrap">
        <table>
          <caption>First 160 compiled events</caption>
          <thead>
            <tr>
              <th>Beat</th>
              <th>Voice</th>
              <th>Instrument</th>
              <th>Pitch</th>
              <th>Length</th>
              <th>Sounding</th>
              <th>Expression</th>
              <th>Source anchor</th>
              <th>Motif</th>
            </tr>
          </thead>
          <tbody>
            {compiled.events.slice(0, 160).map((event) => (
              <tr key={event.id}>
                <td>{event.startBeat}</td>
                <td>{event.voiceId}</td>
                <td>{event.instrument}</td>
                <td>{event.note}</td>
                <td>{event.durationBeats}</td>
                <td>{event.soundingDurationBeats}</td>
                <td>
                  {event.articulation} · {event.gate.toFixed(2)}
                </td>
                <td>
                  {event.source.authoring === "realize"
                    ? `${event.source.segmentId}#${(event.source.repeatIndex ?? 0) + 1}`
                    : `part·bar${event.bar}`}
                </td>
                <td>
                  {event.motif
                    ? `@${event.motif} · ${event.motifOccurrence}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
