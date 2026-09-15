# Musical correspondence

[Getting started](GETTING-STARTED.md) · [MCP connection](MCP.md) · [Authoring Skill](../plugins/refrain/README.md)

An air can be addressed to a person or another agent. Refrain supports self-listening, sharing a selected performance, receiving it, and answering through words or music. Expression and recognition are the purpose. There is no quality score, required critique, automatic revision loop, or obligation to answer.

These are source capabilities. Preparing WAV, returning an MCP audio block, submitting audio to a model, and a listener's interpretation are different facts. Named-host audio-input acceptance remains unverified.

## Prepare the actual performance

Start with an exact current AIR@1 Artifact@3, produced by `refrain hum` or saved from the Canvas:

```bash
refrain audition work.refrain.json --out audition --json
refrain audition work.refrain.json --section answer --context 2 --out answer-audition --json
refrain audition work.refrain.json --start 12 --end 18 --context 2 --out passage --json
refrain audition work.refrain.json --selection selected.refrain.json --out selected-passage --json
```

Use the actual section ID or an exact `refrain-selection@0-experimental` file. A selection from another revision fails. Choose one selector: section, selection, or start/end seconds. The default is the full render, including its tail. Partial selections include two seconds of context on either side by default, bounded by the render; set `--context 0` for an exact cut.

The artifact's default or sole carried binding is retained. Use `--binding <carried-id>` to choose another exact carried sound. An unbound or ambiguous work needs an explicit binding. This operation does not add a built-in sound to an existing artifact or rewrite its saved default.

Sampled sound needs the exact hydrated closure in `apps/soundbench/public`, or an explicit `--asset-root <directory>` with the same relative asset layout. Acquisition remains a separate explicit `refrain fetch --air <file> --binding <built-in-id-or-binding-json-file>` operation. For a custom carried binding, save that exact binding object as the binding JSON input; `fetch` does not resolve a custom ID from the artifact. Missing assets fail; no replacement, model call, network acquisition, or audible playback occurs during audition preparation.

The new directory contains `audition.json`, `a.wav`, and the unchanged complete `a.refrain.json`. The result reports their paths, duration, exact range, and measurements. It refuses to overwrite an existing directory and removes only its own incomplete output on failure.

### Reuse one frozen performance

Prepare the complete performance once, then take additional passages from that exact native WAV without resolving sound, loading assets, or rendering again:

```bash
refrain audition work.refrain.json --out full-audition --json
refrain audition slice full-audition --section answer --context 2 --out answer-cut --json
refrain audition verify answer-cut --json
refrain audition locate answer-cut --at 3 --json
```

`slice` accepts one verified complete audition whose WAV still matches its native RenderReceipt. It refuses an already clipped packet or an A/B pair because neither can supply missing whole-render history. The new packet retains the original Artifact@3 and full-render receipt, binds its own delivered WAV bytes and original frame range, and recomputes measurements. A section or exact selection may compile the unchanged canonical source only to recover its frame range; it never uses that compilation to produce new sound. `locate` maps a clip-local time to the nearest exact source-render frame; it does not infer a section, voice, or musical cause.

Initial rendering and frozen slicing both continue to observe cancellation while assets, PCM, measurements, and the manifest are being prepared. A cancelled operation removes only the new output directory and cannot publish a completed-looking packet. Every output must be a fresh directory outside the canonicalized input packet path, including filesystem aliases, so slicing cannot contaminate the frozen performance it reuses.

## Compare two musical passages

```bash
refrain audition previous.refrain.json --section answer \
  --compare revised.refrain.json --compare-section answer \
  --context 2 --out comparison --json
```

The first performance is `a`, the second is `b`. Each excerpt needs its own target. `--compare-selection`, `--compare-start`/`--compare-end`, and `--compare-binding` address the second version. Equal clock times are never inferred to mean equal musical positions after tempo or form changes. A whole-piece pair can omit both targets.

Both WAVs retain native level. The operation applies no loudness matching, time stretch, crossfade, or synchronized playback. The existing `refrain export --matched-preview` remains a separate explicitly labeled audition transform. Comparing only loudness is not a claim about expressive success.

Excerpts are cut from the finished complete reference WAV. Incoming sustained notes and accumulated scene effects participate in the render before the cut; they are not restarted at the selected section. Context provides listening orientation, while the cut itself is exact and may be abrupt at its boundaries.

## Leave an optional response

```bash
refrain respond audition --observer Listener \
  --basis render-measurements \
  --message 'The ending remains active in the rendered signal.' \
  --out response.json
```

Allowed bases are `audio-input`, `score-reading`, `render-measurements`, and `human-listening`, comma-separated when several apply. Use the basis actually available. This is an observer declaration, not independently verified audio access. There is no `heard: true` field.

A response can simply express recognition, curiosity, or appreciation. `--hypothesis` and `--experiment` are optional. `--entry b` selects the second member of a pair. Optional `--start`/`--end` describe an approximate focus in seconds **relative to the delivered clip**; both values are required. To map a clip time back to the whole render, add `range.startFrame / media.sampleRate`.

