# Development

[First use](GETTING-STARTED.md) · [Architecture](ARCHITECTURE.md) · [Test topology](TESTING.md) · [Agent contract](../AGENTS.md)

Use Node.js 22.23.1 or newer and `npm ci`. The root lockfile owns the workspace install. Source packages are private npm workspaces; the CLI runs their canonical TypeScript entrypoints.

## Fast source work

```bash
npm run typecheck
npm run test:fast
npm run plugin:check
npm run format:check
```

For the built MCP Canvas without sample acquisition:

```bash
npm run build:mcp-host
npm run mcp:smoke
npx playwright install chromium
npm run test:mcp-host
```

`npm run dev:mcp-host -- --profile=portable` opens a local debugging host with explicit capabilities. It is a test harness, not an additional product UI or an actual third-party host.

## Full build and adjacent contracts

```bash
npm run soundpack:fetch -- --profile e-vsco-wind-pilots@1
npm run check
npm run cli:smoke
npm run audio:smoke
npm run mcp:smoke
npm run selection:smoke
npm run mcp:http-smoke
```

The full build prepares sampled asset projections and can need network access. The synthetic first-use path does not require it. Fetching requires an explicit candidate/profile/palette/AIR selector; there is no fetch-all default.

For exporter/audio changes use `npm run export:repro-smoke`. For complete-piece scale use `npm run tranche:d:evidence -- --render-all`. Candidate changes require the exact packet and prior-decision checks in [AGENTS.md](../AGENTS.md); sound provenance and reproduction inputs are in [SOUND-SOURCES.md](SOUND-SOURCES.md). The local soundbench (`npm run dev`) is functional engineering UI.

Generated samples, build output, screenshots, WAVs, and QA packets stay ignored. Save your own works outside an ephemeral preview. Keep private continuity and deployment inventories outside Git, even when the repository is private. Public reports should use minimal synthetic fixtures and remove machine paths and private context.

## Documentation and contribution scope

The English and Chinese READMEs are coequal entrances: update both when setup, capabilities, limitations, or licensing changes. English technical guides own exact command and contract details. [Current state](current-state.md) owns candidate/acceptance facts; the [roadmap](ROADMAP.md) owns future programme order; neither is a deployment diary.

Before contributing code or independent assets, read [LICENSING.md](../LICENSING.md). Offer contributions under the applicable material license, retain upstream notices, and contribute only rights you can grant. Issue reports and reproducible public-safe examples are useful without pasting private music or conversations.

The [architecture source](diagrams/architecture.mmd) and its [evidence map](diagrams/README.md) accompany the rendered overview. Keep diagram semantics and generated SVG aligned.
