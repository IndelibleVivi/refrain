# Local authoring and refinement

This workflow uses the installed source-tree `refrain` CLI from any working directory. Use a user-owned output directory and relative file arguments. `draft`, `inspect`, `hum`, `open`, and `export` accept `--json` for machine-readable results. Authoring results contain bounded facts and file paths; complete AIR and Artifact bytes live in the files. Existing output files are never overwritten by `draft` or `hum`.

## Select a body and start the score

```sh
refrain --json doctor
refrain bindings list --json
refrain draft --out response.air.json --title "A place beside you" --instruments lattice_pluck,sub_bass --tempo 96 --meter 4/4 --bars 8 --json
```

Binding discovery includes exact IDs, instrument coverage, and each palette's authoring guide. The eight synth instruments in `f-synthetic-beat@0` also execute in the zero-asset MCP Canvas. Sampled instruments require an ordinary browser with the exact assets available.

`draft` creates valid **silent** AIR@1 with the selected immutable vocabulary already carried. Defaults are 96 BPM, 4/4, eight bars. Every initial voice has a placeholder `lead` role and a full-length rest. Edit this file to author music: choose the actual roles, sections, motifs, notes, and expression. The draft is not a finished composition. It is a score document, not a parallel input grammar.

For more or different built-in instruments, explicitly create another draft with the desired `--instruments` and carry that generated vocabulary into the authored source. Never hand-edit a vocabulary digest. Extension vocabulary remains an exact pack-carried source contract, not something `draft` guesses.

## Useful AIR@1 notation

- `C4/4` is a quarter note; `F#4/8` an eighth; `r/2` a half rest; `[C4,E4,G4]/1` a whole-note chord. In literal voice/segment parts, a bar separator `|` marks a bar boundary. Motif definitions do not accept `|`; write their note/rest sequence without separators. In 4/4 each bar totals four quarter-note beats.
- Voice roles are exactly `lead`, `harmony`, `counter`, `bass`, `pulse`, `percussion`, and `texture`.
- `motifs` maps names to notation strings. A voice can carry `part` or a `realize` segment list, never both.
- A segment such as `{ "id": "invitation", "kind": "motif", "motif": "door", "repeat": 2, "dynamic": "mp" }` explicitly places a motif. A literal segment uses `"kind": "literal", "part": "..."`; a rest uses a reduced rational beat duration, e.g. `{"numerator": 8, "denominator": 1}` for two 4/4 bars.
- `transform: {"transpose": -12}` changes register. Dynamics, `gate`, articulation, and transforms belong on realization segments. Voice `gainDb` and `pan` affect the entire voice; pan ranges from -1 to 1.
- Voices advance independently from the beginning. Use explicit rests for later entrances. `sections` label ranges with `id`, `startBar`, and `bars`; a label does not move notes.
- Keep motif IDs meaningful. Phrase reuse and transformations reduce repeated source text; they do not excuse identical accompaniment under every return.

Use strict diagnostics for exact grammar/range errors. The live MCP input schema and current parser own advanced syntax; this guide does not introduce alternative spellings. Do not send expanded compiled events to the model.

## Inspect, seal, and hear

```sh
refrain inspect response.air.json --json
refrain hum response.air.json --out response.refrain.json --binding f-synthetic-beat@0 --json
refrain open response.refrain.json --no-open --json
refrain open first.refrain.json second.refrain.json --theme prism --no-open --json
refrain open saved.refrain-playlist.json --no-open --json
```

`inspect` compiles the source or integrity-checks an imported artifact. It reports whole-piece structural ListeningReport facts, section overlap, per-voice register/velocity/gate/gain/pan, and bounded exact motif anchors. Add `--section <id>` and/or `--voice <id>` to focus the report. Section inspection includes authored sustains entering from the preceding section, while sample decay and bus/reverb tails require rendered evidence. Whole-piece facts stay explicitly labeled whole-piece.

Local `hum` seals complete AIR@1 into the same canonical Artifact@3 using the existing `hum` receipt logic. New roots default visibly to `f-synthetic-beat@0`; `--binding` accepts a built-in ID or a file containing an exact Binding@0/@1. Its `performance` field reports runtime selection availability, not acquisition, actual playback, or quality. `--caption` carries only text intentionally shared with the piece.

