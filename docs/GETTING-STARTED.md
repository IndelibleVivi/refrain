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

During publication preparation, cloning requires access to the private repository. See [current state](current-state.md) for the publication boundary. Installing dependencies uses the npm registry. `doctor` itself needs neither network nor authentication; it should report a supported Node runtime and available local entrypoints.

Commands below run from this checkout. No global installation is required. Optionally run `npm link` once to use `refrain` in place of `node bin/refrain.mjs`; keep the checkout in place because this is a source-tree link.

## Hear the first example

```bash
npm run try
```

The first-listen browser page opens with **Velvet Mischief · 夜色偏心**, with **After the Door · 门后** available beside it. Playback controls are above the score. No AIR or MCP knowledge is needed to listen. Press **Play** (▶) to begin. Use **EN / 中文** to choose English or Chinese. The interface starts in the browser’s language (Chinese or English); a language change keeps the current playback position, selected passage, and open details. The choice lasts for this view, without storing a user profile. You can pause, restart, navigate sections, and select a motif or segment to inspect its place in the piece.

Use the appearance menu above the piece to switch between Paper Sonata, Prism, Nocturne Ink, and Herbarium. Theme changes retain playback, the selected passage, open details, and exact artifact bytes. Theme and instrument names, authored titles/captions, and technical diagnostic details retain their original wording. **Refrain hums an air.** is shared across languages; there is no separate translated product name.

These complete works retain their original acoustic and synthetic sounds. Local setup acquires their exact samples; the public page loads needed samples after Play. No provider key is needed. The first-listen process stays in the terminal; **Ctrl+C** closes it. If a browser does not open, use the loopback URL printed in the terminal. It starts on port 4318 or the next available port.

For a specific AIR or saved artifact, use the ordinary CLI preview:

```bash
node bin/refrain.mjs open fixtures/air-v1/synthetic-counterpulse.air.json --binding f-synthetic-beat@0
```

That command supports `--no-open` to print a URL without launching a browser, and `--json` for an agent-readable session result.

The preview URL is temporary and belongs to this computer. It is not a shareable hosted work or a durable save. Save the artifact before closing a preview you want to keep.

## Keep the piece

Choose **Export Refrain artifact** below the piece; technical details do not need to be expanded. The saved `.refrain.json` contains the score and exact performance choices. In the first-listen page, use **Open a saved air** to return to it. File contents stay in the browser and are not uploaded. **Back to the example** returns to the built-in sketch. The page carries the two featured works’ exact sounds. Other sampled works remain exact but may need the CLI in a runtime that has their sounds.

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
