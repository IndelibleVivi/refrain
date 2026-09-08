import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { parseRefrainArtifact } from "../../packages/renderer/src/portable.js";
import { createRefrainArtifactV3 } from "../../packages/renderer/src/portable.js";
import { createRootReceiptV1 } from "../../packages/renderer/src/v1.js";
import { compileAirV1 } from "../../packages/compiler/src/v1.js";
import { F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING } from "../../packages/soundpack/src/index.js";

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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Listen first. Bring your story next.",
    );
    await expect(page.locator(".piece-title")).toHaveText(
      "Velvet Mischief · 夜色偏心",
    );
    await expect(renderer).toHaveAttribute("data-player-state", "idle");
    await page
      .getByRole("button", { name: "After the Door · 门后", exact: true })
      .click();
    await expect(page.locator(".piece-title")).toHaveText(
      "After the Door · 门后",
    );
    await page
      .getByRole("button", { name: "Velvet Mischief · 夜色偏心", exact: true })
      .click();
    expect(
      requests.filter((url) => /soundpacks|\.wav|\.sf2/i.test(url)),
    ).toEqual([]);
    const playBounds = await page
      .getByRole("button", { name: "Play", exact: true })
      .boundingBox();
    expect(playBounds!.y + playBounds!.height).toBeLessThan(720);
    expect(
      await page.evaluate(() => (window as any).__testContexts.length),
    ).toBe(0);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(renderer).toHaveAttribute("data-player-state", "playing");
    await expect
      .poll(async () => Number(await page.locator("input.seek").inputValue()))
      .toBeGreaterThan(0);
    await page
      .getByRole("combobox", { name: "Appearance", exact: true })
      .selectOption("prism");
    await expect(renderer).toHaveAttribute("data-player-state", "playing");
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const paused = await page.locator("input.seek").inputValue();
    await page.locator(".product-details summary").click();
    const passage = page.getByRole("combobox", { name: "Choose a passage" });
    await passage.selectOption({ index: 1 });
    const selection = await passage.inputValue();
    for (const theme of [
      "nocturne-ink",
      "herbarium",
      "paper-sonata",
      "prism",
    ]) {
      const control = page.getByRole("combobox", {
        name: "Appearance",
        exact: true,
      });
      await control.focus();
      await control.selectOption(theme);
      await expect(control).toHaveValue(theme);
      await expect(control).toBeFocused();
      await expect(page.locator("input.seek")).toHaveValue(paused);
      await expect(renderer).toHaveAttribute("data-player-state", "paused");
      await expect(passage).toHaveValue(selection);
      await expect(page.locator(".product-details")).toHaveAttribute(
        "open",
        "",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.getByRole("button", { name: "Language", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "先听一首，再带上你们的故事。",
    );
    await expect(
      page.getByRole("combobox", { name: "外观", exact: true }),
    ).toHaveValue("prism");
    await expect(page.locator("input.seek")).toHaveValue(paused);
    expect(
      await page.evaluate(() =>
        (window as any).__testContexts.map(
          (context: AudioContext) => context.state,
        ),
      ),
    ).toEqual(["running"]);

    // The save action is available even with the technical details closed.
    await page.locator(".product-details summary").click();
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
    await page.locator('input[type="file"]').setInputFiles({
      name: "saved.refrain.json",
      mimeType: "application/json",
      buffer: Buffer.from(text),
    });
    await expect(page.locator(".piece-title")).toHaveText(source.title);
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await expect(renderer).toHaveAttribute("data-player-state", "playing");
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator(".piece-title")).toHaveText(source.title);
    await page.getByRole("button", { name: "回到这首示例" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "接入 agent · 设置指南 ↗" }),
    ).toHaveAttribute("href", /\/docs\/MCP.md$/);
    await page.locator(".first-listen-prompt summary").click();
    await expect(page.locator(".first-listen-prompt blockquote")).toContainText(
      "私人对话留在 host",
    );
    expect(errors).toEqual([]);
    expect(
      requests.every((url) => url.startsWith("http://127.0.0.1:4326/refrain/")),
    ).toBe(true);
    expect(
      requests.filter((url) => /soundpacks.*\.wav/i.test(url)).length,
    ).toBeGreaterThan(0);
  });
}

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

test("a saved sampled work keeps its binding and offers export without fetching sound", async ({
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
  await page.locator('input[type="file"]').setInputFiles({
    name: "sampled.refrain.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(portable)),
  });
  await expect(page.locator(".piece-title")).toHaveText(source.title!);
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("status").filter({ hasText: "exact sound is unavailable" }),
  ).toContainText("sound samples required by this air are unavailable");
  await expect(page.getByText("Ready to play", { exact: true })).toHaveCount(0);
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
  await page
    .getByRole("button", { name: "After the Door · 门后", exact: true })
    .click();
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
