# Self-host the Refrain MCP App

This runbook deploys one operator-owned Refrain MCP origin. It does not create a Refrain account service, official hosted backend, relationship store, or public endpoint. ChatGPT, Codex, Kimi Code, and other hosts should connect to this same MCP surface rather than receive separate Refrain deployments.

## Boundaries

- The container serves Streamable HTTP at `/mcp`, one self-contained `ui://` Canvas resource, and same-origin sound assets for direct/private clients that can actually reach the origin.
- The reference systemd unit publishes the container only on target-host loopback. Do not expose its port through a public firewall rule or reverse proxy.
- For private OpenAI-host testing, OpenAI Secure MCP Tunnel supplies the outbound-only MCP JSON-RPC transport and OpenAI-side workspace or organization association. It does not proxy browser `GET` requests from the Canvas iframe. Refrain itself remains application-stateless and advertises `noauth` on this private origin.
- The production Canvas therefore embeds its exact JS/CSS, declares no embedded network domains, and exposes exactly one explicit-version App resource. The tool advertises that same URI through standard `_meta.ui.resourceUri` and ChatGPT's `_meta["openai/outputTemplate"]` compatibility alias. The only external-navigation allowance is ChatGPT's own file origin, used after an explicit export gesture by a complete feature-detected temporary-file API on a non-mobile host; exports are not saved to the durable ChatGPT file library. Mobile ChatGPT and other MCP hosts use standard `ui/download-file`. The resource requests standard `clipboardWrite`, and a rejected JSON download falls back to exact clipboard bytes only when that permission is host-granted; host policy may still reject it and must remain visible. Runtime identity remains separate in `release.json`, OCI labels, `/healthz`, and private tool-result metadata; never add a second release resource or build-derived query pointer to the host discovery surface. It is a direct-nodes zero-asset build: tools/list advertises `f-synthetic-beat@0` as the exact host default and an AIR@1 call that omits `performance.bindingId` receives that binding; an explicit selection always wins. For audible Canvas acceptance, author only `air_pad`, `clean_bass`, `dust_texture`, `glass_bell`, `lattice_pluck`, `prism_lead`, `rhythm_pulse`, or `sub_bass`. The same profile deliberately retains sample-backed acoustic identities, so an AIR using one keeps its exact binding but must return unavailable `performanceStatus` before Play. Server and renderer derive that answer from the same execution plan and shared Canvas asset configuration. Do not publish sampled assets as an improvised fix; ordinary browser builds retain sampled playback.
- A later public or shared HTTPS origin needs an operator-supplied OAuth 2.1 authorization boundary. Do not turn a tunnel runtime key into an MCP client credential and do not copy another product's OAuth issuer into Refrain.
- `hum` never accepts private conversation context. Each host authors complete AIR from its own context and sends only the documented tool input.

## Localize host behavior before packaging or deployment

Use the local Chromium lane before spending a package, VPS, tunnel, or owner-host
cycle on App behavior:

```bash
npx playwright install chromium
npm run test:mcp-host
npm run dev:mcp-host -- --profile=chat-file
npm run dev:mcp-host -- --profile=chat-file --device=mobile --transport=reordered
```

The headless command executes the production-equivalent self-contained App under
the declared `chat-file`, `portable`, and `restricted` observable capability
profiles plus orthogonal desktop/mobile host and preserved/reordered JSON-delivery
dimensions. The headful command opens the same harness for one explicit profile
and optional device/transport pair, and reports resource metadata,
fixture/binding, host-call, console, permission, and evidence details. See the
[test topology](../TESTING.md) for the exact claim matrix and failure location.

This lane can localize resource mount, unexpected network access, synthetic versus
sample-unavailable behavior, export routing, selection handoff, user gesture, and
artifact/React lifecycle failures. It does not prove a clean package, the selected
image or deployed revision, tunnel/workspace association, real ChatGPT template
admission or cache, native ChatGPT mobile WebView behavior, current file/workspace
or clipboard policy, undocumented host APIs, or Faye's owner acceptance. Continue
through the rest of this runbook for those boundaries.

