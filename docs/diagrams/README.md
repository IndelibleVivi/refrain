# Architecture overview source

This diagram answers: **how does music authored in a conversation become an inspectable, playable, portable air?** Its audience is a new Refrain user. It omits internal DSP stages, candidate storage, deployment machinery, and historical format migrations; [ARCHITECTURE.md](../ARCHITECTURE.md) owns those details.

## Semantic model

| Node                   | Responsibility                                                                                                         | Source evidence                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| H — host agent + Skill | Chooses the music using host-held context; no conversation store is added to Refrain.                                  | [Product contract](../PRODUCT.md), [Skill](../../plugins/refrain/skills/refrain-air-authoring/SKILL.md) |
| T — MCP hum / CLI      | Validates and compiles authored AIR; there is no composing model.                                                      | [Server factory](../../packages/mcp-server/src/server-factory.ts), [CLI](../../bin/refrain.mjs)         |
| A — portable artifact  | Carries canonical AIR, musical receipt, and exact performance bindings.                                                | [Portable artifact](../../packages/renderer/src/portable.ts)                                            |
| V — Canvas             | Projects the artifact through one renderer in MCP and ordinary browser delivery; playback starts after a user gesture. | [AirRenderer](../../packages/renderer/src/AirRenderer.tsx)                                              |
| E — saved files        | Gives the user portable source/artifact and explicit audio/MIDI projections.                                           | [Exporter](../../apps/presentation/src/export-air.ts)                                                   |

Edges carry authored music/caption and chosen performance, the returned artifact, presentation input, explicitly exported files, and a user-selected region with its parent artifact. The exact sound binding travels beside the score inside A; explicit Play belongs to V. The selection return depends on host capabilities. The host, stateless Refrain core, and shared presentation are the actual regions; the artifact is user/host-custodied data, not a server library. Only explicit authoring/rebinding creates new musical/performance authorities. Transport state and files rendered from them do not replace the score.

All nodes describe source-implemented behavior. This diagram asserts neither a public service nor current deployment or named-host acceptance.

## Render

Editable source: [architecture.mmd](architecture.mmd). Portable output: [architecture.svg](architecture.svg).

```bash
npx --yes --package @mermaid-js/mermaid-cli@11.17.0 mmdc -i docs/diagrams/architecture.mmd -o docs/diagrams/architecture.svg -b transparent
```

Mermaid CLI is a documentation tool, not a Refrain runtime dependency. It needs a Chromium installation; a local `-p <puppeteer-config.json>` can select an existing executable. Inspect the actual SVG after regeneration for clipped labels, crossing connectors, and readability. The source and evidence map remain authoritative if renderer typography changes.
