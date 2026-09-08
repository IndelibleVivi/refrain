# Current state

Last reconciled: 2026-09-08. This page describes source and acceptance status, not a live deployment inventory.

## Available in this source tree

- Current music source: `air@1-experimental`; AIR@0 remains an exact historical reader and explicit migration input. Current portable output is Artifact@3 with Receipt@1. Performance bindings remain separate from musical identity.
- Canonical parsing/compilation, multi-section and multi-voice form, motifs/phrases/techniques, meter changes, pickup, rational time, groove, exact selection, native WAV/MIDI export, and stateless continuation are implemented.
- English and Chinese interface prose share one Canvas. The visible language switch preserves playback, passage selection, open details, and exact export bytes. Refrain / hum / air and authored content retain their names.
- A first-listen root (`npm run try`) opens a checked-in synthetic air with bilingual guidance, local save/reopen, and a path to agent setup. `npm run build:try` produces a zero-sample static site; no public URL has been deployed.
- Appearance menus in both Canvas surfaces expose all four themes while preserving playback and selection. Browser playback controls sit above the score, and artifact saving is available outside technical details.
- The shared renderer serves loopback URLs and a self-contained MCP App (`ui://refrain/hum/v3.html`). Paper Sonata, Prism, Nocturne Ink, and Herbarium use the same source/selection/audio authority.
- The formal source-tree CLI supports doctor, bindings, draft, inspect, local hum, produce, fetch, open, export, packs, and MCP stdio. The stdio entrypoint requires a Canvas build and selects the production resource independently of caller working directory. CLI operations do not become additional model-visible MCP tools.
- The Skill-only Plugin is a **0.3.0 source candidate**. Source presence does not establish Plugin installation, activation, directory publication, or a configured MCP connection.
- Exact local production uses group level/placement, low-pass, saturation, delay, room, and fade. It preserves music and existing authorities while adding a new exact binding. It does not add general automation, a DAW, per-voice routing, or model hearing.
- Local extension packs separate installed metadata, hydrated assets, authoring shelf, execution closure, and archive pins. Pack-carried language is explicit in the AIR vocabulary, never an ambient modification of old works.

## Sound and limits

- Seventeen core instrument identities and thirty-three immutable candidate shards are tracked. Eight synthetic identities play without sample assets in MCP Canvas; exact sampled embodiments remain unavailable there. Ordinary browser playback prepares the selected sampled closure.
- Four F proof palettes render native and stress pieces without GeneralUser GS. Their broader listening acceptance remains pending. Three historical piano/harp/marimba audition decisions apply only to their recorded digests.
- Current experimental guards: 480 seconds, 12 voices, 24,576 compiled events, 65,536 expanded atoms, 256 bars, and 65,536 source bytes. The checked-in complete-piece fixtures exercise a 4:48/10-voice reference and an 8:00/12-voice/21,840-event envelope.
- Formats remain experimental. Browser sound starts only after an explicit gesture. Offline deterministic rendering, browser semantic playback, and human listening acceptance are separate claims.

## Evidence and remaining acceptance

The preceding local authoring/production baseline passed 302 tests in 73 files, workspace builds, CLI/audio/MCP/selection/HTTP smokes, export reproduction, complete-piece rendering, pack proofs, accepted-digest reproduction, and 17 Chromium MCP-host scenarios. Sampled and synthetic Artifact@3 plus historical Artifact@2 were exercised in real browser playback. These are recorded baseline observations, not a claim that every environment or future checkout passes.

The initial public-source preparation baseline passed 303 tests in 73 files, workspace builds, CLI/audio/formal-stdio/selection/HTTP smokes, and both complete-piece offline renders. Nineteen Chromium MCP-host scenarios include language switching during playback/pause, retained selection and focus, and byte-identical exports. A separate source-only copy passed dependency installation, synthetic first listen, export/reopen, and the production stdio build/smoke. The shared UI was inspected in both languages and all four themes, with desktop and 390px browser checks. These are baseline observations, not a claim about every subsequent checkout.

The first-listen addition has its own built-site browser lane under a `/refrain/` subdirectory. It exercises desktop/mobile playback, four appearances, language, exact save/reopen, invalid input recovery, and unavailable sampled sound without rebinding. Both this lane and the shared MCP-host suite run in CI. Local builds and CLI/audio/MCP/selection/HTTP smokes have been exercised for this source addition; public hosting and live runtime activation remain separate work.

Runtime bundles carry the selected license texts, sound-source map, and five upstream sound notices. An earlier clean committed-tree bundle and its isolated Node HTTP process reproduced the exact release identity and single self-contained App resource. That bundle predates the first-listen and appearance-menu addition. OCI image construction was not exercised in this preparation. The lockfile now pins `fast-uri` 3.1.7 and `qs` 6.16.0 within existing dependency ranges after dependency advisories were identified during package installation.

Earlier operator-owned ChatGPT trials exercised Canvas, Play/Replay, exact selection, and mobile artifact/source clipboard fallback. Native mobile host save/download, the broader Codex/Claude/Kimi matrix, independent author/model/genre acceptance, and full sound/visual acceptance remain open. Local Chromium profiles do not certify undocumented host behavior. See [TESTING.md](TESTING.md).

## Publication boundary

This repository is the **public canonical source** for Refrain, available for inspection and self-hosted experimentation; it is not a public Refrain service, npm release, published Plugin, or newly activated deployment. The bilingual reader entrance, source-install guide, and architecture diagram belong to this preparation.

Project-original functional materials now use SUL-1.0; authored content and example music use CC BY-NC-SA 4.0. The public repository begins with a clean source history. Private operational continuity stays outside this repository. [LICENSING.md](../LICENSING.md) records the current rights map. [ROADMAP.md](ROADMAP.md) retains the broader acceptance programme; opening source and accepting a broad product release are distinct decisions.
