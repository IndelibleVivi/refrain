import {
  expect,
  test,
  type BrowserContext,
  type FrameLocator,
  type Page,
} from "@playwright/test";
import {
  mcpHostInitScript,
  startMcpHostHarness,
} from "../../scripts/lib/mcp-host-harness.mjs";

interface NetworkObservation {
  method: string;
  resourceType: string;
  url: string;
}

interface BrowserObservation {
  harnessOrigin?: string;
  mcpOrigin?: string;
  mode?: "development" | "production";
  consoleFailures: Array<{ text: string; type: string }>;
  pageErrors: string[];
  requests: NetworkObservation[];
  unexpectedNetworkRequests: NetworkObservation[];
  reportedUnexpectedRequests: number;
}

interface HostEvidence {
  audio: Array<{ contextId?: number; state?: string; type: string }>;
  clipboardWrites: Array<{ text: string }>;
  consoleErrors: unknown[];
  currentFixture: string;
  device: "desktop" | "mobile";
  downloadUrls: unknown[];
  externalOpens: unknown[];
  failure: string | null;
  handshake: Array<{ method: string }>;
  hostCapabilities: {
    sandbox: { permissions: Record<string, Record<string, never>> };
  };
  hostContext: {
    deviceCapabilities: { hover: boolean; touch: boolean };
    platform: "desktop" | "mobile";
    safeAreaInsets: {
      bottom: number;
      left: number;
      right: number;
      top: number;
    };
  };
  lifecycle: Array<{ childCount: number; index: number; type: string }>;
  mode: "development" | "production";
  permissions: {
    granted: Record<string, Record<string, never>>;
    requested: Record<string, Record<string, never>>;
  };
  portableDownloads: Array<Record<string, unknown>>;
  profile: string;
  protocolRequests: Array<{ method: string; params?: unknown }>;
  resource: {
    bytes: number;
    delivery: string;
    mimeType: string;
    uri: string;
    _meta: {
      ui?: { permissions?: Record<string, Record<string, never>> };
    };
  };
  selectionReturns: Array<Record<string, unknown>>;
  transport: "preserve" | "reordered";
  unhandledExceptions: unknown[];
  unexpectedNetworkRequests: NetworkObservation[];
  uploads: Array<{
    argumentCount: number;
    base64: string;
    bytes: number;
    filename: string;
    mimeType: string;
    options: unknown;
  }>;
}

interface AppOptions {
  device?: "desktop" | "mobile";
  failure?: string;
  fixture?: "replacement" | "sampled" | "synthetic";
  profile: "chat-file" | "portable" | "restricted";
  transport?: "preserve" | "reordered";
}

test.use({ locale: "zh-CN" });

const browserObservations = new WeakMap<Page, BrowserObservation>();
const HANDOFF_MARKER = "Refrain selection handoff JSON:\n";

let harness: Awaited<ReturnType<typeof startMcpHostHarness>>;
let developmentHarness: Awaited<ReturnType<typeof startMcpHostHarness>>;

function browserObservation(page: Page): BrowserObservation {
  const observation = browserObservations.get(page);
  if (!observation) throw new Error("Browser observation was not initialized.");
  return observation;
}

function isAllowedBrowserRequest(
  url: string,
  observation: BrowserObservation,
): boolean {
  if (/^(?:about|blob|data):/.test(url)) return true;
  const parsed = new URL(url);
  if (parsed.origin === observation.harnessOrigin) {
    if (observation.mode === "development") return true;
    return parsed.pathname === "/" || parsed.pathname === "/app";
  }
  return (
    observation.mode === "development" &&
    parsed.origin === observation.mcpOrigin
  );
}

async function installBrowserBoundary(
  context: BrowserContext,
  page: Page,
): Promise<void> {
  await context.addInitScript(mcpHostInitScript);
  const observation: BrowserObservation = {
    consoleFailures: [],
    pageErrors: [],
    requests: [],
    unexpectedNetworkRequests: [],
    reportedUnexpectedRequests: 0,
  };
  browserObservations.set(page, observation);

  await context.route("**/*", async (route) => {
    const request = route.request();
    const detail = {
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    };
    observation.requests.push(detail);
    if (isAllowedBrowserRequest(detail.url, observation)) {
      await route.continue();
      return;
    }
    observation.unexpectedNetworkRequests.push(detail);
    await route.abort("blockedbyclient");
  });

  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      observation.consoleFailures.push({
        text: message.text(),
        type: message.type(),
      });
    }
  });
  page.on("pageerror", (error) => {
    observation.pageErrors.push(error.stack ?? error.message);
  });
}