`open` prepares the selected asset closure, starts an independent loopback preview, and returns the real URL after the server is listening. Show that URL in the host's browser. Keep the process alive. It chooses a free port, so multiple pieces/revisions can remain open without replacing one another's sound assets. `--json` always returns a short expiring same-origin session URL, keeping complete artifact bytes out of the command result; ordinary text mode uses inline delivery where it fits and a session for larger works; the portable artifact file remains the durable authority. Playback starts only from the person's Play gesture. Omit `--no-open` to launch the ordinary browser.

Passing more than one ordinary work, or one saved playlist file, opens the canonical Player as a `refrain-playlist@0-experimental` queue instead of a single work. The report then adds `kind: "playlist"`, `entryCount`, and the exact binding IDs; its URL still stays compact, carrying a same-origin expiring `playlistHref` plus a `playlist` hash with the queue's SHA-256, never the queue itself. The Player fetches that same-origin locator and verifies those exact bytes. A saved playlist keeps its own entry IDs, current entry, and per-entry binding and presentation; the file stays byte-exact when no flag is passed. Multiple input works become `entry-1`, `entry-2`, ... in argument order, keep their canonical artifact documents, and use the union of each work's exact selected assets; two works that name different content for one asset ID are refused rather than silently merged. Entries are verified through the same canonical artifact/selection path as one file. Duplicate IDs, invalid artifacts, a malformed scalar appearance, and an unknown `--theme` are reported as errors. An object claiming any `refrain-playlist@` format must pass the exact playlist parser; it is never reinterpreted as AIR. A saved playlist accepts an empty queue and carries at most 256 entries.

`--binding` and `--theme` are deliberate overrides. An explicit `--binding` applies to every opened work; `--theme` accepts only the four existing theme IDs (`paper-sonata`, `prism`, `nocturne-ink`, `herbarium`) and becomes the authored presentation for the works you pass as files, or overrides each saved entry's saved theme. Neither flag invents a musical choice: a saved entry's own binding is used when you do not override it.

For sampled sound, an asset preparation error names the missing closure. Acquire deliberately:

```sh
refrain fetch --air response.refrain.json --binding f-luminous-hybrid@0
refrain export response.refrain.json --out rendered
```

Select the intended binding in `hum` first. Export preserves that artifact default and emits native WAV, MIDI, source, artifact, and exact sidecars. `--matched-preview` is an explicit separate listening transform, not ordinary export gain. It may take longer to render a complete piece than to compile its score.

## Refine from actual feedback

Keep the exact parent artifact. Author changes in a new AIR file (extract its `source` using ordinary JSON file operations), then inspect before sealing:

```sh
refrain inspect revised.air.json --section return --compare response.refrain.json --json
refrain hum revised.air.json --parent response.refrain.json --relation revise --out revised.refrain.json --json
refrain inspect revised.refrain.json --compare response.refrain.json --json
refrain open revised.refrain.json --no-open --json
```

Comparison runs from `--compare` to the input. Per-voice `notesUnchanged` checks the exact pitch/onset/notated-duration multiset, including duplicates. `expressionUnchanged` separately checks velocity, gate, articulation, sounding duration, and voice mix; `instrumentUnchanged` checks the authored body, and `roleUnchanged` checks the voice role (which can affect scene routing). `timingUnchanged` and `bindingsUnchanged` are separate. AIR alone contains no binding, so compare the sealed artifacts before claiming the sound selection stayed fixed. A section-scoped comparison proves only that scope; do not describe it as whole-piece preservation.

An omitted child binding inherits the parent's exact default (or its sole carried binding), including custom Binding@1; zero or ambiguous bindings stay unbound. This is the same selection rule as MCP `hum`. A carried ID supplied with `--binding` selects that exact historical object before built-ins; an explicit binding file remains local-only. No-op continuations are rejected. `--parent` and `--relation` are required together. The five relations are `revise`, `extend`, `reply`, `variation`, and `quote`. For relations requiring musical evidence, `--evidence evidence.json` carries the existing relation-evidence object; use exact parent and child motif occurrence anchors from `inspect`, not fabricated IDs. The canonical verifier decides whether an asserted relation holds.

These tools make exact operations inexpensive. They do not guarantee that a passage is pleasant, decide what romance sounds like, normalize a mix, or replace listening with a density score.

For sound treatment that preserves AIR and its musical receipt, use [production.md](production.md) and `refrain produce`. Use musical revision only when notes or authored expression actually change.
