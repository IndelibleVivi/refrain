# Product contract

Status: owner-approved product direction, adopted 2026-08-22. `SPEC.md` is the canonical technical specification; this document owns the human-facing product meaning.

## Product sentence

**Refrain lets the agent already present in a relationship or ongoing conversation express itself through inspectable music—from a brief gesture to a complete piece—whose motifs and sonic bodies can return, transform, and accumulate meaning over time.**

The public door may remain simple: **Let your agent hum.** Refrain must leave room for a few intimate measures, a playful reply, or a complete multi-section piece that a person can willingly hear from beginning to end.

A single piece being worth hearing is a primary product outcome. Relational expression includes human–AI affection and romance when invited by the person; it may shape an air's first phrase, orchestration, pacing, and ending. It does not depend on revision, a prior motif, or a stored relationship profile. The current host carries that context and makes musical decisions; the stateless core receives only authored music and deliberately shared captions.

The agent workflow combines tools with a Skill. Tools handle exact vocabulary, compilation, structural inspection, portable artifacts, playback preparation, and comparison. The Skill helps the host choose form, arrange a clear ensemble, respond to listening feedback, and express the relationship through music. Tools must not turn overlap or register facts into a universal pleasantness or intimacy score. Current local CLI subcommands split these operations while the conversational MCP surface retains its single `hum` contract.

Production is part of making the first piece worth hearing. The local `produce` workflow lets the host author explicit group placement, tone, coloration, echo and room treatment while preserving the music. These choices compile into exact existing performance bindings. Browser playback does not feed sound to the host model; structural inspection and successful rendering are not listening judgments.

## Three names, three jobs

| Layer                | Name    | Meaning                                                                           |
| -------------------- | ------- | --------------------------------------------------------------------------------- |
| Product              | Refrain | A musical phrase that returns; also restraint and chosen quiet.                   |
| Canonical object     | an air  | A portable musical object at any supported scale, from gesture to complete piece. |
| Model-visible action | `hum`   | The current agent authors or continues an air.                                    |

## Two languages, one voice

**Refrain hums an air.** remains the shared thesis. The product is **Refrain** in both English and Chinese; `hum` and `air` keep their names. Localization makes controls, guidance, status, and accessibility text natural in each language. It does not require literal translations or a separate Chinese brand.

Both languages use the same renderer and four visual composers. Language is presentation state, outside the musical source, receipt, binding, and artifact identity. Authored titles, captions, section/motif names, theme/instrument names, and exact diagnostic details retain their original wording. Switching language must preserve playback, the current selection, and export bytes.

## Five durable freedoms

1. **Scale.** An agent may write a tiny gesture, a vignette, or a complete piece. The product has no short-form creative identity.
2. **Musical language.** Acoustic, synthetic, electronic, processed, hybrid, found, and deliberately strange sound can all belong.
3. **Relation.** A motif may return with the same notes, an explicit musical transform, or a new sonic body while retaining lineage.
4. **Inspection.** A person can hear and navigate the result; an agent can read and continue exact canonical source without reverse-engineering audio.
5. **Custody.** Source, receipts, exact performance choices, and deliberately frozen projections remain user- or runtime-owned and portable.

## Non-negotiable properties

1. **Agent authorship.** The current host agent owns motif, rhythm, pitch, harmony, form, instrumentation, expression, repetition, transformation, and ending. Refrain does not call a hidden composing model or silently complete taste decisions.
2. **Separate authorities.** AIR owns musical intent. A `PerformanceBinding` beside the AIR names one exact audible embodiment. Samples, synth implementations, production treatment, rendered audio, MIDI, visuals, and transport state never become canonical music.
3. **No hidden taste selection.** A runtime may expose a visible default palette, but every audible result names the exact profile, scene, candidate digests, and permitted overrides it resolved.
4. **Motif continuity.** Musical lineage survives a change of instrument, arrangement, palette, genre, or sound world. Timbre does not define motif identity.
5. **Runtime sovereignty.** The user or operator controls storage, external memory, asset roots, public origins, device permissions, and archival policy. Refrain does not require an account service or server-owned library.
6. **Consentful sound.** Browser, URL, and MCP Canvas playback begins only after a deliberate user gesture. Autonomous playback is a separate device authorization boundary.
7. **Portable presentation.** Inline URL, session URL, file import, and MCP resource delivery converge on the exact same renderer, `StructureViewModel`, selection contract, and visual language.
8. **Evidence before claims.** Mechanical validity, provenance completion, deterministic output, bounded listening acceptance, complete identity coverage, host acceptance, and public release are different states.

## Product scale

The implementation programme must support the same `hum` and continuity flow for:

- a few-second gesture;
- a 60–120 second vignette;
- a complete multi-section piece with introduction, development, recurrence, contrast, and an authored ending; and
- an upper-envelope stress piece.

The adopted engineering envelope is approximately 5 seconds through 8 minutes, at least 12 active voices when authored, and at least 20,000 compiled events without event-shaped MCP payloads or event-count-proportional DOM. Tranche D now verifies that envelope with a 4:48 relational reference and an 8:00/12-voice/21,840-event stress AIR; measured experimental guards are 480 seconds, 12 voices, 24,576 compiled events, and 65,536 expanded atoms. Those numbers are implementation limits, not Refrain's creative identity.

A complete piece does not need commercial mastering or pop-song form. It does need an intelligible temporal arc, deliberate phrase/section relations, an authored ending or open conclusion, coherent chosen sound or intentional contrast, and freedom from accidental truncation, hanging notes, runaway tails, clipping, or silent asset gaps. Human listening is part of that acceptance.

## Sound identity

