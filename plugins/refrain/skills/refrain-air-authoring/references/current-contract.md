# Current Refrain authoring contract

This is a compact, drift-checked routing reference for the Plugin candidate. The live `hum` input and output schemas remain authoritative.

## Current formats and authority

- New work uses `air@1-experimental`.
- A successful current result carries one exact `refrain-artifact@3-experimental` containing canonical source, Receipt@1, optional caption, exact performance bindings, and optional render or projection evidence.
- For continuation, pass that Artifact@3 unchanged as `from.parentArtifact` and choose `revise`, `extend`, `reply`, `variation`, or `quote`.
- Refrain is stateless musical infrastructure. Never pass only an artifact, source, receipt, or air ID and expect server lookup.
- The host agent authors the music. Refrain normalizes explicit notation and transforms, validates limits and identity, compiles deterministically, and emits diagnostics; it does not make taste decisions or compose missing material.

## Public zero-asset Canvas

An omitted AIR@1 performance binding resolves visibly and exactly to `f-synthetic-beat@0`.

The current self-contained Canvas can execute these eight zero-asset identities:

- `air_pad`
- `clean_bass`
- `dust_texture`
- `glass_bell`
- `lattice_pluck`
- `prism_lead`
- `rhythm_pulse`
- `sub_bass`

To author with any of them, carry [zero-asset-vocabulary.json](zero-asset-vocabulary.json) unchanged as the AIR vocabulary closure. It contains the canonical definitions and exact digest for all eight identities and is checked against source by `npm run plugin:check`; do not reconstruct or trim it by hand.

Sample-backed identities remain valid canonical AIR and retain their exact binding, but the public zero-asset Canvas reports playback unavailable instead of silently rebinding them. Ordinary browser/self-hosted surfaces may provide their exact sampled assets separately.

## Whole-air limits

- Source: at most 65,536 bytes.
- Duration: at most 480 seconds.
- Voices: at most 12.
- Compiled note events: at most 24,576.
- Expanded atoms: at most 65,536.
- Motif nesting depth: at most 16.

The input schema publishes exact field shapes and rules, notation syntax, meter and rational-duration rules, voice roles, ranges, section limits, and one exact minimal `lattice_pluck` example. It does not publish the other seven complete zero-asset definitions or a reusable eight-identity digest. Use the generated closure above when those identities matter, and inspect the live schema rather than reconstructing the remaining grammar from this compact reference.

## Observable behavior

- `hum` has no server-account write, no public internet side effect, and no destructive mutation.
- Playback requires a user gesture.
- Invalid AIR returns strict typed diagnostics and no presentation artifact.
- A canonical sample-backed result may be successful while its `performanceStatus` is unavailable in the zero-asset Canvas.
- Artifact/source export may use host file save, portable download, or exact clipboard fallback according to granted host capabilities. Report which disposition actually occurred.

## Local CLI and generic hosts

The installable source-tree CLI is a thin shell over the same canonical implementations:

- `refrain --json doctor` checks the local runtime without auth or network access.
- `refrain --json bindings list` discovers exact built-in binding IDs, instrument coverage, and palette authoring guidance.
- `refrain draft` creates a valid silent AIR@1 document with exact selected core vocabulary.
- `refrain inspect` reports bounded section/voice/occurrence facts and separate note/expression/body/timing/binding comparison.
- Local `refrain hum` seals a complete AIR@1 file into Artifact@3, with optional exact-parent continuation. See [local-workflow.md](local-workflow.md) for commands and defaults.
- `refrain fetch ...` acquires one explicit candidate, profile, palette, or AIR-plus-binding asset closure.
- `refrain open <air-or-artifact>` prepares only the selected exact asset closure and starts an independent loopback instance of the shared URL renderer with an isolated asset projection and same-origin session when needed; Play still requires a user gesture.
- `refrain export <air-or-artifact>` emits the strict portable artifact, source, MIDI, native WAV, binding, receipt, asset-closure, and provenance projections.
- `refrain packs ...` exposes the existing operator-rooted pack lifecycle.
- `refrain mcp stdio` lets a CLI/agent/harness configure the same one-tool stateless MCP server locally.

These commands do not create another grammar, renderer, hosted library, or composing model. The repo-local Plugin candidate still does not claim a public MCP endpoint or marketplace publication.

Run `npm run plugin:check` after changing the Plugin package or any named contract above.
