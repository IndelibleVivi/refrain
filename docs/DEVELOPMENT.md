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

## First-listen page

```bash
npm run try
npm run build:try
npm run test:try
```

`try` opens the existing presentation app with the two complete works in `examples/demo`, local file reopening, and agent setup guidance. Its loopback server chooses the next port if 4318 is occupied. `build:try` writes a static site to `apps/presentation/dist-try/` with only the exact demo sample closure from the ignored `.demo-assets` projection, never the general presentation public directory, SoundFonts, or worklets. It uses relative asset paths so the output can be served from a subdirectory. The output includes the selected license texts and notices for the npm modules actually bundled; it reuses the MCP Canvas guard to exclude the unused SoundFont implementation. `test:try` exercises that built site under `/refrain/` in desktop and 390px Chromium.

To host a first listen, serve the contents of `dist-try/` over HTTPS on an operator-chosen static host. No Refrain server, model key, user account, or upload endpoint is needed. The build does not deploy anything; the public demo is hosted at https://indeliblevivi.github.io/refrain/. Preserve the selected licenses and the repository link when distributing it. Do not expose a private MCP origin to host this page.

The page imports the two exact Artifact@3 files in `examples/demo` through `first-air.ts` and the canonical presentation verifier. It mounts the same `AirRenderer` as the CLI/MCP paths. The example is authored music; this page does not compose. Imported artifacts retain their bindings. `prepare:demo` derives the union of the works’ exact asset requirements through the existing resolver and content store, verifies bytes/digests, and publishes those samples plus provenance and third-party notices. Playback uses that same-origin plane only for the featured receipt/binding identities; other imported sampled works remain unavailable rather than silently rebinding. Ordinary CLI previews retain their prepared same-origin sample plane.

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

The full build prepares sampled asset projections and can need network access. The public demo is already prepared; local `try` prepares its two works on first use. Fetching requires an explicit candidate/profile/palette/AIR selector; there is no fetch-all default.

For exporter/audio changes use `npm run export:repro-smoke`. For complete-piece scale use `npm run tranche:d:evidence -- --render-all`. Candidate changes require the exact packet and prior-decision checks in [AGENTS.md](../AGENTS.md); sound provenance and reproduction inputs are in [SOUND-SOURCES.md](SOUND-SOURCES.md). The local soundbench (`npm run dev`) is functional engineering UI.

Generated samples, build output, screenshots, WAVs, and QA packets stay ignored. Save your own works outside an ephemeral preview. Keep private continuity and deployment inventories outside Git, even when the repository is private. Public reports should use minimal synthetic fixtures and remove machine paths and private context.

## Documentation and contribution scope

The English and Chinese READMEs are coequal entrances: update both when setup, capabilities, limitations, or licensing changes. English technical guides own exact command and contract details. [Current state](current-state.md) owns candidate/acceptance facts; the [roadmap](ROADMAP.md) owns future programme order; neither is a deployment diary.

Before contributing code or independent assets, read [LICENSING.md](../LICENSING.md). Offer contributions under the applicable material license, retain upstream notices, and contribute only rights you can grant. Issue reports and reproducible public-safe examples are useful without pasting private music or conversations.

The [architecture source](diagrams/architecture.mmd) and its [evidence map](diagrams/README.md) accompany the rendered overview. Keep diagram semantics and generated SVG aligned.

The `pages.yml` workflow builds and tests the static site on pushes to `main` or manual dispatch, then publishes only `apps/presentation/dist-try/`. The build job has read-only repository access; only the deployment job has Pages and OIDC write permissions. GitHub Pages uses the `github-pages` environment. To redeploy, rerun that workflow at the intended revision; rollback by reverting the source change and letting the same workflow publish. Verify the public URL with explicit Play and check the deployment revision separately from CI.