async function recordUnexpectedNetwork(page: Page): Promise<void> {
  const observation = browserObservation(page);
  const unreported = observation.unexpectedNetworkRequests.slice(
    observation.reportedUnexpectedRequests,
  );
  if (!unreported.length || page.isClosed()) return;
  await page.evaluate((requests) => {
    const localHost = (
      window as unknown as {
        __REFRAIN_MCP_HOST__?: {
          recordUnexpectedNetwork: (detail: NetworkObservation) => void;
        };
      }
    ).__REFRAIN_MCP_HOST__;
    requests.forEach((request) => localHost?.recordUnexpectedNetwork(request));
  }, unreported);
  observation.reportedUnexpectedRequests += unreported.length;
}

async function readHostEvidence(page: Page): Promise<HostEvidence> {
  const text = await page.locator("#evidence").textContent();
  if (!text)
    throw new Error("The local host did not render its evidence ledger.");
  return JSON.parse(text) as HostEvidence;
}

async function openApp(
  page: Page,
  options: AppOptions,
  activeHarness = harness,
): Promise<FrameLocator> {
  const observation = browserObservation(page);
  observation.harnessOrigin = activeHarness.origin;
  observation.mcpOrigin = activeHarness.mcpOrigin;
  observation.mode = activeHarness.mode;
  await page.goto(activeHarness.url(options), {
    waitUntil: "domcontentloaded",
  });
  const app = page.frameLocator("#refrain-app");
  await expect(app.locator("article.mcp-piece")).toBeVisible();
  await expect(
    app.locator('.refrain-renderer[data-surface="mcp-canvas"]'),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const evidence = await readHostEvidence(page);
      return evidence.handshake.map((item) => item.method);
    })
    .toEqual(
      expect.arrayContaining(["ui/initialize", "ui/notifications/initialized"]),
    );
  return app;
}

async function expectCleanRuntime(page: Page): Promise<void> {
  await recordUnexpectedNetwork(page);
  const observation = browserObservation(page);
  expect(observation.unexpectedNetworkRequests).toEqual([]);
  expect(observation.consoleFailures).toEqual([]);
  expect(observation.pageErrors).toEqual([]);
  const evidence = await readHostEvidence(page);
  expect(evidence.consoleErrors).toEqual([]);
  expect(evidence.unhandledExceptions).toEqual([]);
  expect(evidence.unexpectedNetworkRequests).toEqual([]);
}

async function openProductDetails(app: FrameLocator): Promise<void> {
  const details = app.locator("details.product-details");
  if (!(await details.getAttribute("open"))) {
    await details.locator("summary").click();
  }
  await expect(details).toHaveAttribute("open", "");
}

function findStringContaining(
  value: unknown,
  marker: string,
): string | undefined {
  if (typeof value === "string")
    return value.includes(marker) ? value : undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findStringContaining(item, marker);
      if (match) return match;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const match = findStringContaining(item, marker);
      if (match) return match;
    }
  }
  return undefined;
}

function handoffFromRequest(value: unknown): Record<string, unknown> {
  const request = findStringContaining(value, HANDOFF_MARKER);
  if (!request)
    throw new Error("Selection return did not contain a closed handoff.");
  return JSON.parse(
    request.slice(request.indexOf(HANDOFF_MARKER) + HANDOFF_MARKER.length),
  );
}

function portableText(value: Record<string, unknown>): string {
  const contents = value.contents;
  if (!Array.isArray(contents)) {
    throw new Error("Portable download did not carry resource contents.");
  }
  const first = contents[0] as
    { resource?: { text?: unknown }; type?: unknown } | undefined;
  if (first?.type !== "resource" || typeof first.resource?.text !== "string") {
    throw new Error("Portable download did not carry exact text bytes.");
  }
  return first.resource.text;
}

function modelText(value: { content?: unknown }): string {
  if (!Array.isArray(value.content)) return "";
  return value.content
    .filter((item): item is { text: string; type: "text" } =>
      Boolean(
        item &&
        typeof item === "object" &&
        (item as { type?: unknown }).type === "text" &&
        typeof (item as { text?: unknown }).text === "string",
      ),
    )
    .map(({ text }) => text)
    .join("\n");
}

async function selectVisibleMotif(
  app: FrameLocator,
): Promise<{ anchor: string; optionLabel: string }> {
  const motif = app
    .locator(
      '.air-figure .svg-motif-occurrence[data-anchor][tabindex="0"]:not([aria-hidden="true"])',
    )
    .last();
  await expect(motif).toBeVisible();
  const anchor = await motif.getAttribute("data-anchor");
  if (!anchor)
    throw new Error("Visible motif did not expose its exact anchor.");
  const [voiceId, , occurrence, motifId] = anchor.split(":");
  if (!voiceId || !motifId || !occurrence) {
    throw new Error(
      `Could not map exact motif anchor ${anchor} to its selector option.`,
    );
  }
  await motif.click();
  await expect(
    app.locator('.selection-strip[data-visible="true"]'),
  ).toBeVisible();
  return {
    anchor,
    optionLabel: `motif · @${motifId} · ${voiceId} · #${occurrence}`,
  };
}

