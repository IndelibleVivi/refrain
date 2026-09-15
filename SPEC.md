# Refrain MCP App specification

## Value proposition

Refrain lets the agent already present in a relationship or ongoing conversation express itself through inspectable music—from a brief gesture to a complete piece—whose motifs and sonic bodies can return, transform, and accumulate meaning over time.

The primary user is a person conversing with an agent that has enough context to choose what to express. Today that expression is usually prose, emoji, or an opaque generated audio file. Prose cannot carry the same non-verbal structure; opaque generation hides authorship and makes continuation unreliable.

**Core actions:**

1. `hum` a new air from complete source authored by the current agent.
2. `hum` a revision, extension, reply, variation, or quotation with explicit source-and-receipt lineage.
3. Hear, inspect, and export the same canonical artifact through the host's available presentation tier.

## Why an LLM host

**Conversational win:** the agent already knows what moment it is responding to and can decide that a musical gesture fits without forcing the person through a DAW or prompt-to-song form.

**What the LLM contributes:** intent, composition choices, relation to prior motifs, a caption, and situational judgment. Refrain contains no hidden composing model.

**What the LLM lacks:** deterministic musical parsing and compilation, a stable instrument vocabulary, safe rendering, portable artifact presentation, export, and revision/lineage receipts. Refrain supplies those capabilities.

## Human and agent journey

**First view:** the tool result names the air, states its duration and instrumentation, exposes diagnostics and lineage, and offers manual playback when the host can present UI.

**Core interaction:** the person can hear, navigate, inspect, and select exact structure; the agent can read one exact portable artifact and a compact compiled summary without receiving the expanded event schedule. A later agent turn may pass that artifact unchanged with a declared continuation relation to create a new immutable receipt.

**End state:** the canonical source remains portable. Text-only hosts retain a complete Tier 0 result; URL-capable hosts open Tier 1; MCP App hosts show Tier 2. Tier 1 and Tier 2 execute the exact same renderer and visual language, differing only in delivery shell.

## Product context

- Existing product: greenfield private repository; no account service or legacy API.
- Canonical data: current `air@1-experimental` source and deterministic `compiled-air@1-experimental` projection. AIR@0 remains a strict historical source and explicit migration input, not a parallel active grammar.
- MCP surface: one stateless `hum` action plus one read-only App resource.
- Auth: none inside a local or loopback-only private MCP origin. An operator may put a private host transport such as OpenAI Secure MCP Tunnel outside that origin; a future public or shared HTTPS deployment must supply a real OAuth 2.1 authorization boundary without introducing a Refrain account service or reusing the tunnel runtime credential as client auth.
- Sound: source-plural catalog in which sampled acoustic, synthetic, electronic, processed, hybrid, found, and deliberately strange candidates are equal-class; stable instrument vocabulary, exact profiles/bindings, asset-level provenance, and GeneralUser GS only as audition fallback.
- Storage: runtime/user owned. The server may keep an ephemeral process cache for reachable presentation URLs but it must not become artifact authority.
- Consent: playback requires an explicit user gesture.
- Visual constraint: the active G candidate selectively transplants the Faye/Selen-approved visual-research v1 into the shared renderer. Source completeness and local browser evidence do not by themselves make that candidate aesthetically accepted, host-accepted, deployed, or released.
- License constraint: project-original functional materials use SUL-1.0 and authored content uses CC BY-NC-SA 4.0 under `LICENSING.md`; final distributable sound acceptance remains separate.

## Acceptance contract

- The MCP server never calls a model and never composes missing music.
- Each valid call returns source, a compact deterministic summary, diagnostics, a content-derived `sourceRevision`, a lineage-sensitive `receiptId`, a logical `airId`, and optional declared lineage. Expanded events remain a local projection recompiled from canonical source for rendering and export.
- Invalid source fails with actionable typed diagnostics and does not create a presentation artifact.
- Tier 0 works without a browser or server-side artifact lookup.
- Tier 1 and Tier 2 share one renderer implementation, one source-to-view model, and one visual-language contract.
- Browser and headless audio consume the same compiler events and resolved `PerformancePlan`; adapters execute rather than re-resolve sound choices.
- Manual play, pause/resume, stop, restart, seek, section jump, portable Refrain artifact/source/MIDI/native-WAV export, optional matched preview, and exact performance/provenance metadata remain in the full programme even if individual host surfaces expose them at different milestones.

## UX flow

`hum` is one end-to-end flow:

1. The current agent submits complete authored source and, when relevant, one exact prior artifact plus one declared continuation relation.
2. Refrain validates and compiles deterministically, then returns a Tier 0 artifact and immutable receipt whose identity is separate from the source revision.
3. The person inspects structure and motif recurrence, manually plays or stops the air, and may export a self-contained Refrain artifact or one of its projections.
4. A later turn or fresh runtime can feed the exact artifact back into the same `hum` action as `from.parentArtifact`; the server derives and cross-verifies its source, receipt, and binding without server storage.

This flow needs a UI because manual audio transport and recurrence-over-time structure benefit materially from a visual surface. Source authoring remains conversational; the Canvas is not a composition form.

