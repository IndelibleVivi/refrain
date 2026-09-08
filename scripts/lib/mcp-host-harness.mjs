import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const MCP_HOST_PROFILES = ["chat-file", "portable", "restricted"];
export const MCP_HOST_DEVICES = ["desktop", "mobile"];
export const MCP_HOST_TRANSPORTS = ["preserve", "reordered"];

const HOST_PAGE_PATH = "/";
const APP_PAGE_PATH = "/app";

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asBase64(value) {
  return Buffer.from(value).toString("base64");
}

function developmentAppHtml(mcpOrigin) {
  const serverUrl = JSON.stringify(mcpOrigin);
  const viewUrl = JSON.stringify(`${mcpOrigin}/_skybridge/view/hum`);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Refrain development lifecycle App</title>
    <script>window.skybridge = { hostType: "mcp-app", serverUrl: ${serverUrl} };</script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">import(${viewUrl});</script>
  </body>
</html>`;
}

async function availablePort() {
  const server = createNetServer();
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate a local MCP host harness port.");
  }
  await new Promise((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
  return address.port;
}

async function waitForMcp(url, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Local MCP server exited with code ${child.exitCode}.`);
    }
    try {
      await fetch(url, { method: "HEAD" });
      return;
    } catch {
      await new Promise((accept) => setTimeout(accept, 100));
    }
  }
  throw new Error(
    "Local MCP server did not become reachable within 20 seconds.",
  );
}

async function closeChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((accept) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      accept();
    });
  });
}

function successfulToolCase(name, input, result) {
  if (result.isError || result.structuredContent?.ok !== true) {
    throw new Error(
      `The ${name} host fixture did not produce a successful hum result.`,
    );
  }
  const artifact = result.structuredContent.artifact;
  if (!artifact) {
    throw new Error(`The ${name} host fixture did not carry Artifact@3.`);
  }
  return {
    name,
    input,
    result: jsonClone(result),
    expected: {
      artifactText: `${JSON.stringify(artifact, null, 2)}\n`,
      sourceText: `${JSON.stringify(artifact.source, null, 2)}\n`,
    },
    identity: {
      artifactFormat: artifact.format,
      bindingId: artifact.defaultBindingId,
      receiptId: artifact.receipt?.receiptId,
      sourceRevision: artifact.receipt?.sourceRevision,
      performanceStatus: result.structuredContent.performanceStatus,
    },
  };
}