test.beforeAll(async () => {
  harness = await startMcpHostHarness();
  developmentHarness = await startMcpHostHarness({ mode: "development" });
});

test.afterAll(async () => {
  await Promise.all([harness.close(), developmentHarness.close()]);
});

test.beforeEach(async ({ context, page }) => {
  await installBrowserBoundary(context, page);
});

test.afterEach(async ({ page }, testInfo) => {
  const observation = browserObservations.get(page);
  let evidence: HostEvidence | undefined;
  let evidenceReadError: string | undefined;
  try {
    await recordUnexpectedNetwork(page);
    evidence = await readHostEvidence(page);
  } catch (error) {
    evidenceReadError = error instanceof Error ? error.message : String(error);
  }
  await testInfo.attach("host-evidence", {
    body: JSON.stringify(
      {
        browser: observation,
        evidence,
        evidenceReadError,
        resource:
          observation?.mode === "development"
            ? developmentHarness?.resource
            : harness?.resource,
        test: testInfo.title,
        url: page.isClosed() ? null : page.url(),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});

test("mounts the exact production App without network or pre-gesture audio", async ({
  page,
}) => {
  const app = await openApp(page, {
    profile: "portable",
    fixture: "synthetic",
  });
  const expected = harness.cases.synthetic;
  const artifact = expected.result.structuredContent.artifact;

  expect(harness.resource.mimeType).toBe("text/html;profile=mcp-app");
  expect(harness.resource.bytes).toBeGreaterThan(0);
  expect(artifact.defaultBindingId).toBe("f-synthetic-beat@0");
  expect(artifact.performanceBindings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "f-synthetic-beat@0" }),
    ]),
  );
  expect(expected.result.structuredContent.performanceStatus).toEqual({
    status: "available",
  });
  await expect(app.locator("article.mcp-piece")).toHaveAttribute(
    "aria-label",
    /MCP Canvas$/,
  );
  await expect(app.locator("h2.piece-title")).toHaveText(
    expected.input.air.title,
  );

  const evidence = await readHostEvidence(page);
  expect(evidence.currentFixture).toBe("synthetic");
  expect(evidence.resource).toMatchObject(harness.resource);
  expect(evidence.resource.delivery).toBe("exact-production-resource");
  expect(evidence.audio).toEqual([]);
  expect(
    browserObservation(page).requests.map(({ url }) => new URL(url).pathname),
  ).toEqual(["/", "/app"]);
  await expectCleanRuntime(page);
});

test("survives development StrictMode setup-cleanup-setup before first Play", async ({
  page,
}) => {
  const app = await openApp(
    page,
    { profile: "portable", fixture: "synthetic" },
    developmentHarness,
  );
  const live = app.locator(".refrain-renderer__live");

  await expect
    .poll(async () =>
      (await readHostEvidence(page)).lifecycle
        .slice(0, 3)
        .map(({ type }) => type),
    )
    .toEqual(["setup", "cleanup", "setup"]);
  expect((await readHostEvidence(page)).audio).toEqual([]);

  await app.getByRole("button", { name: "播放", exact: true }).click();
  await expect(live).toContainText("正在播放");
  await expect
    .poll(
      async () =>
        (await readHostEvidence(page)).audio.filter(
          ({ type }) => type === "create",
        ).length,
    )
    .toBe(1);
  await expectCleanRuntime(page);
});

test("plays, pauses, seeks, resumes, and stops synthetic audio from real controls", async ({
  page,
}) => {
  const app = await openApp(page, {
    profile: "portable",
    fixture: "synthetic",
  });
  const seek = app.locator('input[aria-label="调整这首 air 的播放进度"]');
  const restart = app.getByRole("button", { name: "重新开始", exact: true });
  const stop = app.getByRole("button", { name: "停止", exact: true });
  const live = app.locator(".refrain-renderer__live");

  await restart.click();
  await stop.click();
  await seek.click({ position: { x: 90, y: 8 } });
  expect((await readHostEvidence(page)).audio).toEqual([]);

  await app.getByRole("button", { name: "播放", exact: true }).click();
  await expect(live).toContainText("正在播放");
  await expect(
    app.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await readHostEvidence(page)).audio.filter(
          ({ type }) => type === "create",
        ).length,
    )
    .toBe(1);

  await app.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(live).toContainText("已暂停");
  await seek.click({ position: { x: 180, y: 8 } });
  await expect(live).toContainText("已暂停");
  const pausedBeat = Number(await seek.inputValue());
  expect(pausedBeat).toBeGreaterThan(0);

  await app.getByRole("button", { name: "播放", exact: true }).click();
  await expect(live).toContainText("正在播放");
  const resumedBeat = Number(await seek.inputValue());
  expect(resumedBeat).toBeGreaterThan(0);
  expect(Math.abs(resumedBeat - pausedBeat)).toBeLessThan(0.75);

  await stop.click();
  await expect(live).toContainText("可以播放");
  await expect(seek).toHaveValue("0");
  await expect(
    app.locator('[role="slider"][aria-label="播放位置"]'),
  ).toHaveAttribute("aria-valuenow", /^0(?:\.0+)?$/);
  await expectCleanRuntime(page);
});