## MCP API and view

**View-backed tool: `hum`**

- Input: `{ air, caption?, from?, performance? }` where `air` is either a complete strict AIR@1 JSON string/object or an exact historical AIR@0 input. Current AIR@1 continuation uses `from.parentArtifact` plus a declared relation and optional expected source revision; the server reads the exact same-generation source, receipt, and parent binding from that Artifact@3. The explicit source/receipt form remains a historical compatibility input. `performance.bindingId` chooses an exact parent-carried ID before consulting built-ins; unknown IDs fail in the resolver. An omitted child binding inherits the parent default or sole carried binding, including Binding@1; unbound and ambiguous parents remain unbound. CLI and MCP use this same rule. The MCP tool advertises zero-asset `f-synthetic-beat@0` as its exact default only for a new AIR@1 root without an explicit binding; sampled bindings remain exact but unavailable in MCP Canvas, while ordinary browser presentations retain sampled playback. Runtime/private conversation context is not accepted or echoed.
- Success output: current AIR@1 returns `{ ok: true, artifact, summary, diagnostics, performanceStatus, caption?, presentation? }`, with the exact Artifact@3 as the sole source/receipt/binding authority. Historical AIR@0 retains its strict top-level source/receipt and compact binding identity. `summary` contains duration, meter, tempo, per-voice instrument/event counts, total `eventCount`, and compact motif occurrence counts; it never contains expanded events. Selecting another binding does not change `sourceRevision`, `airId`, or the musical `receiptId`.
- Error output: `{ ok: false, diagnostics }`, also strict.
- Annotations: local deterministic computation; no open-world publication, no destructive mutation, and no server-account write.
- View component: `hum`, deterministically recompiling canonical `source` with the same `@refrain/compiler` package before rendering; it performs no follow-up data call.

The tool definition itself is an authoring surface. Its `tools/list` contract exposes the complete AIR object shape, closed voice/section objects, explicit role and instrument enums, field limits, part-token syntax, instrument ranges, and one minimal valid example. A host agent must not need repository documentation to discover the grammar. JSON-string input remains available for runtimes that serialize the object themselves.

## Portable artifact

`refrain-artifact@3-experimental` is the current AIR@1 self-contained continuation and exact-performance object:

```json
{
  "format": "refrain-artifact@3-experimental",
  "source": { "format": "air@1-experimental" },
  "receipt": { "format": "refrain-receipt@1-experimental" },
  "caption": "optional",
  "performanceBindings": [],
  "defaultBindingId": "optional exact binding ID",
  "renderReceipts": [],
  "projections": []
}
```

Browser and MCP views retain this entire document as their save and handoff authority. Selecting a carried binding changes only local playback state, stops/reset playback without auto-play, and does not change the saved default or remove other bindings or evidence. Valid unbound/ambiguous documents remain inspectable. Generated current presentation URLs use the existing digest-bound portable artifact fragment when it fits. An exact public-build catalog locator may replace the fragment only for artifact bytes already present in that receiver and must bind the catalog ID to the same artifact SHA-256. Historical Presentation@0/@1/@2 readers remain format-exact.

It carries complete canonical source and the complete musical receipt, including lineage, beside zero or more self-verifying exact `PerformanceBinding` objects and optional self-verifying `RenderReceipt`/projection references. A default binding, when present, must refer to one carried binding; every render receipt must refer to one carried binding and agree with its profile, scene, palette, renderer, candidate chain, and candidate digests; every projection reference must refer to one carried render receipt whose adapter, amplitude policy, and output digest match the projection kind. Imported render receipts enforce the same adapter, verified-byte closure, and amplitude semantics as newly created receipts.

Artifact continuity verification is independent from current runtime availability. A binding first verifies against its own closed embedded contracts and content digests; a separate runtime-resolution result then reports whether its exact vocabulary, directly pinned candidate content, and renderer contract are installed. A continuity-valid artifact remains inspectable and usable unchanged as the next call's `from.parentArtifact` authority when exact playback is unavailable. The renderer preserves the historical binding, exposes the unavailable reason, and disables Play. Projection export fails closed until an installed binding is selected explicitly; neither path silently substitutes current sound. A fresh runtime therefore needs no cache, database, or model-authored reconstruction of the artifact's bound authorities. Export surfaces distinguish this continuation-bearing artifact from the pure `.air.json` source and from MIDI/WAV projections.

The strict historical readers remain version-exact: Artifact@0 is source/receipt/caption only, Artifact@1 carries AIR@0 plus Binding@0, and Artifact@2 carries AIR@0 plus Binding@1. New AIR@1 exports emit Artifact@3. Import does not silently widen or reinterpret an older artifact; a current binding is chosen only when a later presentation or export operation explicitly needs audible execution. A binding never enters AIR, `sourceRevision`, or musical lineage.

