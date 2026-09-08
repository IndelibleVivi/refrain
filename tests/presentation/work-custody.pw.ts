import { mkdir, readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { makeWorkDocument } from "../lib/work-document.js";
import { stringifyRefrainArtifact } from "../../packages/renderer/src/portable.js";

let work: Awaited<ReturnType<typeof makeWorkDocument>>;
test.beforeAll(async () => {
  work = await makeWorkDocument();
});
test.afterAll(async () => {
  await work?.cleanup();
});
async function save(page: Page, name: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  return readFile((await (await pending).path())!, "utf8");
}
for (const width of [1280, 390]) {
  test(`complete production archive survives sound choice, save and reopen at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("./");
    const original = stringifyRefrainArtifact(work.document);
    await page.locator('input[type="file"]').setInputFiles({
      name: "work.refrain.json",
      mimeType: "application/json",
      buffer: Buffer.from(original),
    });
    const sound = page.getByRole("combobox", {
      name: "Sound for this listening view",
      exact: true,
    });
    await expect(sound).toHaveValue(work.document.defaultBindingId!);
    const renderer = page.locator(".refrain-renderer");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(renderer).toHaveAttribute("data-player-state", "playing");
    await sound.selectOption(work.originalBindingId);
    await expect(renderer).toHaveAttribute("data-player-state", "idle");
    await expect(sound).toHaveValue(work.originalBindingId);
    await page
      .getByRole("combobox", { name: "Appearance", exact: true })
      .selectOption("nocturne-ink");
    await page.getByRole("button", { name: "Language", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "当前试听声音", exact: true }),
    ).toHaveValue(work.originalBindingId);
    await mkdir("output/playwright/work-custody", { recursive: true });
    await page.screenshot({
      path: `output/playwright/work-custody/browser-${width}.png`,
      fullPage: true,
    });
    const saved = await save(page, "导出 Refrain artifact");
    expect(saved).toBe(original);
    expect(JSON.parse(saved).renderReceipts.length).toBeGreaterThan(0);
    expect(JSON.parse(saved).projections.length).toBeGreaterThan(0);
    await page.locator(".product-details summary").click();
    await page.locator(".exact-selection select").selectOption({ index: 1 });
    const handoff = JSON.parse(await save(page, "导出选段"));
    expect(handoff.parentArtifact).toEqual(work.document);
    await page.reload();
    await page.locator('input[type="file"]').setInputFiles({
      name: "saved.refrain.json",
      mimeType: "application/json",
      buffer: Buffer.from(saved),
    });
    await expect(
      page.getByRole("combobox", {
        name: "Sound for this listening view",
        exact: true,
      }),
    ).toHaveValue(work.document.defaultBindingId!);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(renderer).toHaveAttribute("data-player-state", "playing");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("valid unselected documents remain inspectable and never acquire a default during save", async ({
  page,
}) => {
  await page.goto("./");
  const ambiguous = structuredClone(work.document);
  delete ambiguous.defaultBindingId;
  await page.locator('input[type="file"]').setInputFiles({
    name: "choose.refrain.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(ambiguous)),
  });
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("combobox", {
      name: "Sound for this listening view",
      exact: true,
    })
    .selectOption(work.originalBindingId);
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  expect(JSON.parse(await save(page, "Export Refrain artifact"))).toEqual(
    ambiguous,
  );
  const unbound = {
    ...ambiguous,
    performanceBindings: [],
    renderReceipts: [],
    projections: [],
  };
  await page.locator('input[type="file"]').setInputFiles({
    name: "unbound.refrain.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(unbound)),
  });
  await expect(page.locator(".piece-title")).toHaveText(unbound.source.title);
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeDisabled();
  expect(JSON.parse(await save(page, "Export Refrain artifact"))).toEqual(
    unbound,
  );
});