test("keeps a sampled exact binding canonical while execution is unavailable", async ({
  page,
}) => {
  const app = await openApp(page, { profile: "portable", fixture: "sampled" });
  const expected = harness.cases.sampled;
  const artifact = expected.result.structuredContent.artifact;
  const unavailable = app.locator('.refrain-renderer__notice[role="status"]');

  expect(artifact.defaultBindingId).toBe("f-synthetic-beat@0");
  expect(artifact.performanceBindings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "f-synthetic-beat@0" }),
    ]),
  );
  expect(expected.result.structuredContent.performanceStatus).toMatchObject({
    status: "unavailable",
    reason: "sample-origin-missing",
  });
  expect(modelText(expected.result)).toContain(
    "unavailable in this MCP Canvas",
  );
  expect(modelText(expected.result)).not.toContain(
    "Exact audible embodiment: f-synthetic-beat@0",
  );
  await expect(unavailable).toContainText(
    "这首 air 可以查看和保存，但这里暂时无法播放它绑定的声音。",
  );
  await expect(
    app.getByRole("button", { name: "播放", exact: true }),
  ).toBeDisabled();
  await expect(
    app.getByRole("button", { name: "重新开始", exact: true }),
  ).toBeDisabled();
  await expect(
    app.getByRole("button", { name: "停止", exact: true }),
  ).toBeDisabled();
  await expect(
    app.locator('input[aria-label="调整这首 air 的播放进度"]'),
  ).toBeDisabled();
  await openProductDetails(app);
  await expect(
    app.getByRole("button", { name: "导出 Refrain artifact" }),
  ).toBeEnabled();
  await expect(app.locator('select[aria-label="选择一段"]')).toBeEnabled();
  expect((await readHostEvidence(page)).audio).toEqual([]);
  await expectCleanRuntime(page);
});

test("exports exact Artifact@3 through the chat file host path", async ({
  page,
}) => {
  const app = await openApp(page, {
    profile: "chat-file",
    fixture: "synthetic",
  });
  const expected = harness.cases.synthetic.expected.artifactText;
  await openProductDetails(app);

  await app.getByRole("button", { name: "导出 Refrain artifact" }).click();
  await expect(app.getByRole("status")).toContainText(
    "已通过当前宿主打开文件导出。",
  );
  await expect
    .poll(async () => (await readHostEvidence(page)).uploads.length)
    .toBe(1);
  const evidence = await readHostEvidence(page);
  const upload = evidence.uploads[0];
  expect(upload.argumentCount).toBe(2);
  expect(upload.options).toBeNull();
  expect(upload.mimeType).toBe("application/json");
  expect(upload.bytes).toBe(Buffer.byteLength(expected));
  expect(Buffer.from(upload.base64, "base64").toString("utf8")).toBe(expected);
  expect(evidence.downloadUrls).toHaveLength(1);
  expect(evidence.downloadUrls[0]).toMatchObject({
    fileId: "file_local_exact",
    mimeType: "application/json",
  });
  expect(evidence.externalOpens).toEqual([
    expect.objectContaining({
      redirectUrl: false,
      route: "chat-file",
    }),
  ]);
  expect(evidence.portableDownloads).toEqual([]);
  expect(evidence.clipboardWrites).toEqual([]);
  await expectCleanRuntime(page);
});

test("does not fall back after a chat upload AbortError", async ({ page }) => {
  const app = await openApp(page, {
    profile: "chat-file",
    fixture: "synthetic",
    failure: "upload",
  });
  await openProductDetails(app);

  await app.getByRole("button", { name: "导出 Refrain artifact" }).click();
  await expect(app.getByRole("alert")).toContainText("Host file export failed");
  await expect(app.getByRole("alert")).toContainText("User cancelled");
  const evidence = await readHostEvidence(page);
  expect(evidence.uploads).toHaveLength(1);
  expect(evidence.downloadUrls).toEqual([]);
  expect(evidence.externalOpens).toEqual([]);
  expect(evidence.portableDownloads).toEqual([]);
  expect(evidence.clipboardWrites).toEqual([]);
  await expectCleanRuntime(page);
});

