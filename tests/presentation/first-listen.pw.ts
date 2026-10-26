import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { parseRefrainArtifact } from "../../packages/renderer/src/portable.js";
import { createRefrainArtifactV3 } from "../../packages/renderer/src/portable.js";
import { createRootReceiptV1 } from "../../packages/renderer/src/v1.js";
import { compileAirV1 } from "../../packages/compiler/src/v1.js";
import {
  F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING,
  F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
} from "../../packages/soundpack/src/index.js";

type JsonFile = { name: string; mimeType: string; buffer: Buffer };

const playlistToggle = (page: Page) =>
  page.locator('[aria-controls="player-playlist"]');
const playlistDialog = (page: Page) => page.locator("dialog#player-playlist");

async function openPlaylist(page: Page) {
  const toggle = playlistToggle(page);
  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
    await expect(playlistDialog(page)).toBeVisible();
  }
}

async function closePlaylist(page: Page) {
  if (await playlistDialog(page).isVisible())
    await page.keyboard.press("Escape");
  await expect(playlistDialog(page)).toBeHidden();
}

// The listening room owns the file input inside the native playlist dialog, so
// a real import opens the sheet first and closes it again to listen.
async function importJson(page: Page, files: JsonFile | JsonFile[]) {
  await openPlaylist(page);
  await playlistDialog(page)
    .locator('input[type="file"][accept^=".json"]')
    .setInputFiles(files);
  await closePlaylist(page);
}

async function selectTheme(page: Page, theme: string) {
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const control = page.getByRole("combobox", {
    name: "Appearance",
    exact: true,
  });
  await control.focus();
  await control.selectOption(theme);
  await expect(control).toBeFocused();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Appearance", exact: true }),
  ).toBeFocused();
}

// The approved listening-room hierarchy is hero above the score above the one
// shared transport, with real musical marks rather than a decorative sliver.
// These are functional bounds, not aesthetic pixel targets.
async function expectListeningHierarchy(page: Page) {
  const order = await page.evaluate(() => {
    const hero = document.querySelector(".page-hero");
    const figure = document.querySelector(".figure-shell");
    const transport = document.querySelector(".page-transport");
    if (!hero || !figure || !transport) return undefined;
    return {
      heroBeforeFigure: Boolean(
        hero.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      figureBeforeTransport: Boolean(
        figure.compareDocumentPosition(transport) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    };
  });
  expect(order).toEqual({
    heroBeforeFigure: true,
    figureBeforeTransport: true,
  });
  const viewport = page.viewportSize()!;
  const figure = page.locator(".figure-shell");
  await expect(figure).toBeVisible();
  const metrics = await figure.locator("svg.air-figure").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      marks: node.querySelectorAll(
        "path, rect, circle, line, polyline, polygon, text",
      ).length,
    };
  });
  expect(metrics.width).toBeGreaterThan(viewport.width * 0.5);
  expect(metrics.height).toBeGreaterThan(60);
  expect(metrics.marks).toBeGreaterThan(10);
}