## Build one immutable runtime bundle

The runtime bundle and image retain `LICENSE`, `LICENSE-CONTENT`, the layered
`LICENSING.md` map, `docs/SOUND-SOURCES.md`, and all tracked upstream sound notices
under `third_party/`. Project-original source availability does not replace
third-party terms or establish sound-palette acceptance.

First run the built HTTP contract, then package one committed clean source revision:

```bash
npm run build
npm run mcp:http-smoke
npm run mcp:package -- --out=tmp/refrain-mcp-runtime-$(git rev-parse --short=12 HEAD)
```

`mcp:package` refuses a dirty source tree and refuses to replace an existing target. It checks out `HEAD` into a temporary detached worktree, installs from the lockfile, explicitly acquires and digest-verifies the exact `e-vsco-wind-pilots@1` closure, builds there, and copies only that clean revision's production manifests, compiled workspace output, exact Canvas/assets, pinned container/service recipes, and tunnel template. Immutable sound content is reused through one repo-external content-addressed store: `~/Library/Caches/Refrain/sound-content-store` on macOS, `$XDG_CACHE_HOME/refrain/sound-content-store` or `~/.cache/refrain/sound-content-store` on Linux, and `%LOCALAPPDATA%/Refrain/sound-content-store` on Windows. `REFRAIN_SOUND_CONTENT_STORE_ROOT` may select another operator-owned absolute location. A warm object is still re-read and checked against the selected candidate's exact byte count and SHA-256; the fetch command reports completed assets, verified bytes, and warm/cold disposition as acquisition proceeds. The clean worktree never imports compiled output from the developer checkout, while its projected sound files are created only from those reverified CAS objects. `release.json` binds the full source revision, `sourceDirty: false`, a canonical payload digest, and every packaged file's byte count and SHA-256. The bundle contains neither source files nor `node_modules`; the target builds production dependencies from the same lockfile. Packaging must therefore happen after the intended source/docs commit, never as proof of an uncommitted working tree.

Build the image from inside that bundle:

```bash
docker build --file deploy/runtime/Dockerfile --tag refrain-mcp:<source-revision> .
docker image inspect refrain-mcp:<source-revision> \
  --format '{{.Id}} {{index .RepoDigests 0}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{index .Config.Labels "io.refrain.bundle.digest"}}'
```

The materialized Dockerfile copies `release.json` and every tracked root represented by its per-file manifest, including the operator recipes under `deploy/`. It labels the image with the exact source revision and bundle digest, and makes `/healthz` require that identity. Production dependencies remain the `npm ci --omit=dev` projection of the same pinned lockfile rather than entries in that source-bundle manifest. Record the built image ID or repository digest. A mutable tag is a build convenience, not an install or rollback identity.

## Prove the image in isolation

Before either a first install or an upgrade, run the immutable image as a disposable
candidate on an unused loopback port with the same runtime restrictions as the
tracked service:

```bash
candidate_image='sha256:REPLACE_WITH_64_HEX_IMAGE_ID'
candidate_name='refrain-mcp-candidate-REPLACE_WITH_SHORT_REVISION'
candidate_port='18113'

docker run --detach --rm --name "$candidate_name" \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --memory=2g --cpus=2 --pids-limit=256 \
  --publish "127.0.0.1:${candidate_port}:3000" \
  "$candidate_image"

curl -fsS "http://127.0.0.1:${candidate_port}/healthz"
docker inspect --format '{{.Image}} {{.State.Status}} {{.State.Health.Status}} {{.RestartCount}}' "$candidate_name"
```

Wait for Docker health to reach `healthy`; `starting` is pending rather than a
failed candidate. Then use a Streamable HTTP MCP client against that exact loopback
port and perform the complete readback contract described below: exact release
identity, exactly one `hum`, exactly one `ui://refrain/hum/v3.html`, self-contained
App bytes with no external Canvas dependency, available zero-asset synthetic
execution, and exact sampled binding with `sample-origin-missing`. Stop the named
candidate only after recording those results:

