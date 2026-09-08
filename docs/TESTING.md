# Test topology

Refrain separates fast source feedback, browser-host behavior, package evidence,
activated-runtime evidence, and owner acceptance. A green lane proves only the
claim named here; evidence from an earlier lane does not silently satisfy a later
package, deployment, real-host, listening, or release boundary.

## Surfaces

| Surface                   | Claim                                                                                                                                                                                 | Default local command                                                                                                                      | Ordinary CI                                                                                         | Still outside this lane                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `core`                    | AIR parsing/schema, compiler transforms, receipt/artifact identity, and deterministic projections agree.                                                                              | `npm run test:fast`                                                                                                                        | Yes: `unit-and-contracts`                                                                           | Author/model diversity, musical quality, and owner acceptance.                                                                |
| `audio-runtime`           | Execution bundles, exact preparation, transport state, and offline/block rendering preserve their contracts.                                                                          | `npm run test:fast`; use `npm run audio:smoke` for the adjacent runtime smoke.                                                             | Focused state machines are ordinary CI; the smoke remains in `clean-production`.                    | Device- and listener-specific sound acceptance.                                                                               |
| `renderer`                | The bounded view model, Selen adapter/runtime, exact selection, and artifact-scoped engine lifecycle remain coherent.                                                                 | `npm run test:fast`; use `npm run test:mcp-host` for rendered MCP interaction.                                                             | Yes: focused state machines plus `mcp-host-browser`.                                                | Faye/Selen aesthetic acceptance and target-host rendering policy.                                                             |
| `cli-url`                 | The linked `refrain` command resolves canonical entrypoints from another working directory; its URL renderer preserves exact binding/assets and starts sampled sound only after Play. | `npm run cli:smoke`; for playback use `refrain open <air> --binding <id> --no-open` plus a real-browser user-gesture check.                | CLI dispatch and capability semantics are in ordinary tests; real sampled playback is manual/local. | Global installation on another machine, device sound, listening judgment, or public package distribution.                     |
| `mcp-contract`            | Tool schema/result, resource metadata, CSP, self-contained HTML, and exact performance status agree at the MCP boundary.                                                              | After a production build, `npm run mcp:http-smoke`.                                                                                        | Yes: `clean-production`.                                                                            | ChatGPT template admission/cache and tunnel transport.                                                                        |
| `mcp-host`                | The exact self-contained App executes in Chromium under explicit host capabilities, with observable export, selection, user-gesture, and lifecycle behavior.                          | `npm run test:mcp-host`                                                                                                                    | Yes: `mcp-host-browser`.                                                                            | Undocumented ChatGPT internals, workspace policy, Secure MCP Tunnel, and owner observation.                                   |
| `package`                 | A clean committed revision produces a manifest- and release-identity-bearing runtime candidate that passes isolated container MCP readback.                                           | `npm run mcp:package -- --out=<new-ignored-path>`; follow the [self-host runbook](runbooks/self-host-mcp.md) for the isolated image check. | No; `clean-production` is adjacent build/smoke evidence, not package proof.                         | Installed image selection, activated service, tunnel association, and live host behavior.                                     |
| `activated-runtime`       | The exact immutable image is selected live and reproduces release identity, Docker health, MCP readback, and tunnel readiness after the switch.                                       | Snapshot, switch, and post-activation sequence in the [self-host runbook](runbooks/self-host-mcp.md).                                      | No.                                                                                                 | ChatGPT admission/cache/policy, host interaction, owner judgment, rights, and release approval.                               |
| `remote-owner-acceptance` | The selected deployed revision works through the real tunnel and host and is accepted by its human owner.                                                                             | Manual sequence in the [self-host runbook](runbooks/self-host-mcp.md).                                                                     | No.                                                                                                 | This is the remote/owner boundary itself: ChatGPT, other hosts, Faye listening/visual judgment, rights, and release approval. |

`npm run check` remains the broad source check (`typecheck`, deterministic tests,
and workspace builds). Sound-candidate, export, package, complete-piece, and release
work keeps its additional gates in [`AGENTS.md`](../AGENTS.md); the command table
above does not replace them.

## Local CLI lane

After `npm ci`, link the source tree once and verify it from another working directory:

```bash
npm link
cd /tmp
refrain --json doctor
refrain --json bindings list
```