Receipt integrity is one shared synchronous authority used by `hum`, every artifact reader, and browser presentation. Each AIR generation retains its exact source/evidence/receipt serializers, then verifies root/lineage status and logical-air semantics. AIR@1 serializers reconstruct every closed nested object in the contract's canonical field order before hashing: a JSON transport may change object-key insertion order without changing receipt, verification, or embodiment identity, while array order remains identity-bearing. Portable and presentation parsing additionally recompute the canonical source revision and bind it to `receipt.sourceRevision`; independently valid source/receipt objects cannot be crossed or paired across generations. Shape-only validation remains distinct from integrity proof. AIR@1 verifies motif transformation, orchestration, recurrence, section contrast, meaningful absence, and exact extension-prefix evidence from recompiled sources; optional embodiment lineage has a separate identity contract and never substitutes for musical relation.

There is no separate compose, play, motif-lookup, or presentation-fetch tool. Playback state is ephemeral view state. Canonical continuity is passed in the next tool call rather than stored inside the view or server.

## Historical AIR@0 language contract

G2 deepens `air@0-experimental` without replacing its literal `voice.part` path. Every voice chooses exactly one authoring mode:

- `part`: the existing bar-delimited literal notation, retained as a compatibility and exact-note surface; or
- `realize`: a non-empty ordered list of explicit, stable-ID realization segments.

The host agent remains the composer. A realization segment expands only choices present in source: named motifs, chord symbols and durations, voicing policy, register, rhythm, transforms, expression, repetition, and section identity. Refrain must not infer genre, mood, accompaniment style, taste, or a missing musical decision.

### Harmony plans and chord vocabulary

An air may declare strict harmony plans. Each plan has a stable `id` and one or more ordered chord spans. A chord span contains a parseable symbol and a positive duration in beats; the plan duration is the sum of its spans.

The experimental chord vocabulary supports:

- major, minor, diminished, augmented, suspended second, and suspended fourth triads;
- sixth, dominant seventh, major seventh, minor seventh, half-diminished seventh, and add-nine chords;
- explicit inversion by scale-degree index; and
- slash-bass notation when the requested bass is a chord tone.

Enharmonic spelling is preserved in source, while compilation uses deterministic MIDI pitch classes. Invalid qualities, extensions, inversions, slash basses, or non-positive spans fail with typed diagnostics; they are never repaired silently.

### Realization segments and form

`realize` is a discriminated union with these segment kinds:

- `literal`: compile an explicit `part` fragment;
- `motif`: expand one named motif with explicit transforms;
- `chords`: realize a referenced harmony plan with an explicit voicing, register, rhythm, and optional nearest-voice-leading policy;
- `arpeggio`: realize a referenced plan with an explicit ordered degree pattern, step duration, octave span, and register;
- `bass`: realize a referenced plan with an explicit degree pattern, step duration, octave/register choice, and slash-bass policy;
- `drum_grid`: expand an explicit fixed-resolution lane grid for supported percussion instruments; and
- `rest`: advance an explicit positive number of beats without emitting notes.

Every segment has a stable `id`; may have a positive bounded `repeat`; and may carry a `section` label. Repetition and section boundaries are source-level form, not inferred form. All duration-bearing segments must fill the declared meter exactly across the voice, preserving the existing cross-voice bar-alignment contract.

Structured transforms are deterministic and bounded. Motif transpose and stretch remain supported; inversion and retrograde are explicit optional transforms. Harmony realization uses only the requested chord, register, voicing, and voice-leading policy. `nearest` voice-leading chooses the lexicographically stable minimum-total-motion candidate from the bounded requested register.

### Expression and compiled anchors

A realization segment may declare:

- one of `pp`, `p`, `mp`, `mf`, `f`, or `ff`;
- a piecewise-linear dynamic curve from one named dynamic to another, optionally through one to six strictly ordered interior `{ at, level }` points where `0 < at < 1` measures progress across musical onsets rather than wall-clock samples;
- one of `staccato`, `tenuto`, `accent`, or `legato`;
- an explicit gate ratio overriding the articulation default; and
- an explicit tie to the next segment boundary.

Expression changes loudness and sounding duration; it does not change the notated beat schedule. A tie merges matching pitches that meet exactly at an adjacent segment boundary. A tie whose boundary has no matching continuation is invalid.

Each compiled event carries its source voice, authoring mode, segment ID/index, repeat index, optional section, and motif occurrence identity, plus resolved articulation, gate, notated duration, sounding duration, and velocity. These anchors are deterministic projections used by inspection, relation verification, playback, and export.

### PerformanceBinding, PerformancePlan, and renderer parity

All audible and exported projections name one exact `refrain-performance-binding@0-experimental`. The binding embeds and self-verifies a complete `SoundProfile`, exact `refrain-render-scene@0-experimental`, optional exact `refrain-sound-palette@0-experimental`, all selected candidate content digests, permitted and applied overrides, and one explicit renderer compatibility contract. Historical bindings retain `refrain-renderer@0-experimental`; complete-piece bindings use `refrain-renderer@1-experimental`. The current transparent scene owns `masterGainDb`, attenuation-only `peakCeiling`, and `velocityScale`; those values become internal `ResolvedRenderProfile` data and are not independently authored anywhere else.