function hostPageHtml(resource, cases, mode) {
  const encodedPayload = asBase64(
    JSON.stringify({
      resource: {
        uri: resource.uri,
        mimeType: resource.mimeType,
        bytes: resource.bytes,
        _meta: resource._meta,
        delivery:
          mode === "production"
            ? "exact-production-resource"
            : "canonical-development-view-entry",
        productionResourceAuthority: mode === "production",
      },
      mode,
      cases,
    }),
  );
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Refrain local MCP host</title>
    <style>
      :root { color-scheme: light; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #e8e6df; color: #1d2329; }
      main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(18rem, 30rem); min-height: 100vh; }
      iframe { width: 100%; min-height: 100vh; border: 0; background: #f7f5ef; }
      aside { border-left: 1px solid #b9b6ad; padding: 1rem; overflow: auto; background: #f4f1e9; }
      h1 { margin: 0 0 .75rem; font: 600 1rem/1.2 ui-sans-serif, system-ui, sans-serif; }
      dl { display: grid; grid-template-columns: max-content 1fr; gap: .3rem .7rem; margin: 0 0 1rem; font-size: .76rem; }
      dt { color: #59626a; }
      dd { margin: 0; overflow-wrap: anywhere; }
      pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .7rem; line-height: 1.4; }
      @media (max-width: 760px) {
        main { grid-template-columns: minmax(0, 1fr); }
        aside { border-left: 0; border-top: 1px solid #b9b6ad; }
      }
    </style>
  </head>
  <body>
    <main>
      <iframe id="refrain-app" title="Refrain ${mode} MCP App"></iframe>
      <aside aria-label="Local host evidence">
        <h1>Local MCP host evidence</h1>
        <dl id="summary"></dl>
        <pre id="evidence"></pre>
      </aside>
    </main>
    <script>
      const decoded = Uint8Array.from(atob(${JSON.stringify(encodedPayload)}), (character) => character.charCodeAt(0));
      const payload = JSON.parse(new TextDecoder().decode(decoded));
      const query = new URLSearchParams(location.search);
      const profile = query.get("profile");
      const device = query.get("device") || "desktop";
      const transport = query.get("transport") || "preserve";
      const fixture = query.get("fixture") || "synthetic";
      const failure = query.get("failure") || "";
      const allowedProfiles = ${JSON.stringify(MCP_HOST_PROFILES)};
      const allowedDevices = ${JSON.stringify(MCP_HOST_DEVICES)};
      const allowedTransports = ${JSON.stringify(MCP_HOST_TRANSPORTS)};
      if (!allowedProfiles.includes(profile)) {
        throw new Error("Choose an explicit MCP host profile: " + allowedProfiles.join(", "));
      }
      if (!allowedDevices.includes(device)) {
        throw new Error("Choose an explicit MCP host device: " + allowedDevices.join(", "));
      }
      if (!allowedTransports.includes(transport)) {
        throw new Error("Choose an explicit MCP host transport: " + allowedTransports.join(", "));
      }
      if (!payload.cases[fixture]) throw new Error("Unknown host fixture " + fixture + ".");

      const frame = document.getElementById("refrain-app");
      const evidenceNode = document.getElementById("evidence");
      const summaryNode = document.getElementById("summary");
      let currentFixture = fixture;
      let initialized = false;
      const requestedPermissions = payload.resource._meta?.ui?.permissions ?? {};
      const grantedPermissions = { ...requestedPermissions };
      const hostCapabilities = {
        openLinks: {},
        downloadFile: {},
        serverTools: { listChanged: false },
        sandbox: {
          permissions: grantedPermissions,
          csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
        },
        ...(profile === "restricted" ? {} : { message: { text: {} } }),
      };
      const hostContext = {
        theme: "light",
        locale: "en-US",
        timeZone: "Asia/Singapore",
        platform: device,
        displayMode: "inline",
        containerDimensions: { width: frame.clientWidth, maxHeight: frame.clientHeight },
        deviceCapabilities:
          device === "mobile"
            ? { touch: true, hover: false }
            : { touch: false, hover: true },
        safeAreaInsets:
          device === "mobile"
            ? { top: 47, right: 0, bottom: 34, left: 0 }
            : { top: 0, right: 0, bottom: 0, left: 0 },
      };
      const evidence = {
        mode: payload.mode,
        profile,
        device,
        transport,
        failure: failure || null,
        currentFixture,
        resource: payload.resource,
        permissions: {
          requested: requestedPermissions,
          granted: grantedPermissions,
        },
        hostCapabilities,
        hostContext,
        handshake: [],
        protocolRequests: [],
        uploads: [],
        downloadUrls: [],
        externalOpens: [],
        portableDownloads: [],
        clipboardWrites: [],
        selectionReturns: [],
        modelContextUpdates: [],
        lifecycle: [],
        audio: [],
        consoleErrors: [],
        unhandledExceptions: [],
        unexpectedNetworkRequests: [],
      };

      function refresh() {
        const selectedCase = payload.cases[currentFixture];
        summaryNode.innerHTML = [
          ["profile", profile],
          ["device", device],
          ["transport", transport],
          ["mode", payload.mode],
          ["resource", payload.resource.uri],
          ["bytes", String(payload.resource.bytes)],
          ["fixture", currentFixture],
          ["binding", selectedCase.identity.bindingId || "unbound"],
          ["receipt", selectedCase.identity.receiptId],
        ].map(([label, value]) => '<dt>' + label + '</dt><dd>' + String(value) + '</dd>').join("");
        evidenceNode.textContent = JSON.stringify(evidence, null, 2);
      }

      function post(message) {
        frame.contentWindow.postMessage(message, "*");
      }

      function respond(request, result) {
        post({ jsonrpc: "2.0", id: request.id, result });
      }

      function reject(request, message) {
        post({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message } });
      }

      function sendCurrentFixture() {
        if (!initialized) return;
        const selectedCase = payload.cases[currentFixture];
        post({
          jsonrpc: "2.0",
          method: "ui/notifications/tool-input",
          params: { arguments: selectedCase.input },
        });
        post({
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params:
            transport === "reordered"
              ? deepReorderPlainObjectKeys(selectedCase.result)
              : selectedCase.result,
        });
        evidence.currentFixture = currentFixture;
        refresh();
      }

      function deepReorderPlainObjectKeys(value) {
        if (Array.isArray(value)) {
          return value.map(deepReorderPlainObjectKeys);
        }
        if (value === null || typeof value !== "object") return value;
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) return value;
        return Object.fromEntries(
          Object.keys(value)
            .sort()
            .reverse()
            .map((key) => [key, deepReorderPlainObjectKeys(value[key])]),
        );
      }

      window.addEventListener("message", (event) => {
        if (event.source !== frame.contentWindow) return;
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return;
        if (message.id !== undefined) {
          evidence.protocolRequests.push({ method: message.method, params: message.params });
        }
        if (message.method === "ui/initialize") {
          evidence.handshake.push({ method: message.method, params: message.params });
          respond(message, {
            protocolVersion: message.params.protocolVersion,
            hostInfo: { name: "refrain-local-host", version: "1" },
            hostCapabilities,
            hostContext,
          });
        } else if (message.method === "ui/notifications/initialized") {
          evidence.handshake.push({ method: message.method });
          initialized = true;
          sendCurrentFixture();
        } else if (message.method === "ui/download-file") {
          evidence.portableDownloads.push(message.params);
          respond(message, { isError: profile === "restricted" || failure === "portable" });
        } else if (message.method === "ui/message") {
          evidence.selectionReturns.push({ route: "mcp-app", params: message.params });
          if (profile === "restricted" || failure === "selection") {
            reject(message, "Selection return is unavailable in this host profile.");
          } else {
            respond(message, {});
          }
        } else if (message.method === "ui/update-model-context") {
          evidence.modelContextUpdates.push(message.params);
          respond(message, {});
        } else if (message.method === "ui/open-link") {
          evidence.externalOpens.push({ route: "mcp-app", ...message.params });
          respond(message, {});
        } else if (message.id !== undefined) {
          reject(message, "The local Refrain host does not implement " + message.method + ".");
        }
        refresh();
      });

      window.__REFRAIN_MCP_HOST__ = {
        evidence,
        cases: payload.cases,
        render(nextFixture) {
          if (!payload.cases[nextFixture]) throw new Error("Unknown host fixture " + nextFixture + ".");
          currentFixture = nextFixture;
          sendCurrentFixture();
          return payload.cases[nextFixture].identity;
        },
        async invokeOpenAI(method, detail) {
          if (method === "uploadFile") {
            evidence.uploads.push(detail);
            refresh();
            if (failure === "upload") throw new DOMException("User cancelled", "AbortError");
            return { fileId: "file_local_exact", fileName: detail.filename, mimeType: detail.mimeType };
          }
          if (method === "getFileDownloadUrl") {
            evidence.downloadUrls.push(detail);
            refresh();
            if (failure === "download-url") throw new DOMException("Blocked by local policy", "NotAllowedError");
            return { downloadUrl: "https://files.oaiusercontent.com/refrain-local/" + encodeURIComponent(detail.fileName || "export") };
          }
          if (method === "sendFollowUpMessage") {
            evidence.selectionReturns.push({ route: "chat-file", ...detail });
            refresh();
            if (failure === "selection") throw new DOMException("Selection denied", "NotAllowedError");
            return;
          }
          if (method === "setWidgetState") {
            evidence.modelContextUpdates.push({ route: "chat-file", state: detail });
            refresh();
            return;
          }
          throw new Error("Unknown OpenAI host call " + method + ".");
        },
        recordOpenExternal(detail) {
          evidence.externalOpens.push({ route: "chat-file", ...detail });
          refresh();
        },
        async writeClipboard(text) {
          evidence.clipboardWrites.push({ text });
          refresh();
          if (profile === "restricted" || failure === "clipboard") {
            throw new DOMException("Permission denied", "NotAllowedError");
          }
        },
        recordAudio(detail) {
          evidence.audio.push(detail);
          refresh();
          return evidence.audio.length;
        },
        recordLifecycle(detail) {
          evidence.lifecycle.push({ index: evidence.lifecycle.length, ...detail });
          refresh();
        },
        recordConsoleError(detail) {
          evidence.consoleErrors.push(detail);
          refresh();
        },
        recordUnhandled(detail) {
          evidence.unhandledExceptions.push(detail);
          refresh();
        },
        recordUnexpectedNetwork(detail) {
          evidence.unexpectedNetworkRequests.push(detail);
          refresh();
        },
      };

      refresh();
      frame.src = ${JSON.stringify(APP_PAGE_PATH)};
    </script>
  </body>
</html>`;
}

export function mcpHostInitScript() {
  if (window === window.parent || window.__REFRAIN_MCP_HOST_INIT__) return;
  const host = window.parent.__REFRAIN_MCP_HOST__;
  if (!host) return;
  window.__REFRAIN_MCP_HOST_INIT__ = true;

  const encodeBytes = (bytes) => {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(offset, offset + chunkSize),
      );
    }
    return btoa(binary);
  };
  const stringify = (value) => {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const originalConsoleError = console.error.bind(console);
  console.error = (...values) => {
    host.recordConsoleError({ values: values.map(stringify) });
    originalConsoleError(...values);
  };
  window.addEventListener("error", (event) => {
    host.recordUnhandled({ type: "error", message: event.message });
  });
  window.addEventListener("unhandledrejection", (event) => {
    host.recordUnhandled({
      type: "unhandledrejection",
      reason: stringify(event.reason),
    });
  });

  const nativeReplaceChildren = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...nodes) {
    if (this.classList?.contains("selen-v21-host")) {
      host.recordLifecycle({
        type: nodes.length === 0 ? "cleanup" : "setup",
        childCount: nodes.length,
      });
    }
    return nativeReplaceChildren.apply(this, nodes);
  };

  const clipboardWriteRequested = Boolean(
    host.evidence.resource._meta?.ui?.permissions &&
    Object.prototype.hasOwnProperty.call(
      host.evidence.resource._meta.ui.permissions,
      "clipboardWrite",
    ),
  );
  const clipboardWriteGranted = Boolean(
    host.evidence.hostCapabilities.sandbox?.permissions &&
    Object.prototype.hasOwnProperty.call(
      host.evidence.hostCapabilities.sandbox.permissions,
      "clipboardWrite",
    ),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value:
      clipboardWriteRequested && clipboardWriteGranted
        ? { writeText: (text) => host.writeClipboard(text) }
        : undefined,
  });

  if (host.evidence.profile === "chat-file") {
    window.openai = {
      view: { mode: "inline" },
      widgetState: null,
      setWidgetState: async (state) => {
        window.openai.widgetState = state;
        await host.invokeOpenAI("setWidgetState", state);
        window.dispatchEvent(
          new CustomEvent("openai:set_globals", {
            detail: { globals: { widgetState: state } },
          }),
        );
      },
      uploadFile: async function (file, options) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        return host.invokeOpenAI("uploadFile", {
          filename: file.name,
          mimeType: file.type,
          bytes: bytes.length,
          base64: encodeBytes(bytes),
          options: options ?? null,
          argumentCount: arguments.length,
        });
      },
      getFileDownloadUrl: (metadata) =>
        host.invokeOpenAI("getFileDownloadUrl", metadata),
      openExternal: (detail) => host.recordOpenExternal(detail),
      sendFollowUpMessage: (detail) =>
        host.invokeOpenAI("sendFollowUpMessage", detail),
    };
  }

  const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
  if (NativeAudioContext) {
    const WrappedAudioContext = new Proxy(NativeAudioContext, {
      construct(target, argumentsList, newTarget) {
        const context = Reflect.construct(target, argumentsList, newTarget);
        const contextId = host.recordAudio({
          type: "create",
          state: context.state,
        });
        for (const method of ["resume", "suspend", "close"]) {
          const original = context[method]?.bind(context);
          if (!original) continue;
          Object.defineProperty(context, method, {
            configurable: true,
            value: async (...args) => {
              host.recordAudio({
                type: method,
                contextId,
                state: context.state,
              });
              return original(...args);
            },
          });
        }
        return context;
      },
    });
    window.AudioContext = WrappedAudioContext;
    if (window.webkitAudioContext)
      window.webkitAudioContext = WrappedAudioContext;
  }
}

export async function startMcpHostHarness({
  root = process.cwd(),
  mode = "production",
  extraCases = {},
} = {}) {
  if (mode !== "production" && mode !== "development") {
    throw new Error(`Unknown MCP host harness mode ${mode}.`);
  }
  const mcpPort = await availablePort();
  const mcpOrigin = `http://127.0.0.1:${mcpPort}`;
  const stderr = [];
  const childArguments =
    mode === "production"
      ? [
          "--conditions=refrain-built",
          resolve(root, "scripts/start-mcp.mjs"),
          "--port",
          String(mcpPort),
        ]
      : [
          resolve(root, "node_modules/tsx/dist/cli.mjs"),
          resolve(root, "packages/mcp-server/src/server.ts"),
        ];
  const child = spawn(process.execPath, childArguments, {
    cwd: mode === "production" ? root : resolve(root, "packages/mcp-server"),
    env: {
      ...process.env,
      NODE_ENV: mode,
      ...(mode === "development"
        ? { __PORT: String(mcpPort), REFRAIN_MCP_HOST_BUILD: "1" }
        : {}),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  const client = new Client(
    { name: "refrain-local-mcp-host", version: "1" },
    { capabilities: { extensions: { "io.modelcontextprotocol/ui": {} } } },
  );
  let server;
  try {
    await waitForMcp(`${mcpOrigin}/mcp`, child);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${mcpOrigin}/mcp`)),
    );
    const tools = await client.listTools();
    const humTool = tools.tools.find((tool) => tool.name === "hum");
    const resourceUri = humTool?._meta?.ui?.resourceUri;
    if (typeof resourceUri !== "string") {
      throw new Error(
        `The ${mode} hum tool did not advertise its App resource.`,
      );
    }
    const resourceResult = await client.readResource({ uri: resourceUri });
    const resourceContent = resourceResult.contents.find(
      (item) =>
        item.mimeType === "text/html;profile=mcp-app" &&
        typeof item.text === "string",
    );
    if (!resourceContent || typeof resourceContent.text !== "string") {
      throw new Error(`The ${mode} App resource did not contain HTML.`);
    }
    const resource = {
      uri: resourceUri,
      mimeType: resourceContent.mimeType,
      html: resourceContent.text,
      bytes: Buffer.byteLength(resourceContent.text),
      _meta: jsonClone(resourceContent._meta ?? {}),
    };
    const appHtml =
      mode === "production" ? resource.html : developmentAppHtml(mcpOrigin);
    const appBytes = Buffer.byteLength(appHtml);

    const syntheticSource = JSON.parse(
      await readFile(
        resolve(root, "fixtures/air-v1/synthetic-counterpulse.air.json"),
        "utf8",
      ),
    );
    const sampledSource = JSON.parse(
      await readFile(
        resolve(root, "fixtures/air-v1/crooked-return.air.json"),
        "utf8",
      ),
    );
    const replacementSource = jsonClone(syntheticSource);
    replacementSource.title = "A second local host air";
    const inputs = {
      synthetic: { air: syntheticSource },
      replacement: { air: replacementSource },
      sampled: { air: sampledSource },
    };
    const cases = {};
    for (const [name, input] of Object.entries(inputs)) {
      const result = await client.callTool({ name: "hum", arguments: input });
      cases[name] = successfulToolCase(name, input, result);
    }
    if (
      cases.synthetic.identity.receiptId ===
      cases.replacement.identity.receiptId
    ) {
      throw new Error(
        "The artifact replacement fixtures unexpectedly share one receipt identity.",
      );
    }

    // Test-owned canonical artifacts can exercise transport/persistence without a model.
    for (const [name, { input, result }] of Object.entries(extraCases)) {
      if (cases[name]) throw new Error(`Duplicate host fixture ${name}.`);
      cases[name] = successfulToolCase(name, input, result);
    }

    const pageHtml = hostPageHtml(resource, cases, mode);
    server = createHttpServer((request, response) => {
      const url = new URL(request.url ?? HOST_PAGE_PATH, "http://127.0.0.1");
      if (url.pathname === HOST_PAGE_PATH) {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": Buffer.byteLength(pageHtml),
          "Cache-Control": "no-store",
        });
        response.end(pageHtml);
        return;
      }
      if (url.pathname === APP_PAGE_PATH) {
        response.writeHead(200, {
          "Content-Type": resource.mimeType,
          "Content-Length": appBytes,
          "Cache-Control": "no-store",
        });
        response.end(appHtml);
        return;
      }
      if (url.pathname === "/healthz") {
        const body = JSON.stringify({
          status: "ok",
          resource: resource.uri,
          bytes: resource.bytes,
        });
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        });
        response.end(body);
        return;
      }
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    });
    await new Promise((accept, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", accept);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("The local MCP host harness did not bind a TCP port.");
    }
    const origin = `http://127.0.0.1:${address.port}`;

    return {
      mode,
      origin,
      mcpOrigin,
      resource: {
        uri: resource.uri,
        mimeType: resource.mimeType,
        bytes: resource.bytes,
        _meta: resource._meta,
      },
      cases,
      url({
        profile,
        device = "desktop",
        transport = "preserve",
        fixture = "synthetic",
        failure,
      } = {}) {
        if (!MCP_HOST_PROFILES.includes(profile)) {
          throw new Error(
            `Choose one explicit MCP host profile: ${MCP_HOST_PROFILES.join(", ")}.`,
          );
        }
        if (!MCP_HOST_DEVICES.includes(device)) {
          throw new Error(
            `Choose one explicit MCP host device: ${MCP_HOST_DEVICES.join(", ")}.`,
          );
        }
        if (!MCP_HOST_TRANSPORTS.includes(transport)) {
          throw new Error(
            `Choose one explicit MCP host transport: ${MCP_HOST_TRANSPORTS.join(", ")}.`,
          );
        }
        const url = new URL(origin);
        url.searchParams.set("profile", profile);
        url.searchParams.set("device", device);
        url.searchParams.set("transport", transport);
        url.searchParams.set("fixture", fixture);
        if (failure) url.searchParams.set("failure", failure);
        return url.href;
      },
      async close() {
        await new Promise((accept, reject) =>
          server.close((error) => (error ? reject(error) : accept())),
        );
        await client.close().catch(() => {});
        await closeChild(child);
        if (stderr.length) process.stderr.write(stderr.join(""));
      },
    };
  } catch (error) {
    if (server) {
      await new Promise((accept) => server.close(() => accept()));
    }
    await client.close().catch(() => {});
    await closeChild(child);
    if (stderr.length) process.stderr.write(stderr.join(""));
    throw error;
  }
}