`doctor` is local, no-auth, and network-free. `bindings list` reads the canonical built-in binding authority. `refrain draft`, `inspect`, local `hum`, `produce`, `fetch`, `open`, `export`, `packs`, and `mcp stdio` dispatch the existing repository implementations; they do not define a second grammar or runtime. The deterministic CLI tests prove dispatch and working-directory behavior. After `npm run build:mcp-host`, `npm run mcp:smoke` additionally starts the formal `refrain mcp stdio` CLI from another directory and asserts its exact single self-contained production resource and zero-network CSP. The formal entrypoint sets its own production mode/package root; a missing Canvas build must report the build command. The CLI loads TypeScript directly into its child process; concurrent preview regressions cover awaited cleanup through both SIGINT and SIGTERM without an intermediate tsx signal relay. A sampled URL acceptance additionally requires a real browser: before Play the engine remains idle; after the user gesture it must reach a concrete adapter with a nonzero exact opening-asset count and no console errors or warnings.

The authoring lane additionally checks silent draft validity, exact vocabulary, rejected overwrites and no-op revisions, strict malformed-artifact rejection, inherited binding/receipt continuity, section carry-in, and separate note/expression comparison. CLI process tests run from another working directory. Preview checks must keep two distinct sampled works open concurrently, exercise both returned URLs and the long-artifact same-origin session, and verify the first preview retains its own exact assets after the second starts. The independent Skill use exercise is evidence for that one local invocation, not general author diversity or listening quality.

## Local MCP host lane

Install the root development dependencies and Chromium once:

```bash
npm install
npx playwright install chromium
```

Then use the two stable entry points:

```bash
# Headless regression lane across the declared profiles.
npm run test:mcp-host

# Headful debugging with one explicit capability contract.
npm run dev:mcp-host -- --profile=portable

# Reproduce the mobile host plus reordered JSON-delivery seam.
npm run dev:mcp-host -- --profile=chat-file --device=mobile --transport=reordered
```

`dev:mcp-host` requires exactly one `chat-file`, `portable`, or `restricted`
capability profile. `--device=desktop|mobile` and
`--transport=preserve|reordered` are orthogonal and default to `desktop` and
`preserve`. The harness loads the production-equivalent self-contained App, not a
copied React/renderer implementation, and exposes the resource identity/size,
resource metadata, fixture and binding, selected dimensions, host calls, console
failures, and evidence location.

One automated development-lifecycle subcase separately imports Skybridge's canonical
`hum` virtual view entry under React development `StrictMode`. It exists only to
observe setup-cleanup-setup before the first Play gesture; its small HTML shell is
not production resource authority and never replaces the exact self-contained App
used by the rest of the lane and by `dev:mcp-host`.

