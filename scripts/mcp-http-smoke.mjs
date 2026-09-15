import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { assertAudition } from "./assert-audition.mjs";

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not allocate a local smoke-test port.");
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`MCP HTTP server exited with code ${child.exitCode}.`);
    try {
      await fetch(url, { method: "HEAD" });
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  throw new Error(
    "MCP HTTP server did not become reachable within 15 seconds.",
  );
}

const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
const releaseRoot = await mkdtemp(join(tmpdir(), "refrain-http-release-"));
const releasePath = join(releaseRoot, "release.json");
const expectedRelease = {
  format: "refrain-mcp-runtime@1-experimental",
  sourceRevision: "1".repeat(40),
  sourceDirty: false,
  bundleDigest: `sha256:${"2".repeat(64)}`,
  files: [
    {
      path: "packages/mcp-server/dist/__entry.js",
      bytes: 42,
      sha256: "3".repeat(64),
    },
  ],
};
await writeFile(releasePath, `${JSON.stringify(expectedRelease)}\n`);
const stderr = [];
const child = spawn(
  process.execPath,
  [
    "--conditions=refrain-built",
    resolve("scripts/start-mcp.mjs"),
    "--port",
    String(port),
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, REFRAIN_RELEASE_FILE: releasePath },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
child.stderr.on("data", (chunk) => stderr.push(String(chunk)));

const client = new Client(
  { name: "refrain-http-conformance", version: "0.0.0-experimental" },
  { capabilities: { extensions: { "io.modelcontextprotocol/ui": {} } } },
);

try {
  await waitForServer(`${origin}/mcp`, child);
  const healthResponse = await fetch(`${origin}/healthz`);
  const health = await healthResponse.json();
  if (
    healthResponse.status !== 200 ||
    health.status !== "ok" ||
    health.server !== "Refrain" ||
    health.release?.sourceRevision !== expectedRelease.sourceRevision ||
    health.release?.bundleDigest !== expectedRelease.bundleDigest ||
    health.release?.fileCount !== expectedRelease.files.length
  )
    throw new Error("The exact Refrain health identity was unavailable.");
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)),
  );
  const tools = await client.listTools();
  const humTool = tools.tools.find((tool) => tool.name === "hum");
  const resourceUri = humTool?._meta?.ui?.resourceUri;
  if (typeof resourceUri !== "string")
    throw new Error("HTTP hum tool did not advertise an MCP App resource.");
  if (humTool?._meta?.["openai/outputTemplate"] !== resourceUri)
    throw new Error(
      "HTTP hum tool did not advertise the ChatGPT output template alias.",
    );
  if (humTool?._meta?.["ui/resourceUri"] !== undefined)
    throw new Error(
      "HTTP hum tool retained the retired flat resource URI key.",
    );
  if (
    !humTool?.description?.includes(
      "defaults omitted AIR@1 performance.bindingId to f-synthetic-beat@0",
    ) ||
    !humTool.description.includes(
      "air_pad, clean_bass, dust_texture, glass_bell, lattice_pluck, prism_lead, rhythm_pulse, sub_bass",
    )
  )
    throw new Error(
      "HTTP hum did not advertise its exact no-asset Canvas default binding and instrument closure.",
    );

  const fixture = JSON.parse(
    await readFile(
      resolve("fixtures/air-v1/synthetic-counterpulse.air.json"),
      "utf8",
    ),
  );
  const result = await client.callTool({
    name: "hum",
    arguments: {
      air: fixture,
      caption: "HTTP self-contained Canvas conformance air.",
    },
  });
  if (result.structuredContent?.ok !== true)
    throw new Error("HTTP hum call did not return a successful artifact.");
  if (result.structuredContent.performanceStatus?.status !== "available")
    throw new Error(
      "HTTP hum did not mark the synth-only exact execution closure available.",
    );
  if ("compiled" in result.structuredContent)
    throw new Error("HTTP hum leaked expanded events to the model result.");
  const artifact = result.structuredContent.artifact;
  const selectedBinding = artifact?.performanceBindings?.find(
    (binding) => binding.id === artifact.defaultBindingId,
  );
  if (
    artifact?.format !== "refrain-artifact@3-experimental" ||
    selectedBinding?.id !== "f-synthetic-beat@0"
  )
    throw new Error(
      "HTTP hum did not apply and retain its exact no-asset Canvas default binding.",
    );
  if (result._meta?.["refrain/canvas"] !== undefined)
    throw new Error(
      "HTTP AIR@1 hum duplicated its exact artifact in private Canvas metadata.",
    );
  if (
    result._meta?.["refrain/release"]?.bundleDigest !==
    expectedRelease.bundleDigest
  )
    throw new Error(
      "HTTP hum did not carry its exact private release identity.",
    );

  const audition = await assertAudition(client, tools, artifact);
  if (audition.release?.bundleDigest !== expectedRelease.bundleDigest)
    throw new Error(
      "HTTP audition did not carry its exact private release identity.",
    );

  const sampledFixture = JSON.parse(
    await readFile(resolve("fixtures/air-v1/crooked-return.air.json"), "utf8"),
  );
  const sampledResult = await client.callTool({
    name: "hum",
    arguments: { air: sampledFixture },
  });
  const sampledArtifact = sampledResult.structuredContent?.artifact;
  if (
    sampledResult.structuredContent?.ok !== true ||
    sampledArtifact?.defaultBindingId !== "f-synthetic-beat@0" ||
    sampledResult.structuredContent.performanceStatus?.status !==
      "unavailable" ||
    sampledResult.structuredContent.performanceStatus.reason !==
      "sample-origin-missing"
  )
    throw new Error(
      "HTTP hum did not preserve the exact sampled binding while marking its Canvas execution unavailable.",
    );
  const sampledText = sampledResult.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  if (
    !sampledText?.includes("unavailable in this MCP Canvas") ||
    sampledText.includes("Exact audible embodiment: f-synthetic-beat@0")
  )
    throw new Error(
      "HTTP hum gave the model a false audible-performance claim for a sampled Canvas closure.",
    );

  const resources = await client.listResources();
  if (resources.resources.length !== 1)
    throw new Error(
      `HTTP MCP server exposed ${resources.resources.length} resources; ChatGPT must discover only the App template.`,
    );
  const listedView = resources.resources.find(
    (resource) => resource.uri === resourceUri,
  );
  if (!listedView) throw new Error("HTTP MCP App resource was not listed.");
  if (resourceUri !== "ui://refrain/hum/v3.html")
    throw new Error(
      `HTTP hum advertised an unexpected App contract URI (${resourceUri}).`,
    );
  const csp = listedView._meta?.ui?.csp;
  for (const field of [
    "resourceDomains",
    "connectDomains",
    "frameDomains",
    "baseUriDomains",
  ]) {
    if (!Array.isArray(csp?.[field]) || csp[field].length !== 0)
      throw new Error(
        `The self-contained MCP App declared unexpected ${field}.`,
      );
  }
  const openAiCsp = listedView._meta?.["openai/widgetCSP"];
  for (const field of [
    "resource_domains",
    "connect_domains",
    "frame_domains",
  ]) {
    if (!Array.isArray(openAiCsp?.[field]) || openAiCsp[field].length !== 0)
      throw new Error(
        `The self-contained MCP App declared unexpected ${field}.`,
      );
  }
  if (
    !Array.isArray(openAiCsp?.redirect_domains) ||
    openAiCsp.redirect_domains.length !== 1 ||
    openAiCsp.redirect_domains[0] !== "https://files.oaiusercontent.com"
  )
    throw new Error(
      "The self-contained MCP App did not bind external export to the ChatGPT file origin.",
    );
  const view = await client.readResource({ uri: resourceUri });
  const html = view.contents.find(
    (item) => item.mimeType === "text/html;profile=mcp-app",
  );
  if (!html || typeof html.text !== "string") {
    throw new Error("HTTP MCP App resource returned the wrong MIME type.");
  }
  for (const marker of [
    "getFileDownloadUrl",
    "Host file export failed",
    "exact JSON was copied to the clipboard",
  ]) {
    if (!html.text.includes(marker))
      throw new Error(
        `The self-contained MCP App omitted its capability-aware export marker (${marker}).`,
      );
  }
  const htmlBytes = Buffer.byteLength(html.text);
  if (htmlBytes < 500_000 || htmlBytes > 5_000_000)
    throw new Error(
      `The self-contained MCP App resource has an unexpected size (${htmlBytes} bytes).`,
    );
  if (listedView.size !== htmlBytes)
    throw new Error(
      "The listed MCP App byte size does not match resources/read.",
    );
  const outerMarkup = html.text
    .replace(/<style>[\s\S]*<\/style>/, "<style></style>")
    .replace(
      /<script type="module">[\s\S]*<\/script>/,
      '<script type="module"></script>',
    );
  if (/(?:src|href)=["']/i.test(outerMarkup))
    throw new Error(
      "The self-contained MCP App still links an external asset.",
    );
  if (
    !html.text.includes('window.skybridge = { hostType: "mcp-app" };') ||
    html.text.includes(origin)
  )
    throw new Error(
      "The self-contained MCP App did not establish a host bridge without its loopback origin.",
    );

  const soundBank = await fetch(
    `${origin}/assets/soundpacks/GeneralUser-GS.sf2`,
    { method: "HEAD" },
  );
  const soundBankLength = Number(soundBank.headers.get("content-length"));
  if (!soundBank.ok || soundBankLength < 30_000_000)
    throw new Error(
      `The production SoundFont asset at ${origin} is missing or truncated (HTTP ${soundBank.status}, ${String(soundBank.headers.get("content-length"))} bytes).`,
    );

  const worklet = await fetch(`${origin}/assets/spessasynth_processor.min.js`);
  if (!worklet.ok || (await worklet.text()).length < 10_000)
    throw new Error(
      "The production AudioWorklet asset is missing or truncated.",
    );

  process.stdout.write(
    `${JSON.stringify(
      {
        transport: "streamable-http",
        tools: tools.tools.map((t) => t.name),
        audition,
        release: expectedRelease.bundleDigest,
        resource: resourceUri,
        canvasBytes: htmlBytes,
        canvasNetworkDependencies: 0,
        performanceBinding: "f-synthetic-beat@0",
        sampledPerformance: "sample-origin-missing",
        soundBankBytes: soundBankLength,
        worklet: "reachable",
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await client.close().catch(() => {});
  child.kill("SIGTERM");
  await new Promise((resolveExit) => {
    if (child.exitCode !== null) resolveExit();
    else child.once("exit", resolveExit);
  });
  if (stderr.length > 0) process.stderr.write(stderr.join(""));
  await rm(releaseRoot, { recursive: true, force: true });
}