test("does not fall back after a chat download URL NotAllowedError", async ({
  page,
}) => {
  const app = await openApp(page, {
    profile: "chat-file",
    fixture: "synthetic",
    failure: "download-url",
  });
  await openProductDetails(app);

  await app.getByRole("button", { name: "导出 Refrain artifact" }).click();
  await expect(app.getByRole("alert")).toContainText("Host file export failed");
  await expect(app.getByRole("alert")).toContainText("NotAllowedError");
  await expect(app.getByRole("alert")).toContainText("Blocked by local policy");
  const evidence = await readHostEvidence(page);
  expect(evidence.uploads).toHaveLength(1);
  expect(evidence.downloadUrls).toHaveLength(1);
  expect(evidence.externalOpens).toEqual([]);
  expect(evidence.portableDownloads).toEqual([]);
  expect(evidence.clipboardWrites).toEqual([]);
  await expectCleanRuntime(page);
});

test("uses portable exact JSON export when a mobile chat host exposes file methods", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  const app = await openApp(page, {
    profile: "chat-file",
    device: "mobile",
    fixture: "synthetic",
    transport: "reordered",
  });
  const expectedCase = harness.cases.synthetic;
  const rawChatFileMethods = await app.locator("body").evaluate(() => {
    const openai = (
      window as typeof window & {
        openai?: Record<string, unknown>;
      }
    ).openai;
    return ["uploadFile", "getFileDownloadUrl", "openExternal"].map(
      (method) => typeof openai?.[method],
    );
  });
  expect(rawChatFileMethods).toEqual(["function", "function", "function"]);
  await openProductDetails(app);

  await app
    .getByRole("button", { name: "导出 Refrain artifact", exact: true })
    .click();
  await expect
    .poll(async () => (await readHostEvidence(page)).portableDownloads.length)
    .toBe(1);
  await app
    .getByRole("button", { name: "导出 AIR source", exact: true })
    .click();
  await expect
    .poll(async () => (await readHostEvidence(page)).portableDownloads.length)
    .toBe(2);

  const evidence = await readHostEvidence(page);
  expect(evidence.device).toBe("mobile");
  expect(evidence.transport).toBe("reordered");
  expect(evidence.hostContext).toMatchObject({
    platform: "mobile",
    deviceCapabilities: { hover: false, touch: true },
    safeAreaInsets: { top: 47, right: 0, bottom: 34, left: 0 },
  });
  expect(evidence.uploads).toEqual([]);
  expect(evidence.downloadUrls).toEqual([]);
  expect(evidence.externalOpens).toEqual([]);
  expect(evidence.clipboardWrites).toEqual([]);
  expect(evidence.portableDownloads).toEqual([
    {
      contents: [
        {
          type: "resource",
          resource: expect.objectContaining({
            mimeType: "application/json",
            uri: expect.stringMatching(/\.refrain\.json$/),
          }),
        },
      ],
    },
    {
      contents: [
        {
          type: "resource",
          resource: expect.objectContaining({
            mimeType: "application/json",
            uri: expect.stringMatching(/\.air\.json$/),
          }),
        },
      ],
    },
  ]);
  const artifactText = portableText(evidence.portableDownloads[0]);
  const sourceText = portableText(evidence.portableDownloads[1]);
  const artifactJson = JSON.parse(artifactText);
  const sourceJson = JSON.parse(sourceText);
  expect(artifactText).toBe(`${JSON.stringify(artifactJson, null, 2)}\n`);
  expect(sourceText).toBe(`${JSON.stringify(sourceJson, null, 2)}\n`);
  expect(artifactJson).toEqual(expectedCase.result.structuredContent.artifact);
  expect(sourceJson).toEqual(expectedCase.input.air);
  await expectCleanRuntime(page);
});

test("uses exact clipboard fallback after mobile portable rejection only with requested permission", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  const app = await openApp(page, {
    profile: "chat-file",
    device: "mobile",
    fixture: "synthetic",
    failure: "portable",
  });
  const expected = harness.cases.synthetic.expected;
  await openProductDetails(app);

  await app
    .getByRole("button", { name: "导出 Refrain artifact", exact: true })
    .click();
  await expect
    .poll(async () => (await readHostEvidence(page)).clipboardWrites.length)
    .toBe(1);
  await app
    .getByRole("button", { name: "导出 AIR source", exact: true })
    .click();
  await expect
    .poll(async () => (await readHostEvidence(page)).clipboardWrites.length)
    .toBe(2);

  const evidence = await readHostEvidence(page);
  expect(evidence.resource._meta.ui?.permissions).toMatchObject({
    clipboardWrite: {},
  });
  expect(evidence.permissions.requested).toMatchObject({ clipboardWrite: {} });
  expect(evidence.permissions.granted).toMatchObject({ clipboardWrite: {} });
  expect(evidence.hostCapabilities.sandbox.permissions).toMatchObject({
    clipboardWrite: {},
  });
  expect(evidence.portableDownloads).toHaveLength(2);
  expect(portableText(evidence.portableDownloads[0])).toBe(
    expected.artifactText,
  );
  expect(portableText(evidence.portableDownloads[1])).toBe(expected.sourceText);
  expect(evidence.clipboardWrites).toEqual([
    { text: expected.artifactText },
    { text: expected.sourceText },
  ]);
  expect(evidence.uploads).toEqual([]);
  expect(evidence.downloadUrls).toEqual([]);
  expect(evidence.externalOpens).toEqual([]);
  await expectCleanRuntime(page);
});

