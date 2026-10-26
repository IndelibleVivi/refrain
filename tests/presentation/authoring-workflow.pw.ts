import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { test, expect, type Page } from "@playwright/test";
import { draftAir } from "../../apps/presentation/src/authoring.js";

const execute = promisify(execFile);
const cli = resolve("bin/refrain.mjs");
async function run(cwd: string, ...args: string[]) {
  const { stdout } = await execute(process.execPath, [cli, ...args, "--json"], {
    cwd,
  });
  return JSON.parse(stdout);
}
async function importFile(page: Page, name: string, value: unknown) {
  await page.locator('[aria-controls="player-playlist"]').click();
  await page.locator('#player-playlist input[type="file"]').setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await page.keyboard.press("Escape");
}
async function download(page: Page, label: string | RegExp) {
  const pending = page.waitForEvent("download", { timeout: 10_000 });
  await page
    .getByRole("button", { name: label, exact: typeof label === "string" })
    .click({ timeout: 10_000 });
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"));
}

for (const width of [1280, 390]) {
  test(`author, select, inspect feedback, revise and keep both in the same Player at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const root = await mkdtemp(join(tmpdir(), "refrain-authoring-roundtrip-"));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      // The host writes the notes. Neither the CLI nor the Player composes them.
      const source = draftAir({
        title: "A returned phrase",
        instruments: ["lattice_pluck"],
        tempo: 120,
        meter: "4/4",
        bars: 2,
      });
      source.motifs = { return: "E4/8 G4/8 B4/4 A4/4 G4/4" };
      source.voices[0]!.realize = [
        { id: "call", kind: "motif", motif: "return", repeat: 2 },
      ];
      await writeFile(join(root, "original.air.json"), JSON.stringify(source));
      await run(
        root,
        "hum",
        "original.air.json",
        "--out",
        "original.refrain.json",
      );
      const original = JSON.parse(
        await readFile(join(root, "original.refrain.json"), "utf8"),
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto("./");
      await importFile(page, "versions.refrain-playlist.json", {
        format: "refrain-playlist@0-experimental",
        title: "A phrase, then its reply",
        entries: [{ id: "original", artifact: original }],
        currentEntryId: "original",
      });
      const renderer = page.locator(".refrain-renderer");
      await expect(renderer).toHaveAttribute("data-player-state", "idle");
      await expect(page.locator(".page-transport")).toHaveCount(1);
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await expect(renderer).toHaveAttribute("data-player-state", "playing");
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await expect(renderer).toHaveAttribute("data-player-state", "paused");
      await page.locator("details.product-details summary").first().click();
      await page.locator(".exact-selection select").selectOption({ index: 1 });
      const handoff = await download(page, "Export selection");
      expect(handoff.parentArtifact).toEqual(original);
      expect(handoff.selection.sourceRevision).toBe(
        original.receipt.sourceRevision,
      );
      await writeFile(
        join(root, "selection.json"),
        JSON.stringify(handoff.selection),
      );
      await writeFile(
        join(root, "parent.refrain.json"),
        JSON.stringify(handoff.parentArtifact),
      );
      await run(
        root,
        "audition",
        "parent.refrain.json",
        "--selection",
        "selection.json",
        "--context",
        "0",
        "--out",
        "audition",
      );
      await run(
        root,
        "respond",
        "audition",
        "--observer",
        "Workflow test",
        "--basis",
        "score-reading",
        "--message",
        "Keep the phrase; lower the written voice level.",
        "--out",
        "response.json",
      );
      const feedback = await run(
        root,
        "respond",
        "inspect",
        "response.json",
        "--audition",
        "audition",
      );
      expect(feedback.sourceRevision).toBe(original.receipt.sourceRevision);
      expect(feedback.basis).toEqual(["score-reading"]);
      expect(feedback.access).toBe("observer-declared");
      const revisedSource = structuredClone(handoff.parentArtifact.source);
      revisedSource.title = "A returned phrase · softer";
      revisedSource.voices[0].gainDb =
        (revisedSource.voices[0].gainDb ?? 0) - 2;
      await writeFile(
        join(root, "revised.air.json"),
        JSON.stringify(revisedSource),
      );
      const revision = await run(
        root,
        "hum",
        "revised.air.json",
        "--parent",
        feedback.parentArtifact,
        "--relation",
        "revise",
        "--out",
        "revised.refrain.json",
      );
      expect(revision.relation).toBe("revise");
      const revised = JSON.parse(
        await readFile(join(root, "revised.refrain.json"), "utf8"),
      );
      expect(revised.defaultBindingId).toBe(original.defaultBindingId);
      await importFile(page, "revised.refrain.json", revised);
      await expect(renderer).toHaveAttribute("data-player-state", "idle");
      await expect(
        page.getByRole("heading", { name: revised.source.title, exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await expect(renderer).toHaveAttribute("data-player-state", "playing");
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await page.locator('[aria-controls="player-playlist"]').click();
      const saved = await download(page, /^Save playlist/);
      expect(
        saved.entries.map((entry: { artifact: unknown }) => entry.artifact),
      ).toEqual([original, revised]);
      await page.keyboard.press("Escape");
      await page.reload();
      await importFile(page, "saved.refrain-playlist.json", saved);
      await expect(renderer).toHaveAttribute("data-player-state", "idle");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