Historical renderer bindings resolve through strict `performance-plan@2-experimental`. Complete-piece bindings resolve through compact `performance-plan@3-experimental` inside a sealed `refrain-execution-bundle@0-experimental`. The bundle contains one local `CompiledAir`, its digest, one plan and digest, typed frame indexes/checkpoints, and runtime asset locators. The plan contains compiled identity and event-resolution indexes rather than a second compiled event schedule, plus the complete binding, derived profile, scene, optional palette, renderer contract, and execution choices:

- voice and instrument gain;
- pan;
- melodic MIDI channel assignment and the percussion channel policy;
- program and fallback program;
- percussion-note mapping;
- complete `SoundProfile` identity and whole-identity candidate fallback;
- exact sample pitch/velocity region, source-authored velocity gain curve where present, articulation fallback, deterministic round robin, loop/release behavior, and required-asset closure;
- articulation, gate, and sounding note-off time;
- synth patch identity and declarative patch parameters; and
- scene-derived master gain, velocity scale, and attenuation-only peak ceiling.

Browser Worklet playback, browser direct synth/sampler playback, transferable block rendering, bounded Node WAV, MIDI export, and instrument audition consume that same exact plan/bundle or an explicitly derived audition binding. A separate `refrain-preparation-plan@0-experimental` derives opening closure, first-use deadlines, fetch/decode concurrency, and decoded-cache budget without changing audible identity. Adapters may differ because a destination cannot encode a property, but they must not independently re-decide shared musical or sample-selection semantics. PCM limiting may attenuate a signal above the ceiling; it must never normalize a quiet render upward. Synth filter/envelope behavior is defined once and reused by realtime and offline renderers.

Parity acceptance is semantic rather than byte-identical: event timing, note-off timing, channel/percussion mapping, patch selection, gain/pan policy, and expression agree across applicable adapters. Focused regressions cover quiet (`pp`) material, hybrid sampled/synth schedules, early stop, dense textures, audition gain, and attenuation-only PCM output.

### Verified continuation relations

`from` may carry relation evidence as `motifLinks`, each linking a prior motif occurrence to a child motif occurrence by the exact stable anchors published in compact summaries. Refrain recompiles both sources and verifies the anchor, motif identity, and link; callers cannot assert a verified result directly. Names alone are insufficient because one motif may occur more than once under different transforms.

Relation policy is:

- `quote`: requires at least one link whose compiled pitch-and-duration sequence is exact;
- `variation`: requires at least one link whose child sequence is the deterministic result of the child's declared motif transform;
- `extend`: requires the child compiled schedule to be strictly longer and to contain the complete prior compiled schedule as an exact prefix;
- `revise`: may optionally preserve verified motif links but does not require them; and
- `reply`: may remain declared-only.

Required evidence that is missing, points at nonexistent anchors, or fails the relation predicate rejects the call with typed diagnostics. A successful receipt records the relation verification status, verified link summary, verification contract version, and evidence-derived identity. Portable artifacts carry the complete verification-bearing receipt so a fresh process can reproduce the same result without server state.

### G2 acceptance and non-goals

G2 acceptance requires all of the following in one compatible development line:

- literal solo source remains source/compile compatible;
- fixtures exercise an acoustic ensemble, a 45–75 second sectional form, expressive phrasing, verified quotation/variation, verified extension, and invalid evidence;
- `tools/list`, Tier 0 summaries, portable artifacts, and renderer view models expose the new strict source and verification contracts without expanded-event payloads;
- the functional soundbench can inspect realization/harmony/evidence, mute or solo voices, compare Worklet and PCM paths, and report peak plus first-sound timing;
- MIDI and WAV exports preserve the applicable unified performance semantics; and
- focused unit, smoke, browser playback, export, and fresh-process continuation evidence pass.

Production Canvas aesthetics, final release sound assets, autonomous playback, server-owned memory, and the delayed four-author/four-host matrix remain outside this tranche. G2 engineering must keep the shared renderer compatible with both the URL shell and future MCP Canvas rather than forking either surface.

## G3A sound identity and interaction contract

G3A is the engineering bridge between the G2 music language and the later production Canvas. It closes the remaining mechanical gaps in G2, establishes listening-candidate sound assets, and publishes one UI-agnostic structure/selection contract. It does not select the production Canvas aesthetic and it does not allow automatic tests to stand in for Faye's listening decision.

### G2 semantic closure

- Sampled and MIDI playback treat `(channel, pitch)` as a note lifecycle. Explicit ties compile to one attack and one release; ordinary legato retains each rearticulation without allowing an earlier overlapping release to silence the later attack.
- Every compiled motif occurrence publishes normalized motif material in source atom/note order, including rests, relative musical onset, and notated duration. Relation verification consumes that compiler projection rather than reconstructing material from sorted audible events. Inversion uses the first source-ordered note as its axis; retrograde reverses atoms, including rests.
- Chord degree values are the same finite set in the source schema, MCP schema, parser, and compiler. A structured literal validates every `|`-delimited bar independently as well as the whole voice. Dynamic curves interpolate by musical onset, not atom count.
- One exact `RenderScene` is authoritative for master gain, attenuation-only peak ceiling, and velocity scaling. Those values become derived `ResolvedRenderProfile` plan data rather than a competing authored object. Browser, sampler, PCM, MIDI, export, and audition adapters consume resolved values rather than recomputing them independently.

