import { mkdir, readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { makeWorkDocument } from "../lib/work-document.js";
import { playerPlaylistBytesFromText } from "../../apps/presentation/src/player-playlist.js";

for (const width of [1280, 390]) {
  test(`a personal playlist keeps full works, order and listening choices at ${width}px`, async ({
    page,
  }) => {
    const work = await makeWorkDocument();
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("./");
      const input = page.locator('input[type="file"][accept^=".json"]');
      const original = {
        format: "refrain-playlist@0-experimental",
        title: "An evening together",
        entries: [
          {
            id: "one",
            artifact: work.document,
            presentation: {
              theme: "nocturne-ink",
              appearance: { symbolColor: "#becbd4" },
            },
          },
          {
            id: "two",
            artifact: work.document,
            presentation: { theme: "herbarium" },
          },
        ],
        currentEntryId: "one",
      };
      await input.setInputFiles({
        name: "evening.refrain-playlist.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(original)),
      });
      const renderer = page.locator(".refrain-renderer");
      await expect(renderer).toHaveAttribute("data-player-state", "idle");
      await expect(page.locator(".refrain-surface")).toHaveClass(
        /theme-nocturne/,
      );
      await page.getByRole("button", { name: "Next air", exact: true }).click();
      await expect(renderer).toHaveAttribute("data-player-state", "playing");
      await expect(page.locator(".refrain-surface")).toHaveClass(
        /theme-herbarium/,
      );
      await page
        .getByRole("button", { name: "Previous air", exact: true })
        .click();
      await expect(renderer).toHaveAttribute("data-player-state", "playing");
      await page
        .getByRole("combobox", {
          name: "Sound for this listening view",
          exact: true,
        })
        .selectOption(work.originalBindingId);
      await expect(renderer).toHaveAttribute("data-player-state", "idle");
      const toggle = page.locator('[aria-controls="player-playlist"]');
      if ((await toggle.getAttribute("aria-expanded")) === "false")
        await toggle.click();
      await page
        .getByRole("button", { name: /^Move down/ })
        .first()
        .click();
      await page
        .getByRole("textbox", { name: "Playlist title", exact: true })
        .fill("Keep this evening");
      const pending = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Save playlist", exact: true })
        .click();
      const saved = await readFile((await (await pending).path())!, "utf8");
      const parsed = JSON.parse(saved);
      expect(parsed.title).toBe("Keep this evening");
      expect(parsed.entries.map((entry: { id: string }) => entry.id)).toEqual([
        "two",
        "one",
      ]);
      expect(parsed.currentEntryId).toBe("one");
      expect(parsed.entries[1].bindingId).toBe(work.originalBindingId);
      expect(
        parsed.entries.every(
          (entry: { artifact: unknown }) =>
            JSON.stringify(entry.artifact) === JSON.stringify(work.document),
        ),
      ).toBe(true);
      expect(parsed.entries[1].presentation).toEqual(
        original.entries[0]!.presentation,
      );
      await page.reload();
      await input.setInputFiles({
        name: "saved.refrain-playlist.json",
        mimeType: "application/json",
        buffer: Buffer.from(saved),
      });
      await expect(
        page.getByRole("combobox", {
          name: "Sound for this listening view",
          exact: true,
        }),
      ).toHaveValue(work.originalBindingId);
      await expect(renderer).toHaveAttribute("data-player-state", "idle");
      if ((await toggle.getAttribute("aria-expanded")) === "false")
        await toggle.click();
      await page
        .getByRole("button", { name: /^Remove from playlist/ })
        .last()
        .click();
      await expect(page.locator(".refrain-surface")).toHaveClass(
        /theme-herbarium/,
      );
      await page.getByRole("button", { name: /^Remove from playlist/ }).click();
      await expect(renderer).toHaveCount(0);
      await expect(page.locator(".player-playlist li")).toHaveCount(0);
      await input.setInputFiles(
        ["one", "two"].map((name) => ({
          name: name + ".refrain.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(work.document)),
        })),
      );
      await expect(page.locator(".player-playlist li")).toHaveCount(2);
      await expect(renderer).toHaveAttribute("data-player-state", "idle");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await work.cleanup();
    }
  });
}