```bash
docker stop "$candidate_name"
```

This disposable readback proves the image. It does not install it, change the live
image selection, restart the tunnel, or establish owner-host acceptance.

## First install the private origin

Copy the image or runtime bundle to the target host, then install the tracked unit and an operator-owned environment file:

```bash
sudo test ! -e /etc/refrain-mcp/runtime.env
sudo install -d -m 0755 /etc/refrain-mcp
sudo install -m 0644 deploy/systemd/refrain-mcp.service /etc/systemd/system/refrain-mcp.service
sudo install -m 0644 deploy/systemd/refrain-mcp.env.example /etc/refrain-mcp/runtime.env
sudoedit /etc/refrain-mcp/runtime.env
sudo systemctl daemon-reload
sudo systemctl enable --now refrain-mcp.service
```

This is the first-install path. If `/etc/refrain-mcp/runtime.env` already exists,
do not overwrite it with the example and do not use `enable --now` as an upgrade
transaction; use the snapshot-and-switch procedure below.

Set `REFRAIN_IMAGE` to an immutable image ID (`sha256:…`) or repository digest (`name@sha256:…`) and choose an unused loopback `REFRAIN_PORT`. The tracked unit rejects mutable tags before starting. The reference port is `18101`. Verify the service before adding any remote transport:

```bash
systemctl status refrain-mcp.service --no-pager
curl -i http://127.0.0.1:18101/mcp
curl -fsS http://127.0.0.1:18101/healthz
docker inspect --format '{{.State.Health.Status}}' refrain-mcp
```

`/healthz` must return HTTP 200 with `status: "ok"`, `server: "Refrain"`, and the packaged source revision/bundle SHA-256; a successful `hum` must carry the same identity only in private `refrain/release` result metadata. An unauthenticated plain HTTP probe of `/mcp` may receive an MCP protocol error; it still must not receive a server error. Complete verification uses an MCP client to initialize, list `hum`, confirm that its description names the exact host default and zero-asset instrument closure, call synth-only AIR@1 without an explicit binding and require `performanceStatus: available`, then call a sample-backed AIR and require the same exact binding plus `sample-origin-missing`. It also asserts that resource discovery returns only the advertised App document and confirms its `text/html;profile=mcp-app` MIME type, empty Canvas network-domain declarations, and inline JS/CSS. Origin-level asset probes separately confirm the container's private SoundFont/worklet routes for direct clients; they are not dependencies of the MCP Canvas.

## Attach OpenAI Secure MCP Tunnel