test("exports exact Artifact@3 through an accepted portable download", async ({
  page,
}) => {
  const app = await openApp(page, {
    profile: "portable",
    fixture: "synthetic",
  });
  const expected = harness.cases.synthetic.expected.artifactText;
  await openProductDetails(app);

  await app.getByRole("button", { name: "导出 Refrain artifact" }).click();
  await expect(app.getByRole("status")).toContainText(
    "当前宿主已接收文件导出。",
  );
  await expect
    .poll(async () => (await readHostEvidence(page)).portableDownloads.length)
    .toBe(1);
  const evidence = await readHostEvidence(page);
  expect(portableText(evidence.portableDownloads[0])).toBe(expected);
  expect(evidence.uploads).toEqual([]);
  expect(evidence.clipboardWrites).toEqual([]);
  await expectCleanRuntime(page);
});

test("copies exact Artifact@3 after a portable rejection", async ({ page }) => {
  const app = await openApp(page, {
    profile: "portable",
    fixture: "synthetic",
    failure: "portable",
  });
  const expected = harness.cases.synthetic.expected.artifactText;
  await openProductDetails(app);

  await app.getByRole("button", { name: "导出 Refrain artifact" }).click();
  await expect(app.getByRole("status")).toContainText(
    "完整 JSON 已复制到剪贴板",
  );
  const evidence = await readHostEvidence(page);
  expect(evidence.portableDownloads).toHaveLength(1);
  expect(evidence.clipboardWrites).toEqual([{ text: expected }]);
  expect(evidence.uploads).toEqual([]);
  await expectCleanRuntime(page);
});

test("reports a restricted portable and clipboard double failure", async ({
  page,
}) => {
  const app = await openApp(page, {
    profile: "restricted",
    fixture: "synthetic",
  });
  await openProductDetails(app);

  await app.getByRole("button", { name: "导出 Refrain artifact" }).click();
  await expect(app.getByRole("alert")).toContainText(
    "The host rejected file download and the clipboard fallback failed",
  );
  const evidence = await readHostEvidence(page);
  expect(evidence.portableDownloads).toHaveLength(1);
  expect(evidence.clipboardWrites).toHaveLength(1);
  expect(evidence.uploads).toEqual([]);
  await expectCleanRuntime(page);
});

test("returns, copies, and exports one exact selection with its closed Artifact@3", async ({
  page,
}) => {
  const app = await openApp(page, {
    profile: "portable",
    fixture: "synthetic",
  });
  const expectedArtifact =
    harness.cases.synthetic.result.structuredContent.artifact;

  const selectedMotif = await selectVisibleMotif(app);
  const strip = app.locator('.selection-strip[data-visible="true"]');
  await strip.getByRole("button", { name: "交给对话", exact: true }).click();
  await expect
    .poll(async () => (await readHostEvidence(page)).selectionReturns.length)
    .toBe(1);

  await openProductDetails(app);
  const select = app.locator('select[aria-label="选择一段"]');
  await select.selectOption({ label: selectedMotif.optionLabel });
  const exactActions = app.locator(".exact-selection__actions");

  await exactActions.getByRole("button", { name: "复制请求" }).click();
  await expect
    .poll(async () => (await readHostEvidence(page)).clipboardWrites.length)
    .toBe(1);

  await exactActions.getByRole("button", { name: "导出选段" }).click();
  await expect
    .poll(async () => (await readHostEvidence(page)).portableDownloads.length)
    .toBe(1);

  await exactActions.getByRole("button", { name: "交给对话" }).click();
  await expect
    .poll(async () => (await readHostEvidence(page)).selectionReturns.length)
    .toBe(2);

  const evidence = await readHostEvidence(page);
  const returned = evidence.selectionReturns.map(handoffFromRequest);
  const copied = handoffFromRequest(evidence.clipboardWrites[0].text);
  const exported = JSON.parse(portableText(evidence.portableDownloads[0]));
  for (const handoff of [...returned, copied, exported]) {
    expect(handoff).toMatchObject({
      format: "refrain-selection-handoff@0-experimental",
      selection: {
        anchor: selectedMotif.anchor,
        format: "refrain-selection@0-experimental",
        kind: "motif",
      },
    });
    expect(handoff.parentArtifact).toEqual(expectedArtifact);
  }
  expect(
    evidence.protocolRequests.some(({ method }) =>
      method.includes("tools/call"),
    ),
  ).toBe(false);
  await expectCleanRuntime(page);
});