G2 may be marked source-complete only after focused positive and negative regressions for these semantics pass alongside the existing gates.

### Release-candidate soundpack

Sound authority is intentionally split by concern. The tracked instrument vocabulary is the sole model-facing authority for stable identity, label, family, authored range, supported percussion notes, and authoring meaning. The tracked lightweight catalog routes candidate identities to immutable content-addressed shards. Each shard is the exact implementation/provenance authority for one candidate and its assets: engine/mapping, gain, source/ref/digest/bytes, optional byte-pinned archive/container and exact member, asset license, loop/release metadata, processing history, and release status. A complete `SoundProfile@1` selects candidates through direct `{ id, sha256 }` pins and has no monolithic soundpack dependency. Identity records must not hide rendering defaults. Asset rights are established per asset; a package or repository license is not inferred to cover unlisted samples.

GeneralUser GS remains an audition fallback and is not Refrain's release identity. Candidate assets are addressable per instrument and loaded on demand; selecting an independent piano sample for a piano-only air must not fetch or decode the complete GM bank. The current acoustic-first identity set remains stable during this tranche.

The soundbench can compare candidate renderings of the same canonical AIR, report asset bytes and cold/warm load, decode, first-sound, and peak measurements, and export a provenance-bearing listening packet. At least warm piano, harp, and marimba receive reproducible A/B packets. Mechanical validity, provenance completeness, and runtime performance are machine-verifiable; whether a candidate is beautiful or belongs to Refrain remains explicitly pending Faye's listening acceptance.

### Structure view model and selection

`refrain-structure@1-experimental` is a UI-agnostic projection generated from canonical source plus its compiled projection. It exposes authored-section priority, harmony spans, voices, capped realized segments/motif occurrences, expression, playback summary, relation evidence, motif-family identity/atom outlines, and at most 192 whole-form density/upper-envelope bins. Whole-form structure items are capped at 2,048 and an explicit detail window carries at most 512 events; the ordinary model result and whole-piece DOM never mirror expanded events. Tier 1 URL and Tier 2 MCP Canvas import this exact shared renderer and view-model implementation.

`refrain-selection@0-experimental` contains the source revision, receipt ID, selection kind, an exact motif/segment/section anchor, optional voice, and an exact musical-time range. A selection is serializable, copyable, and downloadable. A capable MCP host may return it to the conversation only after a user action; the URL/CLI shell retains a copyable textual request fallback. Returning a selection supplies conversational context rather than issuing an implicit `hum`: the host answers the person's actual request and authors a new AIR only when requested or musically appropriate. New roots use current AIR@1; a continuation preserves the exact parent generation, complete parent source, same-generation receipt, and any declared exact-anchor relation evidence rather than downgrading to AIR@0.

A selection is context for the host agent, not a composition operation. `hum` continues to accept a complete new canonical source authored by the current agent and independently verifies any declared relation evidence.

### Loading and evidence

Audio engines, SoundFont/Sampler implementations, export code, and heavy inspection UI load only when invoked. Code splitting remains visible and auditable rather than being hidden by a larger warning threshold. Performance evidence records the local environment and actual asset bytes plus cold/warm first-sound measurements; it makes no universal network-latency promise.

G3A acceptance requires the old gates and fresh-process continuation evidence, the focused semantic regressions, a reproducible provenance-complete soundpack pipeline, three A/B listening packets, and a local selection-to-agent-request-to-verified-variation demonstration. Production Canvas aesthetics remain unchanged.

## G3B expressive sound resolution

G3B grows Refrain's audible identity across the complete acoustic set rather than treating one improved instrument as tranche completion. It preserves AIR as musical intent and resolves performance implementation below that boundary.

### SoundProfile and fallback

A `SoundProfile@1` binds the exact vocabulary plus canonical profile identity and pins every candidate directly by ID and candidate-content SHA-256. Every active identity has one selection. A strict selection contains exactly one candidate. An audition fallback chain may contain more than one exact pin, but resolution chooses the first candidate that covers every event for that identity; it never mixes a preferred sample on some notes with GM fallback on other notes in the same performance. Release profiles are immutable inputs to render/export, may not consult mutable defaults, and remain unchanged when an unrelated catalog candidate is added.

### Deterministic sample resolution

For each used identity, `refrain-sound-resolver@0-experimental` resolves before adapter execution:

- exact pitch and velocity coverage;
- requested and resolved articulation through an acyclic explicit fallback map;
- deterministic round robin that genuinely rotates by stable authored attack order plus a candidate-scoped content seed, never playback history or a global catalog digest;
- root pitch, tuning, playback rate, per-region gain, sustain loop and crossfade frames;
- envelope, natural one-shot, or sampled-release behavior and render tail; and
- the sorted exact asset closure required by the selected events.

