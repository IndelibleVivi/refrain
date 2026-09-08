import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve("bin/refrain.mjs"), "mcp", "stdio"],
  cwd: tmpdir(),
  stderr: "pipe",
});
const stderr = [];
transport.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
const client = new Client(
  { name: "refrain-conformance", version: "0.0.0-experimental" },
  { capabilities: { extensions: { "io.modelcontextprotocol/ui": {} } } },
);

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const humTool = tools.tools.find((tool) => tool.name === "hum");
  if (!humTool) throw new Error("hum was not discoverable over stdio.");
  const schemaText = JSON.stringify({
    input: humTool.inputSchema,
    output: humTool.outputSchema,
  });
  const contractText = JSON.stringify({
    description: humTool.description,
    input: humTool.inputSchema,
    output: humTool.outputSchema,
  });
  if (Buffer.byteLength(contractText) >= 120_000) {
    throw new Error(
      `hum's tools/list contract exceeded the 120 KB context budget (${Buffer.byteLength(contractText)} bytes).`,
    );
  }
  const resolveLocalRef = (schema, ref) => {
    let current = schema;
    for (const token of ref
      .slice(2)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))) {
      if (!current || typeof current !== "object" || !(token in current))
        return false;
      current = current[token];
    }
    return true;
  };
  const assertRefs = (schema, value = schema) => {
    if (Array.isArray(value)) {
      for (const item of value) assertRefs(schema, item);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (
      typeof value.$ref === "string" &&
      value.$ref.startsWith("#/") &&
      !resolveLocalRef(schema, value.$ref)
    )
      throw new Error(
        `hum published an unresolved local schema ref ${value.$ref}.`,
      );
    for (const child of Object.values(value)) assertRefs(schema, child);
  };
  assertRefs(humTool.inputSchema);
  assertRefs(humTool.outputSchema);
  for (const requiredTerm of [
    "air@0-experimental",
    "warm_piano",
    "soft_percussion",
    "harmony",
    "realize",
    "drum_grid",
    "motifLinks",
    "musical-relation@0-experimental",
    "refrain-receipt@0-experimental",
    "compiled-air-summary@0-experimental",
  ]) {
    if (!schemaText.includes(requiredTerm)) {
      throw new Error(`hum's tools/list contract omitted ${requiredTerm}.`);
    }
  }
  if (schemaText.includes('"context"')) {
    throw new Error("hum still exposed a private runtime context field.");
  }
  if (humTool.inputSchema.additionalProperties !== false) {
    throw new Error("hum did not publish a closed top-level input object.");
  }
  if (!humTool.outputSchema) {
    throw new Error("hum did not publish its compact success output schema.");
  }
  const ui = humTool._meta?.ui;
  if (!ui || typeof ui !== "object" || !("resourceUri" in ui)) {
    throw new Error("hum did not advertise its MCP App ui:// resource.");
  }
  if (
    !Array.isArray(ui.visibility) ||
    ui.visibility.length !== 1 ||
    ui.visibility[0] !== "model"
  ) {
    throw new Error("hum did not declare model-only MCP tool visibility.");
  }
  const resourceUri = ui.resourceUri;
  if (typeof resourceUri !== "string") {
    throw new Error("hum advertised an invalid MCP App resource URI.");
  }
  const fixture = JSON.parse(
    await readFile(resolve("fixtures/valid/returning-home.air.json"), "utf8"),
  );
  const result = await client.callTool({
    name: "hum",
    arguments: { air: fixture, caption: "Conformance air." },
  });
  const structured = result.structuredContent;
  if (!structured || structured.ok !== true)
    throw new Error("hum did not return a successful structured artifact.");
  if ("compiled" in structured) {
    throw new Error("hum leaked expanded compiled events to the model result.");
  }
  if (
    structured.receipt?.verification?.status !== "not_applicable" ||
    typeof structured.summary?.authoring?.segmentCount !== "number"
  ) {
    throw new Error("hum omitted G2 verification or compact authoring state.");
  }
  const resources = await client.listResources();
  const appResource = resources.resources.find(
    (resource) => resource.uri === resourceUri,
  );
  if (!appResource)
    throw new Error("hum's exact MCP App resource was not listed.");
  if (
    resources.resources.length !== 1 ||
    resourceUri !== "ui://refrain/hum/v3.html"
  )
    throw new Error(
      "The formal stdio entrypoint did not expose exactly the production Canvas.",
    );
  const csp = appResource._meta?.ui?.csp;
  if (
    !csp ||
    !Array.isArray(csp.resourceDomains) ||
    csp.resourceDomains.length !== 0 ||
    !Array.isArray(csp.connectDomains) ||
    csp.connectDomains.length !== 0
  ) {
    throw new Error(
      "The self-contained stdio Canvas must declare zero asset/connect domains.",
    );
  }
  const view = await client.readResource({ uri: appResource.uri });
  const html = view.contents.find(
    (item) => item.mimeType === "text/html;profile=mcp-app",
  );
  if (!html)
    throw new Error(
      "The ui:// resource did not resolve to text/html;profile=mcp-app.",
    );
  if (
    !html.text?.includes('<script type="module">') ||
    /<script[^>]+src=/.test(html.text)
  )
    throw new Error(
      "The stdio App must embed its script rather than depend on a dev server.",
    );
  const firstAir = JSON.parse(
    await readFile(
      resolve("fixtures/air-v1/synthetic-counterpulse.air.json"),
      "utf8",
    ),
  );
  const firstResult = await client.callTool({
    name: "hum",
    arguments: { air: firstAir },
  });
  const first = firstResult.structuredContent;
  if (
    first?.ok !== true ||
    first.artifact?.format !== "refrain-artifact@3-experimental" ||
    first.artifact.defaultBindingId !== "f-synthetic-beat@0" ||
    first.performanceStatus?.status !== "available"
  )
    throw new Error(
      "The first-use AIR@1 example must return a complete playable Artifact@3.",
    );
  process.stdout.write(
    JSON.stringify(
      {
        tool: humTool.name,
        resource: appResource.uri,
        sourceRevision: structured.receipt.sourceRevision,
        receiptId: structured.receipt.receiptId,
        events: structured.summary.eventCount,
        firstUse: {
          artifact: first.artifact.format,
          performanceStatus: first.performanceStatus.status,
        },
      },
      null,
      2,
    ),
  );
  process.stdout.write("\n");
} finally {
  await client.close();
}

if (stderr.length > 0) process.stderr.write(stderr.join(""));