test("does not report selection success when a restricted host rejects return", async ({
  page,
}) => {
  const app = await openApp(page, {
    profile: "restricted",
    fixture: "synthetic",
  });
  await selectVisibleMotif(app);
  const strip = app.locator('.selection-strip[data-visible="true"]');
  const returnButton = strip.locator("button.selection-action");

  await expect(returnButton).toHaveText("交给对话");
  await returnButton.click();
  await expect(returnButton).toHaveText("操作未完成", { timeout: 2_000 });
  await expect(returnButton).not.toHaveText("已交给对话");
  await expect
    .poll(async () => (await readHostEvidence(page)).selectionReturns.length)
    .toBe(1);
  await expect(
    app.locator('.refrain-renderer__notice[role="status"]'),
  ).toContainText("Selection return is unavailable in this host profile.");
  await expectCleanRuntime(page);
});

test("retires an active artifact engine before playing its same-iframe replacement", async ({
  page,
}) => {
  const app = await openApp(page, {
    profile: "portable",
    fixture: "synthetic",
  });
  const frameUrl = page
    .frames()
    .find((frame) => frame !== page.mainFrame())
    ?.url();
  const live = app.locator(".refrain-renderer__live");
  const seek = app.locator('input[aria-label="调整这首 air 的播放进度"]');

  await app.getByRole("button", { name: "播放", exact: true }).click();
  await expect(live).toContainText("正在播放");
  await expect
    .poll(
      async () =>
        (await readHostEvidence(page)).audio.filter(
          ({ type }) => type === "create",
        ).length,
    )
    .toBe(1);
  const firstResume = (await readHostEvidence(page)).audio.find(
    ({ type }) => type === "resume",
  );
  expect(firstResume?.contextId).toBeDefined();

  await page.evaluate(() => {
    (
      window as unknown as {
        __REFRAIN_MCP_HOST__: { render: (fixture: string) => unknown };
      }
    ).__REFRAIN_MCP_HOST__.render("replacement");
  });
  await expect(app.locator("h2.piece-title")).toHaveText(
    harness.cases.replacement.input.air.title,
  );
  await expect(live).toContainText("等待播放");
  await expect(seek).toHaveValue("0");
  expect(
    page
      .frames()
      .find((frame) => frame !== page.mainFrame())
      ?.url(),
  ).toBe(frameUrl);
  await expect
    .poll(async () => {
      const evidence = await readHostEvidence(page);
      return evidence.audio.some(
        ({ contextId, type }) =>
          type === "close" && contextId === firstResume?.contextId,
      );
    })
    .toBe(true);

  await app.getByRole("button", { name: "播放", exact: true }).click();
  await expect(live).toContainText("正在播放");
  await expect
    .poll(
      async () =>
        (await readHostEvidence(page)).audio.filter(
          ({ type }) => type === "create",
        ).length,
    )
    .toBe(2);
  const resumedContextIds = (await readHostEvidence(page)).audio
    .filter(({ type }) => type === "resume")
    .map(({ contextId }) => contextId);
  expect(new Set(resumedContextIds).size).toBe(2);
  await expectCleanRuntime(page);
});

for (const viewport of [
  { height: 844, label: "390x844", width: 390 },
  { height: 900, label: "desktop", width: 1280 },
]) {
  test(`keeps the MCP Canvas bounded and keyboard-focusable at ${viewport.label}`, async ({
    page,
  }) => {
    await page.setViewportSize({
      height: viewport.height,
      width: viewport.width,
    });
    const app = await openApp(page, {
      profile: "portable",
      fixture: "synthetic",
    });
    const article = app.locator("article.mcp-piece");
    const metrics = await app.locator("html").evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    const articleBox = await article.boundingBox();
    if (!articleBox)
      throw new Error("The MCP article did not have a layout box.");

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    expect(articleBox.x).toBeGreaterThanOrEqual(0);
    expect(articleBox.x + articleBox.width).toBeLessThanOrEqual(
      metrics.clientWidth + 1,
    );
    expect(articleBox.width).toBeLessThanOrEqual(391);
    await expect(
      app.getByRole("button", { name: "播放", exact: true }),
    ).toBeVisible();
    await expect(
      app.getByRole("button", { name: "重新开始", exact: true }),
    ).toBeVisible();
    await expect(
      app.getByRole("button", { name: "停止", exact: true }),
    ).toBeVisible();
    await expect(
      app.locator('input[aria-label="调整这首 air 的播放进度"]'),
    ).toBeVisible();

    const play = app.getByRole("button", { name: "播放", exact: true });
    const restart = app.getByRole("button", { name: "重新开始", exact: true });
    await play.focus();
    await page.keyboard.press("Tab");
    await expect(restart).toBeFocused();
    const focusStyle = await restart.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    expect(focusStyle.outlineStyle).not.toBe("none");
    expect(focusStyle.outlineWidth).not.toBe("0px");
    await expectCleanRuntime(page);
  });
}