Sample maps reject ambiguous overlapping regions, incomplete round-robin groups, out-of-range loop frames, missing release behavior, and invalid release-sample closure. A release candidate must cover every MIDI/velocity/articulation combination in a pitched identity or every declared `supportedNotes` pitch in a percussion identity, and every referenced asset must itself be a release candidate.

### Render evidence and listening truth

`RenderReceipt` is projection evidence, separate from the musical AIR receipt. It binds source revision, compiler and resolver contracts, vocabulary/profile/candidate/scoped-closure/plan digests, exact required assets and the bytes actually verified, adapter, sample rate when applicable, native or explicitly matched amplitude policy, output digest, and explicit adaptation notes such as MIDI timbre approximation. Export packets carry the exact `SoundProfile`, render receipts, and a portable exact asset-closure manifest.

Mechanical tests may establish deterministic resolution, asset bytes and provenance, loop/release execution, sparse loading, measured local cold/warm performance, and output identity. They may not claim timbral quality. A Faye listening decision is valid only for the exact candidate/fallback audio digests it names; accepting a bounded probe does not promote a partial map into a full release identity.

G3B completion additionally requires the instrument matrix in [`docs/G3B-COVERAGE.md`](docs/G3B-COVERAGE.md): each acoustic identity needs an independent full-resolution candidate or a specific evidence-backed source/identity blocker, representative piano/mallet/plucked/percussion/sustained engine paths need runtime evidence, and no final profile may depend on GeneralUser GS. Production Canvas aesthetics remain outside this tranche.

## Adopted product-system programme after G3B

The owner-approved 2026-08-22 programme supersedes four earlier product assumptions: AIR is not inherently short; sampled-acoustic-first is not the permanent sound identity; inline URL is not universal delivery; and play/stop plus whole-piece prerender is not sufficient for complete pieces. [`docs/PRODUCT.md`](docs/PRODUCT.md) owns the human-facing meaning, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) owns the target authority chain, and [`docs/ROADMAP.md`](docs/ROADMAP.md) is the complete coverage ledger and dependency order.

### Scale and form

One `hum`/AIR/receipt flow covers a few-second gesture, a vignette, and a complete multi-section piece. Tranche D verifies the adopted envelope with a 4:48 relational reference (10 active voices, 2,294 events) and an 8:00 upper-envelope fixture (12 voices, 21,840 events), without event-shaped MCP payloads or event-count-proportional DOM. Measured experimental guards are 480 seconds, 12 voices, 24,576 events, and 65,536 expanded atoms. These are implementation limits, not the product's creative identity. Compact reusable form is added only where evidence establishes the need and deterministically lowers to current anchors/events.

### Audible authority

Every audible render resolves an explicit `PerformanceBinding` associated beside AIR. It pins an exact `SoundProfile`, exact `RenderScene`, optional exact `SoundPalette`, allowed overrides, candidate content identities, and renderer contract. A `SoundPalette` is a coherent creative room, not an inferred genre or universal compatibility score. Acoustic, synthetic, electronic, processed, hybrid, found, and strange sources are equal-class.

`RenderScene` owns versioned production treatment. Musical dynamics remain AIR. `RenderProfile` has been retired as an authored input; `ResolvedRenderProfile` is derived data inside both historical plan@2 and complete-piece plan@3. The current `transparent-native@0` scene executes master gain, peak ceiling, and velocity scaling only; broader deterministic room, bus, EQ, dynamics, texture, degradation, and tail treatments remain programme work rather than placeholder fields. Candidate implementation now lives in immutable content-addressed shards behind a lightweight catalog; profiles and bindings pin candidate content identities directly, so unrelated catalog growth cannot change an existing performance.

Native-gain WAV preserves resolved amplitude. Audition peak matching is a separate versioned, receipt-visible transform. All assets pass byte-count and SHA-256 verification before decode; receipts bind actual verified bytes. Release regions, release gains, loops, natural tails, sampled releases, and RR groups have complete overlap/closure contracts.

### Piece-scale runtime and delivery

Interactive playback implements progressive preparation: verify/decode the opening closure only after a user gesture, schedule with bounded lookahead, prefetch later first-use assets, and support pause/resume, stop, restart, seek, current/total time, and section jump. A presentation-owned queue may continue only from the complete-piece transport's real natural-end transition; pause, stop, seek, failure, and stale runs do not count as completion. Queue mode and local appearance are presentation state and never enter AIR, receipts, bindings, or audio plans. Seek reconstructs sustained, loop, release, sample-offset, oscillator-phase, and upcoming state without audible replay from zero. Offline reference rendering shares a deterministic block kernel across browser workers and Node; bounded two-pass Node WAV never allocates a whole-piece PCM array. Byte-exact reproducibility applies to this pinned offline renderer, while browser realtime paths owe semantic parity unless they emit bytes under that same contract.

