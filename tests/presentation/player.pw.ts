import { mkdir, readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { makeWorkDocument } from "../lib/work-document.js";
import { playerPlaylistBytesFromText } from "../../apps/presentation/src/player-playlist.js";

type JsonFile = { name: string; mimeType: string; buffer: Buffer };

const playlistToggle = (page: Page) =>
  page.locator('[aria-controls="player-playlist"]');
const playlistDialog = (page: Page) => page.locator("dialog#player-playlist");
const performanceDetails = (page: Page) =>
  page.locator("details.refrain-renderer__performance");

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

// The file input now lives inside the native playlist dialog, so a real import
// opens the sheet first and closes it again to listen.
async function importJson(page: Page, files: JsonFile | JsonFile[]) {
  await openPlaylist(page);
  await playlistDialog(page)
    .locator('input[type="file"][accept^=".json"]')
    .setInputFiles(files);
  await closePlaylist(page);
}

// The carried-sound chooser moved into a collapsed details element, so the
// listener opens it before choosing. Returns the visible combobox.
async function openSoundChooser(page: Page) {
  const details = performanceDetails(page);
  await expect(details).toHaveCount(1);
  if ((await details.getAttribute("open")) === null)
    await details.locator("summary").first().click();
  await expect(details).toHaveAttribute("open", "");
  return page.getByRole("combobox", {
    name: "Sound for this listening view",
    exact: true,
  });
}

for (const width of [1280, 390]) {
  test(`a personal playlist keeps full works, order and listening choices at ${width}px`, async ({
    page,
  }) => {
    const work = await makeWorkDocument();
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("./");
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
      await importJson(page, {
        name: "evening.refrain-playlist.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(original)),
      });
      const renderer = page.locator(".refrain-renderer");
      await expect(renderer).toHaveAttribute("data-player-state", "idle");
      await expect(page.locator(".refrain-surface")).toHaveClass(
        /theme-nocturne/,
      );
      // Queue previous / next now share the one visible transport.
      await expect(page.locator(".page-transport")).toHaveCount(1);
      await page
        .locator(".page-transport")
        .getByRole("button", { name: "Next air", exact: true })
        .click();
      await expect(renderer).toHaveAttribute("data-player-state", "playing");
      await expect(page.locator(".refrain-surface")).toHaveClass(
        /theme-herbarium/,
      );
      await page
        .locator(".page-transport")
        .getByRole("button", { name: "Previous air", exact: true })
        .click();
      await expect(renderer).toHaveAttribute("data-player-state", "playing");
      // The listening-view sound chooser is closed until the listener opens it.
      const sound = await openSoundChooser(page);
      await sound.selectOption(work.originalBindingId);
      await expect(renderer).toHaveAttribute("data-player-state", "idle");
      // Editing requires reopening the dialog.
      await openPlaylist(page);
      await page
        .getByRole("button", { name: /^Move down/ })
        .first()
        .click();
      await page
        .getByRole("textbox", { name: "Playlist title", exact: true })
        .fill("Keep this evening");
      const pending = page.waitForEvent("download");
      await page.getByRole("button", { name: /^Save playlist/ }).click();
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
      await importJson(page, {
        name: "saved.refrain-playlist.json",
        mimeType: "application/json",
        buffer: Buffer.from(saved),
      });
      await expect(await openSoundChooser(page)).toHaveValue(
        work.originalBindingId,
      );
      await expect(renderer).toHaveAttribute("data-player-state", "idle");
      await openPlaylist(page);
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
      await importJson(
        page,
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

test("the listening room keeps one transport and a native playlist dialog", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("./");
  const toggle = playlistToggle(page);
  const dialog = playlistDialog(page);
  // The playlist is a native dialog, not the old always-visible sidebar.
  await expect(page.locator("aside.player-playlist")).toHaveCount(0);
  await expect(page.locator(".player-layout")).toHaveCount(0);
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // One shared transport carries previous / play / next / mode.
  const transport = page.locator(".page-transport");
  await expect(transport).toHaveCount(1);
  await expect(
    transport.getByRole("button", { name: "Previous air", exact: true }),
  ).toBeVisible();
  await expect(
    transport.getByRole("button", { name: "Next air", exact: true }),
  ).toBeVisible();
  await expect(transport.locator("[data-playback-mode]")).toHaveCount(1);
  await expect(page.locator("[data-playback-mode]")).toHaveCount(1);
  // Technical details are one collapsed section that now owns the former
  // passage / motif panels and the exact selection.
  const details = page.locator("details.product-details");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(details.locator("summary").first()).toHaveText(
    /Inside this air/,
  );
  await expect(page.locator(".refrain-surface > .page-lower")).toHaveCount(0);
  await expect(page.locator("details.product-details .page-lower")).toHaveCount(
    1,
  );
  await expect(page.locator(".passage-panel")).toBeHidden();
  await details.locator("summary").first().click();
  await expect(details).toHaveAttribute("open", "");
  await expect(page.locator(".passage-panel")).toBeVisible();
  // Opening, choosing and closing is a real native dialog round trip.
  await toggle.click();
  await expect(dialog).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await dialog
    .getByRole("button", { name: "After the Door · 门后", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".piece-title")).toHaveText(
    "After the Door · 门后",
  );
  // Closing the playlist never shrinks or covers the music visualization.
  const figure = page.locator(".figure-shell");
  await expect(figure).toBeVisible();
  const score = await figure.boundingBox();
  expect(score!.width).toBeGreaterThan(1280 * 0.5);
  expect(
    await figure.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return Boolean(hit && node.contains(hit));
    }),
  ).toBe(true);
});

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