test.describe("bilingual Canvas", () => {
  test.use({ locale: "en-US" });
  for (const device of ["desktop", "mobile"] as const) {
    test(`keeps playback, selection, and exact exports while switching language on ${device}`, async ({
      page,
    }) => {
      const app = await openApp(page, {
        profile: "portable",
        fixture: "synthetic",
        device,
      });
      const renderer = app.locator(".refrain-renderer");
      const originalTitle = await app.locator(".piece-title").textContent();
      await expect(renderer).toHaveAttribute("lang", "en");
      await expect(app.locator(".product-mark")).toHaveText(
        "Refrain hums an air.",
      );
      await openProductDetails(app);
      const selected = await selectVisibleMotif(app);
      const selector = app.getByRole("combobox", { name: "Choose a passage" });
      await selector.selectOption({ label: selected.optionLabel });
      const value = await selector.inputValue();
      await app
        .getByRole("button", { name: "Export Refrain artifact" })
        .click();
      await expect(app.getByRole("status")).toContainText(
        "File export accepted by this host.",
      );
      expect((await readHostEvidence(page)).audio).toEqual([]);
      await app.getByRole("button", { name: "Play", exact: true }).click();
      await expect(renderer).toHaveAttribute("data-player-state", "playing");
      const before = Number(await app.locator("input.seek").inputValue());
      await app.getByRole("button", { name: "Language", exact: true }).focus();
      await app
        .getByRole("button", { name: "Language", exact: true })
        .press("Enter");
      await expect(renderer).toHaveAttribute("lang", "zh-CN");
      await expect(
        app.getByRole("button", { name: "语言", exact: true }),
      ).toBeFocused();
      await expect(renderer).toHaveAttribute("data-player-state", "playing");
      await expect(
        app.getByRole("button", { name: "暂停", exact: true }),
      ).toBeEnabled();
      await expect(app.locator("details")).toHaveAttribute("open", "");
      await expect(app.getByRole("combobox", { name: "选择一段" })).toHaveValue(
        value,
      );
      await expect(
        app.locator('.selection-strip[data-visible="true"]'),
      ).toBeVisible();
      await expect(app.locator(".piece-title")).toHaveText(originalTitle!);
      await expect(app.getByRole("status")).toContainText(
        "当前宿主已接收文件导出。",
      );
      await expect
        .poll(async () => Number(await app.locator("input.seek").inputValue()))
        .toBeGreaterThan(before);
      await app.getByRole("button", { name: "暂停", exact: true }).click();
      await expect(renderer).toHaveAttribute("data-player-state", "paused");
      const paused = await app.locator("input.seek").inputValue();
      for (const theme of [
        "prism",
        "nocturne-ink",
        "herbarium",
        "paper-sonata",
      ]) {
        const appearance = app.getByRole("combobox", {
          name: "外观",
          exact: true,
        });
        await appearance.focus();
        await appearance.selectOption(theme);
        await expect(appearance).toHaveValue(theme);
        await expect(appearance).toBeFocused();
        await expect(app.locator("input.seek")).toHaveValue(paused);
        await expect(
          app.getByRole("combobox", { name: "选择一段" }),
        ).toHaveValue(value);
        await expect(app.locator("details")).toHaveAttribute("open", "");
        const size = await app.locator("html").evaluate((element) => ({
          client: element.clientWidth,
          scroll: element.scrollWidth,
        }));
        expect(size.scroll).toBeLessThanOrEqual(size.client);
      }
      await app.getByRole("button", { name: "导出 Refrain artifact" }).click();
      await expect
        .poll(
          async () => (await readHostEvidence(page)).portableDownloads.length,
        )
        .toBe(2);
      const evidence = await readHostEvidence(page);
      expect(
        evidence.audio.filter(({ type }) => type === "create"),
      ).toHaveLength(1);
      expect(evidence.audio.filter(({ state }) => state === "closed")).toEqual(
        [],
      );
      expect(evidence.portableDownloads.map(portableText)).toEqual([
        harness.cases.synthetic.expected.artifactText,
        harness.cases.synthetic.expected.artifactText,
      ]);
      await app.getByRole("button", { name: "语言", exact: true }).click();
      await expect(renderer).toHaveAttribute("lang", "en");
      await expect(renderer).toHaveAttribute("data-player-state", "paused");
      await expect(app.locator("input.seek")).toHaveValue(paused);
      await expect(
        app.getByRole("combobox", { name: "Choose a passage" }),
      ).toHaveValue(value);
      await expect(app.getByRole("status")).toContainText(
        "File export accepted by this host.",
      );
      await app.getByRole("button", { name: "Stop", exact: true }).click();
      await expectCleanRuntime(page);
    });
  }
});
