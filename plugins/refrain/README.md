# Refrain Skill candidate

[Install the runtime](../../docs/GETTING-STARTED.md) · [Connect MCP + Canvas](../../docs/MCP.md)

This directory contains a **Skill-only Codex Plugin source candidate, version 0.3.0**. It helps the current host agent compose, inspect, produce, and continue music through Refrain. It is not a marketplace installation or an automatically configured MCP connection, and it does not bundle the CLI runtime.

For a local agent with file access, install the source-tree CLI first (`npm ci`, optionally `npm link`), then ask it explicitly:

> Read `plugins/refrain/skills/refrain-air-authoring/SKILL.md` in this checkout and use it to make a Refrain air for me. Start by checking the local runtime. Keep our conversation in the host; save only the music and the caption I choose to share.

Reading the Skill this way is an explicit file-based workflow. It does not claim that your host has installed or automatically discovered the Plugin. The manifest at [`.codex-plugin/plugin.json`](.codex-plugin/plugin.json) declares the Skill files; it declares no MCP server or hosted app. Connect those separately through the [MCP guide](../../docs/MCP.md).

The Skill has one entry and loads detail as needed:

| Need                                           | Reference                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| First piece, form, relational expression       | [Relational composition](skills/refrain-air-authoring/references/relational-composition.md)       |
| Multi-voice clarity and listening feedback     | [Arrangement and listening](skills/refrain-air-authoring/references/arrangement-and-listening.md) |
| Discover → draft → inspect → hum → open/export | [Local workflow](skills/refrain-air-authoring/references/local-workflow.md)                       |
| Group levels, placement, tone, echo, room      | [Production](skills/refrain-air-authoring/references/production.md)                               |
| Exact MCP authoring and continuation           | [Current contract](skills/refrain-air-authoring/references/current-contract.md)                   |

The agent authors the notes and production choices. `draft` starts silent; the compiler makes no hidden taste decisions. Structural reports and successful playback do not mean that the model heard the audio. A person's listening response remains part of making the piece better.

The `submission/` files are directory-listing preparation material only. They do not establish a published Plugin, public service, or release acceptance.