test("digest-bound same-origin playlist delivery opens the selected work and rejects crossed bytes", async ({
  page,
}) => {
  const work = await makeWorkDocument();
  try {
    const body = JSON.stringify({
      format: "refrain-playlist@0-experimental",
      title: "Delivered list",
      entries: [
        { id: "a", artifact: work.document },
        { id: "b", artifact: work.document, presentation: { theme: "prism" } },
      ],
      currentEntryId: "b",
    });
    const { sha256 } = playerPlaylistBytesFromText(body);
    await page.route("**/session/player-proof", (route) =>
      route.fulfill({
        contentType: "application/vnd.refrain-playlist+json",
        body,
      }),
    );
    const url = new URL("http://127.0.0.1:4326/refrain/");
    url.searchParams.set("playlistHref", "/session/player-proof");
    url.hash = new URLSearchParams({ playlist: sha256 }).toString();
    await page.goto(url.href);
    await expect(page.locator(".refrain-surface")).toHaveClass(/theme-prism/);
    await expect(page.locator(".refrain-renderer")).toHaveAttribute(
      "data-player-state",
      "idle",
    );
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.locator(".refrain-renderer")).toHaveAttribute(
      "data-player-state",
      "playing",
    );
    url.hash = new URLSearchParams({
      playlist: "sha256:" + "0".repeat(64),
    }).toString();
    await page.goto(url.href);
    await expect(page.locator(".refrain-renderer")).toHaveCount(0);
    await expect(
      page.getByText(
        "The delivered playlist bytes do not match their expected identity.",
      ),
    ).toBeVisible();
  } finally {
    await work.cleanup();
  }
});

test("photo material reaches all four composers without leaking into work presentation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("./");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // A deliberately high-contrast raster exercises the material layer; it is
  // test data, not a product asset or a claim of arbitrary-photo perfection.
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 500;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 800, 500);
    gradient.addColorStop(0, "#e48f61");
    gradient.addColorStop(0.5, "#ece4c7");
    gradient.addColorStop(1, "#28686c");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 800, 500);
    ctx.fillStyle = "#d3e0d9";
    ctx.beginPath();
    ctx.arc(600, 150, 80, 0, Math.PI * 2);
    ctx.fill();
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await mkdir("output/playwright/player", { recursive: true });
  for (const theme of ["paper-sonata", "prism", "nocturne-ink", "herbarium"]) {
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Appearance", exact: true })
      .selectOption(theme);
    await page.getByLabel("Background image", { exact: true }).setInputFiles({
      name: "qa-material.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    await page
      .getByRole("slider", { name: "Image opacity", exact: true })
      .fill("0.55");
    await page
      .getByRole("combobox", { name: "Image position", exact: true })
      .selectOption("top");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const surface = page.locator(".refrain-surface");
    await expect(surface).toHaveAttribute("data-custom-background", "true");
    expect(
      await page
        .locator(".figure-shell")
        .evaluate((node) => getComputedStyle(node, "::before").backgroundImage),
    ).toContain("blob:");
    if (theme === "paper-sonata")
      await expect(page.locator(".svg-paper-sheet > rect").first()).toHaveCSS(
        "fill-opacity",
        "0.28",
      );
    if (theme === "nocturne-ink" || theme === "herbarium")
      await expect(page.locator(".svg-background > rect").first()).toHaveCSS(
        "fill-opacity",
        "0.12",
      );
    await page.screenshot({
      path: "output/playwright/player/" + theme + "-photo.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page
      .getByRole("button", { name: "Work presentation", exact: true })
      .click();
    await expect(surface).not.toHaveAttribute("data-custom-background", "true");
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page
    .getByRole("button", { name: "My appearance", exact: true })
    .click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.screenshot({
    path: "output/playwright/player/mobile-photo.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Appearance", exact: true }),
  ).toBeFocused();
  expect(errors).toEqual([]);
});
