# Connect your agent

[Start here](GETTING-STARTED.md) · [Skill and local authoring](../plugins/refrain/README.md) · [Self-hosting runbook](runbooks/self-host-mcp.md)

Refrain's conversational tools are **`hum`** and **`audition`**. Your agent writes the music; `hum` returns a complete portable artifact and a Canvas resource, while `audition` returns exact rendered audio. A host that implements MCP Apps can display the Canvas in the conversation. Installing a Skill and connecting an MCP server are separate steps.

## Local MCP connection

After [installing from source](GETTING-STARTED.md#install-from-source), build the zero-asset App:

```bash
npm run build:mcp-host
npm run mcp:smoke
```

The build embeds the shared renderer's JS and CSS in one App document. It does not fetch the sample catalog. The smoke check starts the formal CLI from another working directory, discovers `hum`, calls it, and reads its self-contained `ui://refrain/hum/v3.html` resource. This is protocol evidence, not evidence that your chosen host displays Apps.

Register the following command in your host's local MCP settings. Use absolute paths for both Node and the checkout when the host does not inherit your shell PATH. The JSON below is the common `mcpServers` shape; adapt only its outer configuration wrapper to your host.

```json
{
  "mcpServers": {
    "refrain": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/refrain/bin/refrain.mjs", "mcp", "stdio"]
    }
  }
}
```

On macOS/Linux, `command -v node` prints the Node path. The CLI resolves its own installation, selects the production Canvas, and preserves protocol stdout regardless of the host's working directory. No additional `NODE_ENV`, development web server, credentials, or Refrain account is required. A directly started stdio server waits silently for its host; it is not a terminal chat interface.

Restart the connection after building or updating the checkout. Ask the host to list its tools, confirm `hum` and `audition`, then request a short air using the available synthetic instruments. Press Play in the returned Canvas. A Tool-only host may still call `hum`; it cannot show an embedded Canvas merely because the resource exists.

## Host boundary

| Surface                                      | Available path                                                 | What remains host-dependent                                                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local MCP host with Apps                     | Stdio `hum` + the self-contained Canvas                        | App support, resource loading, selection return, download/clipboard permissions.                                                                                |
| Local MCP host with tools only               | `hum` returns the complete artifact                            | Save that artifact, then use `refrain open` if local file execution is available.                                                                               |
| ChatGPT via an operator's private connection | Self-hosted Streamable HTTP + operator-owned Secure MCP Tunnel | Access to the tunnel/host setup, workspace policy, connector refresh, and current App behavior. A local stdio command cannot be pasted into a remote-URL field. |
| Ordinary browser                             | `refrain open` uses the same renderer                          | Browser audio permissions; this also supports selected sample assets.                                                                                           |

Earlier private ChatGPT trials exercised Canvas, explicit Play/Replay, selection return, and mobile Artifact/source clipboard fallback. Native mobile host save/download and a full Codex/Claude/Kimi host matrix remain unverified. The repository's Chromium host tests exercise declared capabilities; they do not certify a named host's current behavior. See [testing](TESTING.md) and [current state](current-state.md).

## Sound and continuation

The Canvas uses eight synthetic instrument identities: `air_pad`, `clean_bass`, `dust_texture`, `glass_bell`, `lattice_pluck`, `prism_lead`, `rhythm_pulse`, and `sub_bass`. A new AIR@1 root with no binding visibly selects exact `f-synthetic-beat@0`. An explicit binding wins; sampled sound stays exact but unavailable in this zero-asset Canvas. Ordinary browser playback supports the selected sample closure.

For continuation, pass the **complete prior Artifact@3** unchanged as `from.parentArtifact`, along with the newly authored AIR and relation. A bare ID is insufficient because the server does not store your works. The schema describes the evidence required for `extend`, `variation`, and `quote`; `reply` can express a declared relation without inventing verified musical proof.

Omitting `performance.bindingId` on a continuation inherits the parent default, or its sole carried binding when there is no default. An unbound or ambiguous parent stays unbound; the root default is not substituted. An explicit ID selects an exact parent-carried binding before consulting the built-in catalog, so custom production Binding@1 works across fresh MCP processes. An inherited unavailable sound stays attached with an unavailable status. The local CLI uses this same rule; an explicit binding file is a local-only input.

When an artifact carries several sounds, **Sound for this listening view** selects among them in both Canvas surfaces. Changing sound stops playback and resets position/selection; it never starts sound automatically. The choice is view-only: saving retains all bindings, render receipts, projections, caption, and the original default. A valid artifact without a selected or executable sound remains inspectable and exportable. This is not synchronized A/B playback and does not acquire extra samples; for a local sampled variant outside the prepared closure, reopen using `refrain open <file> --binding <carried-id>` after explicit acquisition.

Selecting a motif, segment, or section can return its exact anchor and complete parent artifact through an explicit user action when the host permits it. Copied/sent requests also identify the currently auditioned binding; to continue that sound, the agent explicitly selects its carried ID without rewriting the parent default. The downloaded closed handoff preserves the saved parent/default and does not persist view-only audition state. Keep saved artifacts under your own custody.

## Actual audio for the author

`audition` accepts a complete Artifact@3 and an optional exact passage/binding or A/B pair. It returns native WAV audio content blocks and their exact audition packet, with a twenty-second limit per entry including context. This uses the existing SDK lifecycle transport and adds no second App resource. CLI audition retains full-piece output. See [musical correspondence](CORRESPONDENCE.md) for the workflow and local share/reply commands.

The server does not fetch samples. Without `REFRAIN_AUDITION_ASSET_ROOT`, only zero-asset execution works; an operator may provide an already hydrated root. This setting does not alter Canvas assets or turn missing sampled sound into synth sound. Returning audio blocks is transport evidence only: the receiving host must separately support model audio input. No named host is claimed to have heard the result merely because its tool call succeeded.

## Private remote operation

For a host that needs HTTP instead of stdio, follow the [self-hosting runbook](runbooks/self-host-mcp.md). Its reference origin binds loopback; the optional OpenAI tunnel is outbound and operator-owned. Refrain offers no public endpoint, hosted relationship memory, or public account service. Do not expose the no-auth loopback service directly to the internet.

The host may use its own conversation context to author music. `hum` receives only musical inputs, exact parent artifacts, and intentionally shared captions. Those fields may themselves reveal personal meaning, so save and share them deliberately.