Create a dedicated tunnel in [OpenAI Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels) and associate it with the intended ChatGPT workspace and, when wanted, the Platform organization used by Codex. Create a separate restricted runtime API key whose principal has `Tunnels Read + Use`; never install an admin key in the daemon. Keep the tunnel identity and runtime key dedicated to Refrain rather than copying another product's tunnel, credentials, or OAuth issuer. OpenAI's current transport and association contract is documented in [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

On the target host:

```bash
sudo install -d -o root -g root -m 0700 /etc/refrain-tunnel
sudo install -o root -g root -m 0600 \
  deploy/openai-tunnel/profile.yaml.example \
  /etc/refrain-tunnel/profile.yaml
sudoedit /etc/refrain-tunnel/profile.yaml

sudo install -o root -g root -m 0600 /dev/null \
  /etc/refrain-tunnel/control-plane-api-key
sudoedit /etc/refrain-tunnel/control-plane-api-key

sudo install -d -o root -g root -m 0755 /usr/local/libexec
sudo install -o root -g root -m 0755 \
  deploy/openai-tunnel/refrain-tunnel-preflight \
  /usr/local/libexec/refrain-tunnel-preflight
sudo install -o root -g root -m 0644 \
  deploy/openai-tunnel/refrain-gpt-tunnel.service \
  /etc/systemd/system/refrain-gpt-tunnel.service
```

Replace only `tunnel_id` in the profile when the reference ports remain correct. If `REFRAIN_PORT` is not `18101`, change the profile's sole `mcp.server_urls[].url` to that exact loopback port as well; this URL is the one target authority for both startup preflight and `tunnel-client`. Put only the runtime key in `control-plane-api-key`; do not paste it into the profile, shell history, repository, logs, or this runbook.

The unit uses `DynamicUser=yes` and imports **both** root-only files with systemd `LoadCredential`. The service process and its preflight helper both read `%d/profile.yaml`; the long-running client alone also reads `%d/control-plane-api-key`. The helper requires exactly one loopback HTTP `/mcp` URL, waits up to 60 seconds for that exact endpoint to return either 2xx or a recognized MCP/client-protocol response (`400`, `405`, `406`, or `415`), and then requires the same origin's `/healthz` to expose the exact Refrain release identity. A connection failure, missing route (`404`), other unexpected status, or identity mismatch keeps the gate closed. It does not print the profile, credentials, or target contents. `BindsTo=` and `PartOf=` couple the tunnel lifetime to `refrain-mcp.service`; stopping or replacing the exact origin cannot leave an apparently live tunnel bound to stale state. `After=refrain-mcp.service` alone is insufficient because systemd considers the Docker command started before the container health check finishes. Do not change the service back to reading `/etc/refrain-tunnel/profile.yaml` directly, add a parallel target-port environment variable, or make the directory or profile world-readable to compensate: a dynamic user cannot traverse a root-only `0700` directory without credential injection.

Run `doctor` before enabling the service:

```bash
sudo /usr/local/bin/tunnel-client doctor \
  --profile-file /etc/refrain-tunnel/profile.yaml \
  --control-plane.api-key file:/etc/refrain-tunnel/control-plane-api-key \
  --explain
```

Then install and start the long-running client:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now refrain-gpt-tunnel.service
sleep 6

systemctl show refrain-gpt-tunnel.service \
  -p ActiveState -p SubState -p MainPID -p ExecMainStatus -p NRestarts
curl -fsS http://127.0.0.1:18102/healthz
curl -fsS http://127.0.0.1:18102/readyz
journalctl -u refrain-gpt-tunnel.service -n 100 --no-pager
```

Require stable `active/running`, a nonzero `MainPID`, `ExecMainStatus=0`, no continuing restart growth, `healthz` = `live`, and `readyz` = `ready`. `systemctl is-active` alone is insufficient because a service in `Restart=on-failure` can briefly report active between crashes.

To rerun `doctor` while the daemon already owns port `18102`, give the diagnostic process an ephemeral health listener. Otherwise the healthy live daemon produces a false `health_listener: address already in use` failure:

```bash
sudo /usr/local/bin/tunnel-client doctor \
  --profile-file /etc/refrain-tunnel/profile.yaml \
  --control-plane.api-key file:/etc/refrain-tunnel/control-plane-api-key \
  --health.listen-addr 127.0.0.1:0 \
  --health.url-file /tmp/refrain-doctor-health-url \
  --explain
sudo rm -f /tmp/refrain-doctor-health-url
```

The reference tunnel profile points to `http://127.0.0.1:18101/mcp`; a deployment using another `REFRAIN_PORT` must put that same selected port in this one profile URL. It neither publishes the port nor changes Refrain's MCP contract.

## Upgrade an existing private origin

An upgrade begins only after the new immutable image passes the isolated candidate
readback. Preserve the current image selection and every installed recipe that the
candidate may replace in one root-only rollback snapshot:

```bash
activation_id='REPLACE_WITH_SHORT_REVISION-activation-YYYYMMDD'
snapshot_root="/var/backups/refrain/pre-${activation_id}"

sudo install -d -o root -g root -m 0700 "$snapshot_root"
sudo install -o root -g root -m 0600 \
  /etc/refrain-mcp/runtime.env "$snapshot_root/runtime.env"
sudo install -o root -g root -m 0644 \
  /etc/systemd/system/refrain-mcp.service "$snapshot_root/refrain-mcp.service"
sudo install -o root -g root -m 0644 \
  /etc/systemd/system/refrain-gpt-tunnel.service "$snapshot_root/refrain-gpt-tunnel.service"
sudo install -o root -g root -m 0755 \
  /usr/local/libexec/refrain-tunnel-preflight "$snapshot_root/refrain-tunnel-preflight"
sudo sh -eu -c \
  '/usr/bin/docker inspect --format "{{.Image}}" refrain-mcp > "$1/live-image.txt"' \
  sh "$snapshot_root"

sudo install -o root -g root -m 0600 \
  /etc/refrain-mcp/runtime.env /etc/refrain-mcp/runtime.env.next
sudoedit /etc/refrain-mcp/runtime.env.next
```

Require `live-image.txt` to name the currently running immutable image and retain it
with `runtime.env` as the immediate rollback identity. Set only the staged file's
`REFRAIN_IMAGE` to the candidate's immutable image ID or repository digest; keep the
established loopback port unless the tunnel profile is deliberately changed in the
same reviewed transaction. Install the candidate's tracked service/helper files,
select the staged environment, reload systemd, and restart the origin once:

```bash
sudo install -o root -g root -m 0644 \
  deploy/systemd/refrain-mcp.service /etc/systemd/system/refrain-mcp.service
sudo install -o root -g root -m 0644 \
  deploy/openai-tunnel/refrain-gpt-tunnel.service /etc/systemd/system/refrain-gpt-tunnel.service
sudo install -o root -g root -m 0755 \
  deploy/openai-tunnel/refrain-tunnel-preflight /usr/local/libexec/refrain-tunnel-preflight
sudo install -o root -g root -m 0600 \
  /etc/refrain-mcp/runtime.env.next /etc/refrain-mcp/runtime.env
sudo systemctl daemon-reload
sudo systemctl restart refrain-mcp.service
```

Treat activation as one fail-closed transaction. Require all of these before
accepting the switch:

1. `/healthz` returns the candidate's exact source revision, bundle digest, and file
   count.
2. `docker inspect refrain-mcp` reports the selected immutable image ID, `running`,
   and `healthy`.
3. The post-switch Streamable HTTP MCP readback repeats the isolated candidate's
   exact `hum`, sole App resource, self-contained bytes, synthetic availability,
   sampled-unavailable result, and private release metadata.
4. The tunnel reaches stable `active/running`, `live` / `ready`, and shows no restart
   growth.

The origin can return its exact `/healthz` before Docker's health state leaves the
Dockerfile's 20-second start period. During that bounded window, `starting` means
wait; it is not evidence of failure. Accept neither HTTP identity alone nor Docker
health alone.

If the bounded gate ends with an identity, image, Docker-health, MCP-readback, or
tunnel-readiness mismatch, restore `runtime.env`, the origin unit, the tunnel unit,
and the preflight helper from the snapshot, reload systemd, and restart the origin
once:

```bash
sudo install -o root -g root -m 0600 \
  "$snapshot_root/runtime.env" /etc/refrain-mcp/runtime.env
sudo install -o root -g root -m 0644 \
  "$snapshot_root/refrain-mcp.service" /etc/systemd/system/refrain-mcp.service
sudo install -o root -g root -m 0644 \
  "$snapshot_root/refrain-gpt-tunnel.service" /etc/systemd/system/refrain-gpt-tunnel.service
sudo install -o root -g root -m 0755 \
  "$snapshot_root/refrain-tunnel-preflight" /usr/local/libexec/refrain-tunnel-preflight
sudo systemctl daemon-reload
sudo systemctl restart refrain-mcp.service
```

Re-run the same exact checks against the restored release before diagnosing the
failed candidate. `PartOf=refrain-mcp.service` propagates the origin restart to an
already-active tunnel, so do not issue a duplicate tunnel restart; start the tunnel
explicitly only if it was inactive before the transaction.

## Create the private ChatGPT plugin connection

Keep `refrain-gpt-tunnel.service` healthy and ready throughout connection creation. In the owner-controlled ChatGPT workspace:

1. Open **Settings → Security and login** and enable **Developer mode**.
2. Open [ChatGPT Plugins](https://chatgpt.com/plugins) and select the plus button.
3. Enter the user-facing name `Refrain` and a short description such as `Relational music authoring and Selen Canvas playback through one private self-hosted MCP origin.`
4. Under **Connection**, choose **Tunnel**, then select the dedicated Refrain tunnel or paste its non-secret `tunnel_id`.
5. Choose **No Authentication**. The private OpenAI workspace/tunnel association is the outer transport boundary; Refrain has no account or OAuth issuer.
6. Scan the server, confirm that exactly one model-visible tool named `hum` is discovered, and perform the final **Create** action manually.
7. Start a fresh conversation, enable Refrain from the tools menu, and run the synthetic host acceptance below.

These steps follow OpenAI's current [connect and test a plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt) workflow. If ChatGPT asks for a Refrain, Tilia, or other product OAuth login in this private topology, stop: the wrong authentication mode, tunnel, or app was selected.

### First ChatGPT acceptance

Use the MCP Canvas's synth-only exact binding:

```text
Use Refrain's hum tool to author one complete relational air.

Use only synthetic instrument identities and select exactly:
performance.bindingId = "f-synthetic-beat@0"

Let the form contain a concrete musical approach, reply, and transformed return
between two voices rather than generic background music. Do not autoplay. When
the air is valid, open the Refrain Canvas.
```

Verify that the host calls `hum`, renders the shared Selen Canvas, creates no audio before Play, advances after the explicit Play gesture, pauses/resumes, and returns an exact motif selection in a follow-up. Export the AIR source, portable artifact, and one exact selection. A non-mobile ChatGPT host with its complete file extension must open the generated file; mobile ChatGPT and other hosts must either accept portable `ui/download-file` or visibly report the exact JSON clipboard fallback. A successful connection or tool scan is not yet playback, selection, export, or authorship acceptance.

## Connect other hosts

Codex may use the same associated tunnel only on a surface that exposes that tunnel; otherwise it and Kimi Code use the same private HTTP origin through an operator-controlled route, or the repo's stdio server locally. They do not need another Refrain deployment. Installing the Refrain authoring skill changes how a model writes AIR, not where the MCP server must be deployed.

## Troubleshooting the ChatGPT connection

### Generic `Something went wrong` during Create

Do not recreate the tunnel or repeatedly click Create. Establish which layer received the attempt:

```bash
systemctl show refrain-gpt-tunnel.service \
  -p ActiveState -p SubState -p MainPID -p ExecMainStatus -p NRestarts
curl -fsS http://127.0.0.1:18102/healthz
curl -fsS http://127.0.0.1:18102/readyz
journalctl -u refrain-gpt-tunnel.service --since '-15 min' --no-pager
```

- No ChatGPT command reaches the tunnel: inspect workspace association, `Tunnels Read + Use`, Developer mode policy, and permission propagation in OpenAI Platform/ChatGPT.
- A command reaches the tunnel but the target returns an MCP error: inspect the exact method, HTTP status, response content type, initialization, tool schema, and authentication discovery before changing infrastructure.
- The connector is created and lists `hum`: transport/discovery passed; proceed to real `hum` and Canvas acceptance rather than treating startup warnings as product failure.

### `profile.yaml: permission denied` and a restart loop

The installed unit is stale or was edited to read the root-only profile directly. Install the tracked unit again, run `systemctl daemon-reload`, reset the failed state, and restart. Keep both files `root:root 0600`; the fix is the second `LoadCredential`, not `chmod 0644`.

### `doctor` reports `health_listener ... address already in use`

The live service already owns `127.0.0.1:18102`. Stop it before ordinary `doctor`, or use the ephemeral online command above. This check alone does not mean the tunnel is unhealthy.

### OAuth discovery warning in this no-auth topology

Refrain intentionally advertises no OAuth metadata on the private origin. Require `doctor` to report that OAuth metadata is not advertised and create the ChatGPT connection with **No Authentication**. A startup discovery warning is non-blocking only when health/readiness pass and ChatGPT successfully discovers `hum`; an OAuth prompt or authentication failure is blocking and indicates the wrong topology.

### Host-specific discovery probe returns an error

The deployed origin negotiates MCP `2025-06-18`. A host may issue a newer or host-specific discovery probe before falling back to the negotiated initialize/tool-discovery flow. Treat the probe as non-blocking only when the subsequent standard flow creates the connector and discovers exactly `hum`; do not upgrade the protocol merely to remove a warning.

### Canvas reports `Failed to fetch template`

First separate origin/tunnel failure from host-side template resolution. Check both services and the tunnel log as above. If the successful `hum` reached the origin but no later `resources/read` reached the tunnel, do not publish iframe assets or recreate the tunnel: the failure happened before the host re-read the `ui://` resource. Verify with `npm run mcp:http-smoke` that `_meta.ui.resourceUri` and `_meta["openai/outputTemplate"]` are the same explicit-version App URI, that resource discovery contains only that HTML document, that it is readable as `text/html;profile=mcp-app`, and that the HTML remains self-contained. Verify exact runtime identity separately through `/healthz`, the package/image metadata, and private `refrain/release` tool-result metadata. After deploying a changed App contract version, refresh or rescan the existing private plugin so ChatGPT discovers the new tool descriptor and resource URI; creating another connector is not a cache-busting mechanism.

An exact motif selection is only conversational context. It must not force a second `hum` or new AIR@0 root. The Canvas sends a closed `refrain-selection-handoff@0-experimental` object binding the exact selection to the exact portable parent artifact. If selection unexpectedly triggers composition, inspect that handoff and its rendered follow-up before changing transport or template infrastructure.

### Mobile JSON export reports `receipt-id` or `TypeError: Load failed`

Treat these as two different boundaries. `The artifact AIR@1 receipt failed integrity: receipt-id.` occurs before host download and means the delivered Artifact@3 could not reproduce its Receipt@1 identity; exercise the local `transport=reordered` lane and the fixed receipt/evidence/embodiment IDs before touching tunnel or file APIs. `Host file export failed: TypeError: Load failed` after AIR source export means serialization succeeded and the selected ChatGPT temporary-file route failed; on the v3 contract a mobile host must use portable `ui/download-file` even when raw Chat file methods are present. Verify that the resource requests `ui.permissions.clipboardWrite`, but never infer that ChatGPT granted it. After deploying v3, refresh the existing connector once and retest both buttons independently; do not recreate the connector or resend `hum` merely to distinguish these errors.

## Acceptance and rollback

Do not call the deployment host-accepted until a real host has:

- discovered exactly one `hum` tool and the App resource;
- authored a valid AIR without receiving expanded events;
- rendered the shared Selen Canvas rather than a host-specific fork;
- kept audio at zero before an explicit Play gesture;
- played and paused the zero-asset synthetic proof, selected an exact motif, and returned the selection to the host without console or asset errors;
- exported canonical source, portable artifact, and exact selection through the host's advertised route—including the portable route on mobile—or visibly delivered the exact JSON clipboard fallback when file download was unavailable and clipboard permission was granted;
- reported every sampled performance as unavailable in MCP Canvas rather than silently rebinding it; ordinary browser sampled playback is a separate acceptance surface.

Rollback is an image selection, not an inert code path: set `REFRAIN_IMAGE` to the prior recorded image ID or repository digest and restart `refrain-mcp.service`. Re-check `/healthz`, private `refrain/release` tool-result metadata, the one-resource App contract, and tunnel readiness against that exact identity. The canonical AIR and artifact formats remain portable and server-stateless.

`PartOf=refrain-mcp.service` propagates an origin restart to an already-active tunnel. After an image activation or rollback, restart the origin once and wait for the propagated tunnel start to reach `live` / `ready`; start the tunnel explicitly only when it was inactive rather than immediately issuing a second restart. A redundant tunnel restart can terminate its in-flight `ExecStartPre` and leave a misleading transition-only `Failed with result 'signal'` even though the next start succeeds.