Inline URL, secure expiring session URL, `.refrain.json` file, and MCP embedded resource are implemented delivery envelopes over one exact artifact byte sequence, digest, media type, and renderer. A session token is high-entropy, operator-scoped, no-store, origin-restricted, identity-revalidated delivery state with typed missing/expired behavior; it is never continuity authority. The bounded Structure@1 projection exposes source-derived whole-form facts and explicit current detail without turning model payloads or DOM into expanded-event mirrors.

### Canvas, sound programme, and release

The Canvas remains a Faye/Selen production-aesthetic lane. The retired D frontend was disposable engineering UI that proved view-model, transport, selection, delivery, accessibility, and scale contracts; it was never production visual direction. Production G now selectively transplants Selen's approved v1 visual language onto the same shared renderer rather than forking URL/MCP or inheriting the test shell. Paper Sonata is the default grammar; Prism, Nocturne Ink, and Herbarium remain explicit alternate grammars. The Canvas is a map for hearing, form, recurrence, and selection—not a DAW. The current transplant remains a private candidate until its remaining full-desktop, accessibility, real-host, and owner acceptance gates pass.

Broad release requires exact evidence for a relational gesture, vignette, complete piece, and stress piece; at least four materially different Faye-accepted palettes; independent acoustic and synthetic identities; progressive loading and full transport; one shared accessible renderer; real target-host trials; rights and project-license closure; clean install; release/migration notes; and an explicit public-release decision. Mechanical tests never declare beauty or broaden a bounded listening decision.

## Approved local extension-pack and musical-language programme

The owner-approved 2026-08-26 programme adds a small stable core plus optional local extension packs. A pack is a distribution envelope, never a new hidden music authority: each semantic module has its own exact identity, provenance, and validator, and existing AIR, profile, scene, palette, binding, plan, receipt, and artifact authorities remain explicit. Installing a pack does not mutate old works, make every asset resident, or silently expand the vocabulary visible to an authoring host.

### Typed modules and local lifecycle

`refrain-extension-pack@0-experimental` may carry independently digest-addressed candidate shards, assets, `SoundProfile` fragments, `RenderScene` definitions, and `PaletteRecipe` definitions. The container manifest binds those modules and their asset provenance but is not part of AIR identity. Local state distinguishes installed metadata, hydrated bytes, an explicitly active authoring shelf, and the exact closure required by one AIR plus binding. Resolution and hydration are closure-scoped. Uninstall must refuse while an archived work pins the pack or one of its modules unless the operator explicitly removes that archive pin first.

The I/P0 compiler boundary introduced one explicit immutable core-only authoring-vocabulary closure per compile. No ambient installed-pack registry may alter a compile, receipt, model schema, or old artifact. AIR@1, defined below, keeps that rule while carrying exact core and pack-contributed definitions portably in source.

### Exact performance vNext

P0 introduces new exact profile, scene, palette, binding, plan, render-receipt, and artifact versions rather than widening historical strict formats. `SoundProfile@2` may cover a declared subset of the authoring vocabulary; a binding must prove that every instrument used by its AIR is covered. `PaletteRecipe@0` resolves once into an exact `SoundPalette@1` and never remains a live mutable dependency of playback. Old exact artifacts remain importable without rebinding and without becoming valid under the new formats by accident.

`RenderScene@1` is a bounded declarative graph of named acyclic buses, explicit routing predicates, and core-owned processors. Packs may supply parameters and exact assets such as room responses; they may not supply executable plug-ins or arbitrary DSP code. The initial processor vocabulary is intentionally small: gain and placement, bounded filter/EQ, saturation, delay/room, and fade/tail treatment. Parameters, seeds, feedback, graph depth, and tails are bounded. Offline rendering owes byte identity under a pinned renderer contract; browser realtime owes semantic parity and a user gesture before sound.

### Listening evidence and relational truth

`ListeningReport@0` records deterministic structural diagnostics separately from embodiment diagnostics. It may report orchestration density, register occupancy, rhythmic attack clustering, recurrence placement, peak/headroom, silence, clipping, and scene-tail facts; it may not emit a universal pleasantness, genre-fit, intimacy, or compatibility score, and it may not mutate AIR or binding choices.

Refrain's relational contract remains motif ancestry plus explicit transformation, orchestration, recurrence, contrast, and meaningful absence. Sound embodiment may add a separate lineage link, but timbre never replaces musical relation. Acceptance must include materially different authors, models, genres, meters, forms, and sparse/dense textures so that one underlying model or one preferred palette cannot quietly become the product grammar.

### AIR@1 musical-language boundary

`air@1-experimental` is the current complete private authoring contract. One `conductor` owns tempo, an ordered per-bar meter map, and an optional exact pickup. Durations, steps, groove cycles/offsets, and time transforms use reduced rationals with positive denominators no greater than 96; tuplets are explicit `notes:inTimeOf` ratios. Authored sections are compiled against the conductor map, so their boundaries and labels remain exact across mixed meter rather than inheriting a constant-meter approximation.