| Profile      | Observable contract                                                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chat-file`  | Chat temporary-file upload, download-URL lookup, external open, and selection-return APIs are present. A desktop chat upload/URL failure remains terminal; a mobile host leaves those raw methods present but Refrain must choose portable download before calling them. |
| `portable`   | No Chat file extension is present. Portable `ui/download-file` is accepted; the current portable selection-return route is available.                                                                                                                                    |
| `restricted` | No Chat file extension is present. Portable download and clipboard operations are rejected, and selection return fails explicitly rather than reporting success.                                                                                                         |

| Dimension   | Values                   | Observable contract                                                                                                                                                                                                                                             |
| ----------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `device`    | `desktop`, `mobile`      | Drives explicit MCP host `platform`, touch/hover capabilities, and safe-area context. The mobile regression retains all three raw Chat file methods and proves both Artifact@3 and AIR source use portable export.                                              |
| `transport` | `preserve`, `reordered`  | Either carries tool-result object insertion order unchanged or recursively reorders every plain-object key while preserving arrays. The latter proves Receipt@1 and Artifact@3 survive the observed host-delivery transformation.                               |
| permission  | resource request + grant | The resource's `_meta.ui.permissions` is carried into evidence. Clipboard is visible only when `clipboardWrite` was requested and granted; the local fallback test proves orchestration and exact bytes, not that a real mobile host must grant the permission. |

The headless lane permits only its local harness/MCP origins plus `data:`, `blob:`,
and `about:` URLs. It does not fetch sampled sound content; an external request is
a test failure. Playwright traces, screenshots, and the bounded host evidence ledger
are written under `output/playwright/mcp-host/` on failure. CI uploads only that
directory on failure and retains it for seven days.

`npm run test:fast` is the full deterministic Vitest lane with two bounded workers;
it neither downloads a browser nor fetches sampled sound. `npm run test:mcp-host` assumes Chromium is already
installed, performs no external network access, and exercises the zero-asset host
surface. Its mobile dimension is a local Chromium/device/host-protocol emulation,
not native ChatGPT mobile WebView acceptance. Browser installation itself is a
separate one-time network operation.

## Prior live failures and the new evidence boundary

| Prior failure class                                                                      | Local evidence now responsible                                                                                                                                                                                         | What remains remote-only                                                                                                      | Effect on the old failure                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secure MCP Tunnel could carry MCP JSON-RPC but not Canvas asset `GET`s.                  | `mcp-contract` proves one self-contained resource; `mcp-host` executes it while denying external script/style/font/sample requests.                                                                                    | The real tunnel transport and host's fetch path.                                                                              | Prevents reintroducing an asset-dependent App and localizes unexpected network use; the tunnel limitation still required one real-host discovery. |
| Template/resource identity, compatibility metadata, CSP, or cache-pointer drift.         | `mcp-contract` compares the listed/read resource and metadata; `mcp-host` proves that the returned bytes mount under the declared CSP.                                                                                 | ChatGPT template admission, connector refresh, and cache behavior.                                                            | Prevents source-level drift and localizes mount failure before deployment; host cache/admission still needs owner-host evidence.                  |
| Host JSON delivery reordered nested Receipt@1 object keys.                               | Core fixed-ID/Node-parity tests reconstruct the closed serializer order; `mcp-host` recursively reorders every plain-object key before the iframe parses and exports Artifact@3.                                       | A deployed host may perform other undocumented transformations.                                                               | Prevents JSON insertion order from becoming musical identity while preserving canonical historical IDs and array semantics.                       |
| A sampled binding had to remain exact while zero-asset Canvas execution was unavailable. | `mcp-contract` and `mcp-host` require the exact Artifact binding plus the correct unavailable status and no engine creation.                                                                                           | Owner observation of the deployed host wording and controls.                                                                  | Prevents silent rebinding or a false audible claim; remote presentation still receives acceptance.                                                |
| ChatGPT mobile temporary-file loading failed after AIR source serialization.             | `device=mobile` with `profile=chat-file` keeps the raw extension present but requires both JSON exports to call portable `ui/download-file`; a second case proves permission-gated clipboard fallback after rejection. | ChatGPT's current mobile download policy, clipboard grant, native save sheet, and workspace policy.                           | Prevents mobile routing from entering the observed failing temporary-file lane; one real refreshed connector still determines acceptance.         |
| React StrictMode cleanup disposed the artifact identity slot used by the second setup.   | Focused renderer tests plus `mcp-host` setup-cleanup-setup and Artifact A-to-B replacement.                                                                                                                            | No ChatGPT-specific proof is needed for the identity-slot invariant; a real host still supplies final integration acceptance. | Should prevent the source regression rather than rediscover it remotely.                                                                          |
| Exact selection return could drift into a lossy payload or implicit second `hum`.        | `mcp-host` performs a real visible selection and captures the exact parent-bound handoff; core tests retain serializer/continuation invariants.                                                                        | The host/model's later response to that handoff.                                                                              | Prevents payload and invocation drift; conversation behavior still needs real-host acceptance.                                                    |
| Production resource metadata or CSP differed from the rendered App's needs.              | `mcp-contract` validates discovery/read metadata and `mcp-host` fails unexpected runtime network access or mount errors.                                                                                               | The deployed revision identity and ChatGPT's own CSP interpretation/admission.                                                | Localizes the first bad boundary earlier; it cannot certify the real host.                                                                        |

The host harness models only Refrain's observable dependency surface. It is not a
ChatGPT simulator and does not establish package identity, deployed runtime identity,
tunnel health, undocumented host behavior, or owner acceptance.

Production regressions cover unchanged source/music receipt/candidate choices, effective master materialization, silent voices and non-empty executed closure, sparse-profile and graph preservation, stale settings and conflicting IDs, identical instrument/role groups, actual first-match routing, changed but repeated-identical audio, retained prior render evidence, fresh CLI processes and native export reproduction. Re-identified invalid Binding@1 overrides and palette cross-references must fail. Production inspection proves planned routing, not hearing or acoustic masking. Real-browser playback remains required for shared audio changes.

The MCP-host suite also switches English ↔ Chinese on desktop and mobile during playback and pause. It checks retained passage controls, focus, one audio context, and identical artifact export bytes. Existing host scenarios explicitly use Chinese; bilingual scenarios start from an English browser locale.

The first-listen browser lane (`npm run test:try`) builds the static presentation and serves it below `/refrain/`. Desktop and 390px checks cover pre-gesture silence, synthetic playback, four appearance changes, language synchronization, retained selection/focus/position, exact artifact download and local reopen, invalid-file recovery, and broken-link errors. It rejects sample requests and requests outside the static origin. These are local browser observations, not public-host deployment or listening acceptance. The MCP language cases also traverse every appearance while retaining exact host export bytes.
