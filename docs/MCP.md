# Connect your agent

[Start here](GETTING-STARTED.md) · [Skill and local authoring](../plugins/refrain/README.md) · [Self-hosting runbook](runbooks/self-host-mcp.md)

Refrain's conversational tool is **`hum`**. Your agent writes the music; the tool returns a complete portable artifact and a Canvas resource. A host that implements MCP Apps can display the Canvas in the conversation. Installing a Skill and connecting an MCP server are separate steps.

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

Restart the connection after building or updating the checkout. Ask the host to list its tools, confirm `hum`, then request a short air using the available synthetic instruments. Press Play in the returned Canvas. A Tool-only host may still call `hum`; it cannot show an embedded Canvas merely because the resource exists.

## Host boundary

| Surface                                      | Available path                                                 | What remains host-dependent                                                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local MCP host with Apps                     | Stdio `hum` + the self-contained Canvas                        | App support, resource loading, selection return, download/clipboard permissions.                                                                                |
| Local MCP host with tools only               | `hum` returns the complete artifact                            | Save that artifact, then use `refrain open` if local file execution is available.                                                                               |
| ChatGPT via an operator's private connection | Self-hosted Streamable HTTP + operator-owned Secure MCP Tunnel | Access to the tunnel/host setup, workspace policy, connector refresh, and current App behavior. A local stdio command cannot be pasted into a remote-URL field. |
| Ordinary browser                             | `refrain open` uses the same renderer                          | Browser audio permissions; this also supports selected sample assets.                                                                                           |

Earlier private ChatGPT trials exercised Canvas, explicit Play/Replay, selection return, and mobile Artifact/source clipboard fallback. Native mobile host save/download and a full Codex/Claude/Kimi host matrix remain unverified. The repository's Chromium host tests exercise declared capabilities; they do not certify a named host's current behavior. See [testing](TESTING.md) and [current state](current-state.md).

## Sound and continuation

The Canvas uses eight synthetic instrument identities: `air_pad`, `clean_bass`, `dust_texture`, `glass_bell`, `lattice_pluck`, `prism_lead`, `rhythm_pulse`, and `sub_bass`. An omitted AIR@1 binding visibly selects exact `f-synthetic-beat@0`. An explicit binding wins; sampled sound stays exact but unavailable in this zero-asset Canvas. Ordinary browser playback supports the selected sample closure.

For continuation, pass the **complete prior Artifact@3** unchanged as `from.parentArtifact`, along with the newly authored AIR and relation. A bare ID is insufficient because the server does not store your works. The schema describes the evidence required for `extend`, `variation`, and `quote`; `reply` can express a declared relation without inventing verified musical proof.

Selecting a motif, segment, or section can return its exact anchor and parent artifact through an explicit user action when the host permits it. Otherwise, export or copy the exact selection. Keep saved artifacts under your own custody.

## Private remote operation

For a host that needs HTTP instead of stdio, follow the [self-hosting runbook](runbooks/self-host-mcp.md). Its reference origin binds loopback; the optional OpenAI tunnel is outbound and operator-owned. Refrain offers no public endpoint, hosted relationship memory, or public account service. Do not expose the no-auth loopback service directly to the internet.

The host may use its own conversation context to author music. `hum` receives only musical inputs, exact parent artifacts, and intentionally shared captions. Those fields may themselves reveal personal meaning, so save and share them deliberately.