for (const width of [1280, 390]) {
  test(`first listen, themes, language, and a saved return at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const requests: string[] = [];
    const errors: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const contexts: AudioContext[] = [];
      Object.assign(window, { __testContexts: contexts });
      const Native = window.AudioContext;
      window.AudioContext = class extends Native {
        constructor(options?: AudioContextOptions) {
          super(options);
          contexts.push(this);
        }
      };
    });
    await page.goto("./");
    const renderer = page.locator(".refrain-renderer");
    await expect(page.locator(".refrain-wordmark")).toContainText("Refrain");
    await expect(page.locator(".piece-title")).toHaveText(
      "Velvet Mischief · 夜色偏心",
    );
    await expect(renderer).toHaveAttribute("data-player-state", "idle");
    // One listening room: one transport, collapsed technical details, and the
    // playlist as a closed native dialog instead of an always-visible sidebar.
    await expectListeningHierarchy(page);
    await expect(page.locator("aside.player-playlist")).toHaveCount(0);
    await expect(playlistDialog(page)).toBeHidden();
    const details = page.locator("details.product-details");
    await expect(details).not.toHaveAttribute("open", "");
    await expect(details.locator("summary").first()).toHaveText(
      /Inside this air/,
    );
    await expect(page.locator(".refrain-surface > .page-lower")).toHaveCount(0);
    await expect(page.locator(".passage-panel")).toBeHidden();
    await expect(page.locator(".exact-selection")).toBeHidden();
    // Hero, score, and transport all stay inside the first 900px viewport.
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeInViewport({ ratio: 0.9 });
    await openPlaylist(page);
    await playlistDialog(page)
      .getByRole("button", { name: "After the Door · 门后", exact: true })
      .click();
    await expect(playlistDialog(page)).toBeHidden();
    await expect(page.locator(".piece-title")).toHaveText(
      "After the Door · 门后",
    );
    await openPlaylist(page);
    await playlistDialog(page)
      .getByRole("button", { name: "Velvet Mischief · 夜色偏心", exact: true })
      .click();
    await expect(playlistDialog(page)).toBeHidden();
    expect(
      requests.filter((url) => /soundpacks|\.wav|\.sf2/i.test(url)),
    ).toEqual([]);
    expect(
      await page.evaluate(() => (window as any).__testContexts.length),
    ).toBe(0);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(renderer).toHaveAttribute("data-player-state", "playing");
    await expect
      .poll(async () => Number(await page.locator("input.seek").inputValue()))
      .toBeGreaterThan(0);
    await selectTheme(page, "prism");
    await expect(renderer).toHaveAttribute("data-player-state", "playing");
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const paused = await page.locator("input.seek").inputValue();
    await details.locator("summary").first().click();
    await expect(details).toHaveAttribute("open", "");
    await expect(page.locator(".passage-panel")).toBeVisible();
    const passage = page.getByRole("combobox", { name: "Choose a passage" });
    await passage.selectOption({ index: 1 });
    const selection = await passage.inputValue();
    for (const theme of [
      "nocturne-ink",
      "herbarium",
      "paper-sonata",
      "prism",
    ]) {
      await selectTheme(page, theme);
      await expect(page.locator("input.seek")).toHaveValue(paused);
      await expect(renderer).toHaveAttribute("data-player-state", "paused");
      await expect(passage).toHaveValue(selection);
      await expect(details).toHaveAttribute("open", "");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    // Language stays local presentation; the About Refrain guidance lives in
    // its own native dialog and returns focus on Escape.
    await page.getByRole("button", { name: "Language", exact: true }).click();
    await expect(page.locator(".refrain-language")).toHaveAttribute(
      "aria-label",
      "语言",
    );
    await page.getByRole("button", { name: /关于 Refrain/ }).click();
    const help = page.locator("dialog.player-help");
    await expect(help).toBeVisible();
    await expect(help).toContainText("从这两首开始听");
    await expect(page.locator(".refrain-appearance-theme select")).toHaveValue(
      "prism",
    );
    await expect(page.locator("input.seek")).toHaveValue(paused);
    expect(
      await page.evaluate(() =>
        (window as any).__testContexts.map(
          (context: AudioContext) => context.state,
        ),
      ),
    ).toEqual(["running"]);
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
    await expect(
      page.getByRole("button", { name: /关于 Refrain/ }),
    ).toBeFocused();

    // The save action is available even with the technical details closed.
    await details.locator("summary").first().click();
    await expect(details).not.toHaveAttribute("open", "");
    const downloading = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "导出 Refrain artifact", exact: true })
      .click();
    const download = await downloading;
    const text = await readFile((await download.path())!, "utf8");
    const portable = JSON.parse(text);
    expect(parseRefrainArtifact(portable).ok).toBe(true);
    const source = JSON.parse(
      await readFile("examples/demo/velvet-mischief.refrain.json", "utf8"),
    ).source;
    expect(portable.source).toEqual(source);
    expect(portable.defaultBindingId).toBe("velvet-mischief-native@0");
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await importJson(page, {
      name: "saved.refrain.json",
      mimeType: "application/json",
      buffer: Buffer.from(text),
    });
    await expect(page.locator(".piece-title")).toHaveText(source.title);
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await expect(renderer).toHaveAttribute("data-player-state", "playing");
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await importJson(page, {
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator(".piece-title")).toHaveText(source.title);
    await page.getByRole("button", { name: /关于 Refrain/ }).click();
    await expect(help).toBeVisible();
    await expect(
      page.getByRole("link", { name: "接入 agent · 设置指南 ↗" }),
    ).toHaveAttribute("href", /\/docs\/GETTING-STARTED.md$/);
    await help.locator("details summary").click();
    await expect(help.locator("details blockquote")).toContainText(
      "私人对话留在 host",
    );
    await help.getByRole("button", { name: "打开示例列表" }).click();
    await expect(help).toBeHidden();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(
      requests.every((url) => url.startsWith("http://127.0.0.1:4326/refrain/")),
    ).toBe(true);
    expect(
      requests.filter((url) => /soundpacks.*\.wav/i.test(url)).length,
    ).toBeGreaterThan(0);
  });
}

test("playlist mode persists and a real transport end advances the queue", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("./");
  // Queue mode now lives in the one shared transport, not the playlist dialog.
  const mode = page.locator(".page-transport [data-playback-mode]");
  await expect(mode).toHaveCount(1);
  await expect(mode).toHaveAttribute("data-playback-mode", "sequential");
  await expect(playlistDialog(page)).toBeHidden();
  await mode.click();
  await expect(mode).toHaveAttribute("data-playback-mode", "repeat-all");
  await page.reload();
  await expect(mode).toHaveAttribute("data-playback-mode", "repeat-all");
  await mode.click();
  await mode.click();
  await mode.click();
  await expect(mode).toHaveAttribute("data-playback-mode", "sequential");

  await page.getByRole("button", { name: "Play", exact: true }).click();
  const renderer = page.locator(".refrain-renderer");
  await expect(renderer).toHaveAttribute("data-player-state", "playing");
  await page.locator("input.seek").evaluate((element: HTMLInputElement) => {
    element.value = element.max;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator(".piece-title")).toHaveText(
    "After the Door · 门后",
  );
  await expect(renderer).toHaveAttribute("data-player-state", "playing");
  // At the last entry in sequential mode the transport offers no manual next.
  // The natural-end stop at that entry is covered by the short-tail test below,
  // because the demo works' 8-12s release tails outlast a default assertion.
  const next = page
    .locator(".page-transport")
    .getByRole("button", { name: "Next air", exact: true });
  await expect(next).toBeDisabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("a real natural end stops at the last sequential entry instead of wrapping", async ({
  page,
}) => {
  const source = compileAirV1(
    await readFile("fixtures/air-v1/synthetic-counterpulse.air.json", "utf8"),
  ).source!;
  const portable = createRefrainArtifactV3({
    source,
    receipt: createRootReceiptV1(source),
    performanceBinding: F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("./");
  // This work carries synth voices only, so its rendered end sits under a
  // second past its musical end: a real natural end arrives promptly instead of
  // playing out the demo works' multi-second release tails. Importing one work
  // appends it after the two demo works, so it becomes the last sequential
  // entry with no manual next.
  await importJson(page, {
    name: "short-tail.refrain.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(portable)),
  });
  const renderer = page.locator(".refrain-renderer");
  const next = page
    .locator(".page-transport")
    .getByRole("button", { name: "Next air", exact: true });
  await expect(page.locator(".piece-title")).toHaveText(source.title!);
  await expect(next).toBeDisabled();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(renderer).toHaveAttribute("data-player-state", "playing");
  await page.locator("input.seek").evaluate((element: HTMLInputElement) => {
    element.value = element.max;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // The queue stops at the last entry rather than wrapping: the work stays put
  // and playback ends.
  await expect(renderer).toHaveAttribute("data-player-state", "ready");
  await expect(next).toBeDisabled();
  await expect(page.locator(".piece-title")).toHaveText(source.title!);
});

test("appearance stays local while exact colors travel in an easy-share link", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:4326",
  });
  await page.goto("./");
  await selectTheme(page, "prism");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const renderer = page.locator(".refrain-renderer");
  await expect(renderer).toHaveAttribute("data-player-state", "playing");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByText("Fine-tune colors", { exact: true }).click();

  await page.locator('[data-appearance-control="symbol"]').fill("#a13b7c");
  await page.locator('[data-appearance-control="text"]').fill("#102030");
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await page.getByLabel("Background image").setInputFiles({
    name: "local-background.png",
    mimeType: "image/png",
    buffer: image,
  });
  const surface = page.locator(".refrain-surface");
  await expect(surface).toHaveAttribute("data-custom-background", "true");
  await expect(renderer).toHaveAttribute("data-player-state", "playing");
  await expect
    .poll(async () => Number(await page.locator("input.seek").inputValue()))
    .toBeGreaterThan(0);
  await expect(surface).toHaveCSS("color", "rgb(16, 32, 48)");
  expect(
    await surface.evaluate((element) =>
      element.style.getPropertyValue("--accent"),
    ),
  ).toBe("#a13b7c");

  await page.reload();
  await expect(surface).not.toHaveAttribute("data-custom-background", "true");
  await expect(surface).toHaveAttribute(
    "data-composer",
    "paper-folio-composer@0",
  );
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByText("Fine-tune colors", { exact: true }).click();
  await page
    .getByRole("button", { name: "My appearance", exact: true })
    .click();
  await expect(surface).toHaveAttribute("data-custom-background", "true");
  await expect(page.locator('[data-appearance-control="symbol"]')).toHaveValue(
    "#a13b7c",
  );
  await expect(page.locator('[data-appearance-control="text"]')).toHaveValue(
    "#102030",
  );

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByText("Share this air", { exact: true }).click();
  await expect(
    page.getByText("Your background image stays on this device."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Listening link copied." }),
  ).toBeVisible();
  const shared = new URL(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
  expect(shared.origin).toBe("https://indeliblevivi.github.io");
  expect(shared.pathname).toBe("/refrain/");
  expect(shared.searchParams.get("catalog")).toBe("velvet-mischief");
  expect(shared.searchParams.get("binding")).toBe("velvet-mischief-native@0");
  expect(shared.searchParams.get("theme")).toBe("prism");
  expect(shared.searchParams.get("appearanceSymbol")).toBe("#a13b7c");
  expect(shared.searchParams.get("appearanceText")).toBe("#102030");
  expect(shared.href).not.toContain("background");
  expect(shared.href).not.toContain("blob:");
  expect(shared.hash).toBe("");

  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page
    .getByRole("button", { name: "Reset this appearance", exact: true })
    .click();
  await expect(surface).not.toHaveAttribute("data-custom-background", "true");
  await expect(page.locator('[data-appearance-control="symbol"]')).toHaveValue(
    "#4965ff",
  );
  await page.evaluate(() => localStorage.clear());
  const receiver = new URL("./", page.url());
  receiver.search = shared.search;
  await page.goto(receiver.href);
  await expect(page.locator(".piece-title")).toHaveText(
    "Velvet Mischief · 夜色偏心",
  );
  await expect(page.locator(".refrain-surface")).not.toHaveAttribute(
    "data-custom-background",
    "true",
  );
  expect(
    await page
      .locator(".refrain-surface")
      .evaluate((element) => element.style.getPropertyValue("--accent")),
  ).toBe("#a13b7c");

  receiver.searchParams.set("artifact", `sha256:${"0".repeat(64)}`);
  await page.goto(receiver.href);
  await expect(page.locator(".refrain-renderer")).toHaveCount(0);
  await expect(
    page.getByText("The published demo identity does not match this link."),
  ).toBeVisible();
});

test("a broken supplied link stays an error instead of turning into the example", async ({
  page,
}) => {
  await page.goto("./#artifact=sha256%3Abroken&bytes=broken");
  await expect(page.locator(".presentation-message")).toBeVisible();
  await expect(page.locator(".refrain-renderer")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Listen first. Bring your story next." }),
  ).toHaveCount(0);
});

test("a saved sampled work reuses an exact published closure without fetching before Play", async ({
  page,
}) => {
  const source = compileAirV1(
    await readFile("fixtures/air-v1/paper-waltz.air.json", "utf8"),
  ).source!;
  const portable = createRefrainArtifactV3({
    source,
    receipt: createRootReceiptV1(source),
    performanceBinding: F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING,
  });
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("./");
  await importJson(page, {
    name: "sampled.refrain.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(portable)),
  });
  await expect(page.locator(".piece-title")).toHaveText(source.title!);
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("status").filter({ hasText: "exact sound is unavailable" }),
  ).toHaveCount(0);
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Refrain artifact", exact: true })
    .click();
  const download = await downloading;
  const saved = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(saved.source).toEqual(source);
  expect(saved.performanceBindings).toEqual(portable.performanceBindings);
  expect(saved.defaultBindingId).toBe(portable.defaultBindingId);
  expect(
    requests.filter((url) => /soundpacks|\.sf2|\.wav|spessasynth/i.test(url)),
  ).toEqual([]);
});

test("After the Door plays with its original sampled binding", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await openPlaylist(page);
  await playlistDialog(page)
    .getByRole("button", { name: "After the Door · 门后", exact: true })
    .click();
  await expect(playlistDialog(page)).toBeHidden();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".refrain-renderer")).toHaveAttribute(
    "data-player-state",
    "playing",
  );
  await expect
    .poll(async () => Number(await page.locator("input.seek").inputValue()))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator("input.seek")).toHaveValue("0");
  expect(errors).toEqual([]);
});
