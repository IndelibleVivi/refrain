# Start with an air

[English overview](../README.md) · [中文入口](../README.zh-CN.md) · [Connect your agent](MCP.md)

Refrain's conversational experience is **your agent → `hum` → Canvas → your listening response**. This guide first opens a checked-in example so you can try the same Canvas before configuring an agent. The example is authored music, not a request to a generation service.

Try [the interactive demo](https://indeliblevivi.github.io/refrain/) without installing anything. Playback, themes, and local artifact save/reopen work in the browser; authoring uses your own agent. The source-install path follows.

## Install from source

You need Git, **Node.js 22.23.1 or newer**, npm, and a modern browser. The development/CI paths are exercised on macOS and Linux; Windows setup has not been verified. Refrain is experimental source software, with no published npm package or public MCP endpoint.

```bash
git clone https://github.com/IndelibleVivi/refrain.git
cd refrain
npm ci
node bin/refrain.mjs doctor
```

Installing dependencies uses the npm registry. `doctor` itself needs neither network nor authentication; it should report a supported Node runtime and available local entrypoints.

Commands below run from this checkout. No global installation is required. Optionally run `npm link` once to use `refrain` in place of `node bin/refrain.mjs`; keep the checkout in place because this is a source-tree link.

## Hear the first example

```bash
npm run try
```

The first-listen browser page opens with **Velvet Mischief · 夜色偏心**, with **After the Door · 门后** available in **Playlist**. The visualization is the main stage; its unified playback controls sit below it. The playlist stays in a closed side sheet until requested. No AIR or MCP knowledge is needed to listen. Press **Play** (▶) to begin. The Player’s playlist control cycles through sequential, repeat-all, shuffle, and repeat-one; only a real natural end advances or repeats a work. Pause, stop, seek, errors, and a stale prior playback do not. Use **EN / 中文** to choose English or Chinese. The interface starts in the browser’s language (Chinese or English); a language change keeps the current playback position, selected passage, and open details. The choice lasts for this view, without storing a user profile. You can pause, restart, navigate sections, and select a motif directly in the visualization. **Inside this air** opens passage and motif context, technical facts and exact-selection controls. The work’s sound chooser is another disclosure when multiple bindings are available.

Open **Appearance** to choose between Paper Sonata, Prism, Nocturne Ink, and Herbarium. The drawer is closed during normal listening. **Work presentation** is the default; **My appearance** recalls this device’s preferences without mixing them into the author’s presentation. Palette presets come first, with optional fine color controls and a local image’s strength, blur, position and fit. The same image material reaches the Canvas; each composer keeps its structure. Scalar preferences use browser local storage; the image Blob uses IndexedDB. They remain presentation state, preserve playback/selection and exact artifact bytes, and can be reset for the current theme. The image is not uploaded and browser storage is not an archival backup. Theme and instrument names, authored titles/captions, and technical diagnostic details retain their original wording. **Refrain hums an air.** is shared across languages; there is no separate translated product name.

These complete works retain their original acoustic and synthetic sounds. Local setup acquires their exact samples; the public page loads needed samples after Play. No provider key is needed. The first-listen process stays in the terminal; **Ctrl+C** closes it. If a browser does not open, use the loopback URL printed in the terminal. It starts on port 4318 or the next available port.

For a specific AIR or saved artifact, use the ordinary CLI preview:

```bash
node bin/refrain.mjs open fixtures/air-v1/synthetic-counterpulse.air.json --binding f-synthetic-beat@0
```

That command supports `--no-open` to print a URL without launching a browser, and `--json` for an agent-readable session result.

The ordinary CLI preview URL is temporary and belongs to this computer. It is not a shareable hosted work or a durable save. Save the artifact before closing a preview you want to keep.

## Open a Player from your agent

Use the same local command for one work, several works or a saved list:

```bash
refrain open first.refrain.json second.refrain.json --theme nocturne-ink
refrain open evening.refrain-playlist.json --no-open --json
```

`--theme` sets the work presentation without changing the music. For a saved list it explicitly overrides every entry’s theme; omitted flags preserve saved presentation and listening bindings. The CLI verifies each artifact, prepares only the selected exact sound closure (a checked union for a list), and starts an independent loopback Player. `--json` returns a compact expiring locator, not the score or photos. Keep the process running. No browser audio starts until a person plays; previous/next also count as deliberate play actions.

A saved list holds at most 256 entries, each with its full artifact and optional `bindingId` and `presentation: { theme, appearance? }`. Only validated color/opacity/blur scalars are portable. The listener’s **My appearance** preferences never overwrite authored presentation when saving a list. There is no background-image API or additional MCP tool.

## Keep the piece

Choose **Export Refrain artifact** below the piece; technical details do not need to be expanded. The saved `.refrain.json` contains the score and exact performance choices. Open **Playlist → Add airs / open playlist** to add saved artifacts (multiple files are supported) or replace the queue with one saved `.refrain-playlist.json`. Reorder/remove entries and edit the list name; **Save playlist** keeps every complete artifact, authored presentation, current entry and selected sound. It does not include samples, local photos, or playback progress; reopening never starts audio. File contents stay in the browser and are not uploaded. **About Refrain → Open example playlist** returns to the two featured works. The page carries the two featured works’ union of exact sounds, so an imported work can also play when its full required-asset closure is already present byte-for-byte. Other sampled works remain exact but may need the CLI in a runtime that has their sounds.

Open **Share this air** to use the zero-upload Easy Share path. The link always names the current exact binding and theme. It can optionally carry the current bounded scalar colors, but never the browser-local background image or its Blob URL. The two featured works use short catalog locators bound to their exact artifact SHA-256; a small imported artifact may travel inline only when the configured public receiver advertises its exact plan and complete asset closure. The link contains readable, forwardable music and caption data—it is not encrypted or revocable. Oversize works or works whose sounds are absent from the public receiver report that they need a static listening package. That package/export-publish workflow is not implemented in this source line, and Refrain never silently uploads or substitutes the work.

An imported artifact with multiple sounds exposes **Sound for this listening view**. Switching stops playback and resets its position; press Play to hear the choice. Save keeps the complete document, all carried sound versions and render/projection evidence, and its original default. It does not save the view-only choice or reduce the file to the currently playing sound. Valid unbound files and files with no default remain inspectable and saveable; select a carried sound where available. Missing samples never cause an automatic replacement sound.

For WAV, MIDI, and the full export directory:

```bash
node bin/refrain.mjs export fixtures/air-v1/synthetic-counterpulse.air.json --binding f-synthetic-beat@0 --out tmp/first-air
```

The output directory contains portable `.refrain.json` and `.air.json` files, a native WAV, MIDI, and exact performance/provenance sidecars. The command prints their locations. Reopen the portable artifact with:

```bash
node bin/refrain.mjs open tmp/first-air/pulse-leaves-a-door-open.refrain.json
```

Use a new output directory for a second export. Native WAV retains the selected production levels; `--matched-preview` adds an explicitly loudness-matched listening preview. MIDI approximates the performance and does not preserve Refrain's synths or effects. A `.refrain.json` retains exact musical and performance choices; sampled sound bytes may need to be acquired separately when reopening elsewhere.

## Bring your agent into the loop

Follow [Connect your agent](MCP.md) to build the self-contained Canvas and register the local MCP command. An Apps-capable host can show the piece inside your conversation. Ask, for example:

> Use Refrain to write a short musical reply to this moment. Give it a clear melody, a contrasting middle, and an ending. Use the Canvas's available synthetic instruments. Keep our private conversation in the host; send only the music and a caption I would choose to share.

The agent must author the notes. `hum` validates and compiles its complete source; it does not infer a song from a mood label. Musical judgment belongs to the agent and listener. Browser playback does not send audio into the model.

For an agent with local file access, the [Refrain Skill](../plugins/refrain/README.md) adds progressive composition, arrangement, and production guidance. Its workflow is:

```text
discover sounds → draft silent AIR → agent authors music → inspect → hum
                                                        → produce → open / export
```

`draft` deliberately starts silent. `produce` adjusts explicit group level, placement, low-pass, saturation, delay, room, and fade in a new performance binding while keeping the score unchanged. Read the [local authoring workflow](../plugins/refrain/skills/refrain-air-authoring/references/local-workflow.md) and [production guide](../plugins/refrain/skills/refrain-air-authoring/references/production.md) when you need them.

## Try acoustic sound locally

```bash
node bin/refrain.mjs bindings list
node bin/refrain.mjs open fixtures/f-palettes/acoustic-chamber-native.air.json --binding f-acoustic-chamber@0
```

Opening prepares only the chosen work's required sound assets, verifies their recorded byte counts and digests, and serves them from the preview's loopback origin. This step may download substantial data from the asset sources documented in [Sound sources](SOUND-SOURCES.md). It takes longer than the synthetic example. The acoustic palettes are listening candidates.

The MCP Canvas currently has no sample asset plane. An exact sampled binding remains attached there, with playback visibly unavailable. Use the ordinary browser path above for sampled playback; there is no silent substitution.

## If something does not work

| What you see                               | Next action                                                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Unsupported Node or missing dependencies   | Check `node --version`, install the required Node version, then run `npm ci` and `doctor` from this checkout.                                 |
| Browser did not open                       | Run the same `open` command with `--no-open`; open its printed loopback URL on this computer.                                                 |
| No sound yet                               | Press Play, check the page's playback status, then browser/site and device volume. Sound never auto-plays.                                    |
| An old session URL no longer loads         | Reopen the saved `.refrain.json`; the old preview process/session is not storage.                                                             |
| MCP Canvas is not built                    | Run `npm run build:mcp-host` in the checkout, then restart the host's MCP connection.                                                         |
| `hum` works but no embedded Canvas appears | Check whether the host implements MCP Apps. See the [host boundary](MCP.md#host-boundary).                                                    |
| An exact sound is unavailable              | Keep the original artifact. Use a runtime with its exact sound closure, or explicitly choose another binding.                                 |
| Host download is refused                   | The Canvas reports the host result; exact clipboard fallback requires host permission. Save with the local CLI if you have the artifact file. |

For a reproducible issue, include the command, `doctor` output with personal paths removed, expected/observed behavior, and a small public-safe AIR if needed. Do not paste private conversations, session URLs, credentials, or personal exports into an issue.