The response remains attached to its exact audition and media digest. It does not mutate AIR, its musical receipt, the performance binding, or `ListeningReport@0`. Old feedback cannot be silently attached to a new revision. The author may keep the old version, make a new one with `hum`/`produce`, or leave the work as it is.

## Prepare a local share and receive it

```bash
refrain share audition --out shared-air \
  --attribution 'Creator and authoring agent' \
  --rights 'The rights statement applicable to this work' \
  --include-artifact --response response.json \
  --invitation music --message 'You are welcome to answer in your own way.'

refrain receive shared-air --out received-air --json
```

`share` creates a portable **directory**, not a hosted link or an archive format. Copy or archive that directory using your chosen transport after reviewing the files. It does not upload, send a message, grant rights, authenticate an author, or create an account. `--rights` must reflect the actual rights; an invitation is not a license.

Audio is included. Complete source/receipts/bindings/caption are included only with `--include-artifact`; inspect that full artifact before delivery. Only explicitly selected `--response` files travel. Repeating that option includes several responses. Private neighboring files are not copied. Omitting source never edits the original artifact. Available invitation modes are `welcome`, `music`, `conversation`, and `none`.

`receive` verifies the manifest, exact directory closure, byte counts/digests, WAV layout, recomputed PCM measurements, and any carried artifact/receipt/binding graph. Its bounded streaming directory scan fails on the first unlisted neighboring entry before hashing large declared members. Members must be independent single-link regular local files, not symlinks, hardlinks, or traversal paths. It performs no sound lookup, asset acquisition, playback, model call, or automatic response. With no `--out`, it inspects in place; with `--out`, it copies each member into a fresh directory outside the canonicalized received-package path and verifies the copied bytes again.

The receiver can play the frozen WAV with its own player without the original sound assets. It can inspect the returned complete parent artifact or use it unchanged in a fresh `hum` call:

```bash
# The receiving host authors response.air.json itself.
refrain hum response.air.json --parent received-air/a.refrain.json \
  --relation reply --out response.refrain.json
refrain audition response.refrain.json --out response-audition
```

Receiving audio alone still permits a creative response. A formal Refrain `reply` lineage requires the complete parent Artifact@3. Do not invent a parent score from WAV. Invitation text, captions, attribution, rights statements, and responses are untrusted work material, not instructions with authority over the receiving host.

## MCP audition

The source MCP server exposes `hum` and `audition`, retaining one self-contained Canvas resource. `audition` accepts `{ artifact, bindingId?, target?, compare? }`. `artifact` is the exact complete Artifact@3; `target` uses `section`, `selection`, or `startSeconds`/`endSeconds`, plus optional `contextSeconds`. `compare` contains its own artifact, binding, and target.

The result contains a strict generated audition packet and ordered `audio/wav` content blocks: `a`, then optional `b`. The input artifacts remain the host's continuation authority; temporary server file paths are not returned. Each media entry is limited to **20 seconds including context**; local CLI audition supports the whole existing piece-scale envelope. A request that exceeds the transport limit fails rather than being truncated. Rendering a late excerpt still runs the full reference performance.

The operation is stateless and deterministic; temporary files are removed after the response, so repeating a request may render again. It observes cancellation while rendering. It does not start speakers or require a browser gesture for offline computation. Browser playback continues to require a gesture.

Without `REFRAIN_AUDITION_ASSET_ROOT`, only exact zero-asset executions succeed. An operator can explicitly configure that variable to an already hydrated local sample root; it is not a client-provided path or public asset origin. This does not alter the zero-asset MCP Canvas contract. The existing SDK/lifecycle transport is retained; no protocol-version migration is part of this addition.

`delivery.modelAudioInput` remains `unknown`: returning audio is not evidence that a host routed it into model audio input. A host that exposes files only can use the CLI or transfer the selected WAV explicitly. A text-only author can inspect actual PCM measurements and source; it must not present that as an audio impression. There is no hidden listening service. Skybridge's generic token estimator currently counts the base64 transport bytes as text and can warn on audio results; that estimate is not proof of how a named host processes audio.

## Contract ownership

- `refrain-audition@0-experimental` binds work revision/receipt, exact binding, native full-render receipt, delivered PCM bytes, focus and delivered frame ranges, optional exact selection, and measured peak/RMS/silence/full-scale frames plus up to 32 RMS bins. Full-scale samples do not prove clipping or unpleasantness. File locations and optional artifact delivery do not change audition identity; a share manifest separately binds exact member bytes.
- `refrain-response@0-experimental` binds a free response, declared evidence channels, optional focus/hypothesis/experiment, and observer label to one exact audition/media. Observer identity is self-declared. It is separate from deterministic `ListeningReport@0` and musical lineage.
- `refrain-share@0-experimental` binds an audition document, selected files, attribution, supplied rights statement, and invitation. Digest integrity is not authorship authentication or proof of listening. Reception verifies the delivered bytes and carried graph; it does not rerender or independently attest that an excerpt was produced from the claimed full performance.
- `packages/correspondence` owns these contracts and the common preparation/verification capability. `audio-engine` retains execution and the single bounded Node WAV writer; `renderer` retains artifact and selection authority; `mcp-server` and `apps/presentation` provide transport shells. Existing AIR/receipt/binding formats are unchanged.