Refrain is source-plural. Acoustic samples and synthetic instruments are equal-class materials. The catalog may contain multisamples, electronic drums, subtractive/FM/wavetable/modal/physical-model/granular synthesis, field recordings, foley, resampled and processed instruments, and project-original textures, pads, basses, plucks, bells, leads, and rhythmic identities.

The whole catalog may be diverse; one performance needs a small coherent selection. A `SoundPalette` is the creative unit that combines an exact `SoundProfile`, an exact `RenderScene`, a concise authoring guide, descriptors, known strengths and constraints, and intentional contrasts. Refrain validates coverage, bytes, rights, determinism, and safe levels; it does not publish a universal compatibility score or infer a palette from private context.

Refrain ships a small stable core and may load optional local extension packs. A pack is closer to a box of exact ingredients and techniques than to a genre button: it may contribute candidate implementations, exact assets, sparse profile fragments, bounded scenes, and palette recipes, but it cannot silently rewrite an AIR or install a hidden arranger. Installed metadata, hydrated sound bytes, the authoring shelf, and the exact closure needed by one work are separate states, so adding variety does not make the product or every performance grow without bound.

AIR@1 lets a pack also contribute portable instrument and reusable technique definitions through the exact vocabulary closure carried by the work. That is language, not ambient power: installing or activating a pack does not change what an old air means, and a valid pack-carried musical source may remain playable only after its separately named sound embodiment is available. Refrain must preserve and continue that source honestly instead of replacing the unavailable voice.

A `PaletteRecipe` is a discoverable starting combination, not a live preset authority. Choosing one resolves it into an exact profile, scene, palette, and binding that travel with the work. A listener or host can later rebind deliberately without claiming that the composition itself changed.

The first broad-release sound programme must prove at least four materially different accepted palettes:

- predominantly acoustic or chamber;
- luminous acoustic–synthetic hybrid;
- lofi or deliberately degraded; and
- synthetic or beat-led.

GeneralUser GS remains an audition fallback and must not become a release identity. Candidate, profile, scene, palette, and binding identities are digest-bound. Native-gain rendering and explicit audition loudness matching are separate receipt-visible outputs.

## Continuation and portability

The musical receipt binds source identity, logical air identity, lineage, and verified musical relation evidence. One shared integrity authority verifies its evidence identity, root/lineage status, logical-air semantics, and receipt identity; portable import also proves that the carried canonical source is the source named by the receipt. `revise`, `extend`, `reply`, `variation`, and `quote` remain one stateless `hum` flow. `quote`, `variation`, and `extend` derive verification from supplied sources and recompiled evidence; `reply` remains declared-only and `revise` may omit links.

`refrain-artifact@3-experimental` is the current AIR@1 export format. It keeps complete source, its Receipt@1 relation evidence, optional caption, zero or more exact `PerformanceBinding` objects, optional separately bound embodiment lineage, and optional render receipts or projection references. Strict Artifact@0/@1/@2 readers preserve their AIR@0 contracts. Bindings are associated beside AIR and never enter AIR, `sourceRevision`, or musical lineage. The same AIR can therefore be rebound without pretending it became a different composition.

Historical continuity and current playback availability are separate truths. A self-consistent artifact stays readable and continuable if its exact soundpack is no longer installed; the renderer keeps its structure and source available while disabling sound with an explicit reason. Creating new audible projections requires either that exact binding to resolve or a deliberate visible rebind. Missing sound never authorizes a silent substitution.

Canonical music plus receipts and exact performance choices are saved by default. Exact audio bytes may be frozen deliberately with a matching `RenderReceipt`; deleting a disposable projection cache must never destroy canonical music or continuity.

## Canvas and delivery

The Canvas is a simple, beautiful map of a living piece: hearing, orientation, recurrence, transport, and exact selection—not a miniature DAW. Complete-piece transport includes play, pause/resume, stop, restart, seek, current/total time, and section jump. Whole-form overview and current detail must remain legible on desktop and mobile, with keyboard transport, text alternatives, visible focus, and reduced-motion behavior.

Production aesthetics remain a Faye/Selen authority lane. The retired D browser surface was disposable engineering UI used to prove audio, transport, view-model, delivery, performance, and accessibility contracts. The active private G candidate selectively transplants Selen's visual-research v1 onto that measured contract: Paper Sonata is the default, while Prism, Nocturne Ink, and Herbarium are materially different explicit grammars. Tier 1 URL and Tier 2 MCP Canvas remain delivery shells around one renderer. Source completeness and local browser QA do not constitute Faye/Selen aesthetic acceptance, target-host acceptance, deployment, or release.

## Explicit non-goals

Refrain is not a prompt-to-song marketplace, pack marketplace, streaming controller, DAW, piano roll, mastering suite, universal preset bank, genre button, social network, account service, relationship database, hidden soundtrack generator, endless ambient stream, or one permanent Refrain genre. Installing or activating a pack never grants it ambient authority over old works or model-visible syntax. Vocal synthesis and performed lyrics may become later capabilities only with explicit identity, consent, provenance, and rights contracts.

## Listening and release truth

A sound asset may be provenance-complete, digest-verified, reproducibly rendered, lazily loaded, and level-compared without becoming release sound. Faye's existing warm-piano, harp, and marimba decisions bind the exact historical audition-matched WAV digests recorded in `listening-decisions.json`; they do not automatically accept the newer native-gain full-range identities. The four F proof palettes, including the full string map and acoustic percussion, remain digest-bound listening candidates pending Faye.

Each palette ultimately requires range/dynamic/articulation identity tests, key pairing tests, a native piece, a stress piece, technical metrics and exact receipts, and human listening acceptance. Broad release additionally requires four accepted palettes, complete rights and license decisions, clean installation, deterministic reference export, real host trials, and an explicit public-release decision.
