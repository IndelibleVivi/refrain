import { chromium, devices } from "@playwright/test";
import {
  MCP_HOST_DEVICES,
  MCP_HOST_PROFILES,
  MCP_HOST_TRANSPORTS,
  mcpHostInitScript,
  startMcpHostHarness,
} from "./lib/mcp-host-harness.mjs";

function readOption(name) {
  const prefix = `--${name}=`;
  const argument = process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length);
}

function isAllowedRequest(url) {
  if (/^(?:about|blob|data):/.test(url)) return true;
  const parsed = new URL(url);
  return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
}

const profile = readOption("profile");
const device = readOption("device") ?? "desktop";
const transport = readOption("transport") ?? "preserve";
const fixture = readOption("fixture") ?? "synthetic";
const failure = readOption("failure");
const headless = process.argv.includes("--headless");

if (!MCP_HOST_PROFILES.includes(profile)) {
  throw new Error(
    `Choose one explicit host profile with --profile=${MCP_HOST_PROFILES.join("|")}.`,
  );
}
if (!MCP_HOST_DEVICES.includes(device)) {
  throw new Error(
    `Choose one explicit host device with --device=${MCP_HOST_DEVICES.join("|")}.`,
  );
}
if (!MCP_HOST_TRANSPORTS.includes(transport)) {
  throw new Error(
    `Choose one explicit host transport with --transport=${MCP_HOST_TRANSPORTS.join("|")}.`,
  );
}

const harness = await startMcpHostHarness();
if (!harness.cases[fixture]) {
  await harness.close();
  throw new Error(`Unknown MCP host fixture ${fixture}.`);
}

let browser;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await browser?.close().catch(() => {});
  await harness.close();
}

try {
  browser = await chromium.launch({ headless });
  const context = await browser.newContext(
    device === "mobile" ? devices["Pixel 7"] : {},
  );
  await context.addInitScript(mcpHostInitScript);
  const blockedRequests = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (isAllowedRequest(request.url())) {
      await route.continue();
      return;
    }
    const detail = {
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
    };
    blockedRequests.push(detail);
    for (const currentPage of context.pages()) {
      void currentPage
        .evaluate((request) => {
          window.__REFRAIN_MCP_HOST__?.recordUnexpectedNetwork(request);
        }, detail)
        .catch(() => {});
    }
    await route.abort("blockedbyclient");
  });

  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      process.stderr.write(`[browser:${message.type()}] ${message.text()}\n`);
    }
  });
  page.on("pageerror", (error) => {
    process.stderr.write(
      `[browser:pageerror] ${error.stack ?? error.message}\n`,
    );
  });
  await page.goto(
    harness.url({ profile, device, transport, fixture, failure }),
    {
      waitUntil: "domcontentloaded",
    },
  );
  await page
    .frameLocator("#refrain-app")
    .locator("article.mcp-piece")
    .waitFor({ state: "visible" });
  if (blockedRequests.length) {
    await page.evaluate((requests) => {
      for (const request of requests) {
        window.__REFRAIN_MCP_HOST__.recordUnexpectedNetwork(request);
      }
    }, blockedRequests);
  }

  const selectedCase = harness.cases[fixture];
  process.stdout.write(
    [
      "Refrain local MCP host is ready.",
      `URL: ${page.url()}`,
      `Profile: ${profile}`,
      `Device: ${device}`,
      `Transport: ${transport}`,
      `Fixture: ${fixture}`,
      ...(failure ? [`Deliberate failure plane: ${failure}`] : []),
      `Resource: ${harness.resource.uri}`,
      `Resource MIME: ${harness.resource.mimeType}`,
      `Resource bytes: ${harness.resource.bytes}`,
      `Binding: ${selectedCase.identity.bindingId}`,
      `Receipt: ${selectedCase.identity.receiptId}`,
      "Host evidence: the right-hand Local MCP host evidence panel and browser console.",
      "Press Ctrl-C to close the host.",
      "",
    ].join("\n"),
  );

  const finished = new Promise((accept) => {
    process.once("SIGINT", accept);
    process.once("SIGTERM", accept);
    browser.once("disconnected", accept);
  });
  await finished;
} finally {
  await close();
}