AIR@1 retains literal, motif, chord, arpeggio, bass, drum-grid, and rest realization bodies and adds non-recursive reusable phrase definitions/references. Named groove definitions apply exact onset offsets and optional velocity scales. Reusable technique definitions contain only the closed portable operation vocabulary—transpose, time/velocity/gate scale, invert, retrograde, rotate, and thin—and may apply only to declared segment kinds. The compiler executes only explicit operations, preserves notated and performed onset separately, enforces the carried instrument range, and emits stable phrase, motif, segment, and section anchors.

Every AIR@1 carries a closed `refrain-air-vocabulary-closure@0-experimental` containing the complete instrument and technique definitions required to interpret it plus a content digest. Core definitions and one ExtensionPack@1 `authoring-vocabulary` module enter that same carried closure; ambient install, hydration, or shelf state never changes old source, compilation, receipt identity, or model-visible syntax. A sound binding may still be unavailable for a valid pack-carried instrument. In that case `hum` returns canonical source and Receipt@1 while marking exact performance unavailable; it never silently substitutes another sound.

The explicit AIR@0-to-AIR@1 migration preserves the prior tempo/meter, motifs, harmony, voices, sections, expression, and realization choices inside the core vocabulary closure. Strict AIR@0 parsing, compilation, receipt, artifact, and continuation readers remain exact historical boundaries. No generic dual-mode coercion may guess which generation an invalid object intended.

Receipt@1 relation evidence is a closed union over exact motif transformation, orchestration handoff, recurrence placement, section contrast, meaningful absence, and extension-prefix continuity. Evidence is re-derived from parent and child compiled sources and identity-bound into the receipt. Optional `refrain-embodiment-lineage@0-experimental` binds exact parent/child performance identities and instrument mapping separately; it cannot prove musical relation.

The checked-in AIR@1 corpus spans 3/4, 4/4, 5/8→7/8, 6/8, and 7/8; pickup, sparse and dense textures, phrase/technique reuse, groove/tuplet lowering, and one pack-carried instrument. It verifies language, compiler, schema, protocol, export, and browser behavior. It does not yet prove independent author-model diversity, genre quality, listening acceptance, or target-host acceptance. Per-note performance controls, broader pitch collections, and microtonality remain later unless real authored pieces establish them as necessary.

## Local authoring operations

The source-tree CLI exposes `draft`, `inspect`, and `hum` alongside binding discovery, fetch, open, export, packs, and stdio MCP. `draft` explicitly creates a silent canonical AIR@1 document with selected core vocabulary; it supplies no composed notes. Local `hum` accepts complete AIR@1 files, uses the canonical musical receipt and Artifact@3 constructors, and writes exact portable artifacts without overwriting existing files. Continuation requires an exact parent Artifact@3 and an explicit relation; omitted child binding selection preserves the parent's default. Explicit built-in IDs or exact binding files are supported. These are file operations around the existing authorities, not additional model-visible MCP tools or a second source grammar.

`inspect` returns bounded structural and source-expression facts and optional before/after comparisons without mutation or a taste score. A section scope includes incoming authored sustains but does not claim audio-tail or masking evidence. Note, expression, instrument, conductor/timing, and binding preservation remain separate observations. Local preview instances use independent exact asset projections and available loopback ports, with long-artifact session delivery on the preview's own origin; opening never authorizes automatic playback.

### Explicit local production

`produce init`, `produce inspect`, and `produce apply` operate on exact AIR@1 Artifact@3 files. The editable `refrain-production-settings@0-experimental` input contains a new binding ID, exact base-binding ID/digest, source revision, and scene constructor inputs (`id`, `master`, `buses`, `routes`). It is an authoring input compiled into existing Scene@1/Binding@1, not a playback authority or a new music grammar. Init snapshots the canonical plan's effective master into the scene; apply constructs a binding without overrides. Existing Scene@1 graphs and full sparse profiles are preserved. Binding@0 conversion explicitly creates a new Profile@2/Scene@1/renderer@2/plan@4 authority with the original exact candidate selections; it does not claim cross-version audio byte identity.

Apply retains source, caption, musical receipt, all prior bindings/render receipts/projections and appends the new binding as default. A prior palette remains attached to its original binding; new production does not inherit listening acceptance. Writes refuse overwrite, stale source/binding targets fail, conflicting binding IDs fail, and the canonical execution plan must resolve before publication. Inspection reports first-match routes, complete ordered bus chains, raw/effective gain layers, candidate chains and current candidate resolution. A single shared route resolver serves browser, offline execution and inspection. Identical instrument/role voices are explicitly inseparable under Scene@1; selectors and effects are whole-piece group controls. Silent voices retain source and routing but report no resolved sound; required instrument IDs follow compiled sounding events. Applying production to a fully silent draft fails explicitly because Binding@1 requires a non-empty executed instrument closure.

Scene@1 retains its six exact processor types and existing algorithms. Parametric EQ, high-pass, dynamics processors, aux sends, voice-ID selectors and general automation are not added by this workflow; their future introduction requires versioned contracts. Binding@1 validation now enforces permitted/ranged overrides and the complete palette-to-profile/scene identity graph rather than accepting re-hashed contradictions.
