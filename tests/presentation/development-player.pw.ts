import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createServer } from "vite";

test("development StrictMode replays queue startup after mount cleanup", async ({
  page,
}) => {
  // The static preview cannot exercise React's development effect replay.
  // Reuse the actual Player entry and Vite config on an ephemeral loopback port.
  const server = await createServer({
    root: fileURLToPath(new URL("../../apps/presentation", import.meta.url)),
    cacheDir: fileURLToPath(
      new URL("../../node_modules/.vite-player-strictmode", import.meta.url),
    ),
    mode: "try",
    server: { host: "127.0.0.1", port: 0, open: false },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string")
      throw new Error("The development Player has no TCP listening address.");
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const renderer = page.locator(".refrain-renderer");
    await expect(renderer).toHaveAttribute("data-player-state", "idle");
    await page.getByRole("button", { name: "Next air", exact: true }).click();
    await expect(page.locator(".piece-title")).toHaveText(
      "After the Door · 门后",
    );
    await expect(renderer).toHaveAttribute("data-player-state", "playing");
    await page
      .getByRole("button", { name: "Previous air", exact: true })
      .click();
    await expect(page.locator(".piece-title")).toHaveText(
      "Velvet Mischief · 夜色偏心",
    );
    await expect(renderer).toHaveAttribute("data-player-state", "playing");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(renderer).toHaveAttribute("data-player-state", "ready");
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});
