import { test, expect } from "@playwright/test";
import {
  startMcpHostHarness,
  mcpHostInitScript,
} from "../../scripts/lib/mcp-host-harness.mjs";
import { makeWorkDocument } from "../lib/work-document.js";
import { humV1 } from "../../packages/mcp-server/src/hum-v1.js";
import { stringifyRefrainArtifact } from "../../packages/renderer/src/portable.js";

let work: Awaited<ReturnType<typeof makeWorkDocument>>;
let harness: Awaited<ReturnType<typeof startMcpHostHarness>>;
test.use({ locale: "en-US" });
test.beforeAll(async () => {
  work = await makeWorkDocument();
  const musical = humV1({ air: work.document.source });
  if (!musical.ok) throw new Error("Fixture did not compile");
  // Declared synthetic host delivery: real export/production document + canonical summary.
  // This is not a claim that a named third-party host has been exercised.
  harness = await startMcpHostHarness({
    extraCases: {
      archive: {
        input: { air: work.document.source },
        result: {
          structuredContent: {
            ok: true,
            artifact: work.document,
            summary: musical.summary,
            diagnostics: musical.diagnostics,
            performanceStatus: { status: "available" },
          },
          content: [
            { type: "text", text: "Synthetic archive transport fixture" },
          ],
        },
      },
    },
  });
});
test.afterAll(async () => {
  await harness?.close();
  await work?.cleanup();
});
for (const device of ["desktop", "mobile"] as const) {
  test(`MCP ${device} retains complete Binding@1 archive and exact selection`, async ({
    context,
    page,
  }) => {
    await context.addInitScript(mcpHostInitScript);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      harness.url({ profile: "portable", device, fixture: "archive" }),
    );
    const app = page.frameLocator("#refrain-app");
    await expect(app.locator(".piece-title")).toHaveText(
      work.document.source.title,
    );
    const renderer = app.locator(".refrain-renderer");
    await app.getByRole("button", { name: "Play", exact: true }).click();
    await expect(renderer).toHaveAttribute("data-player-state", "playing");
    const sound = app.getByRole("combobox", {
      name: "Sound for this listening view",
      exact: true,
    });
    await sound.selectOption(work.originalBindingId);
    await expect(renderer).toHaveAttribute("data-player-state", "idle");
    await app
      .getByRole("button", { name: "Export Refrain artifact", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          JSON.parse((await page.locator("#evidence").textContent())!)
            .portableDownloads.length,
      )
      .toBe(1);
    let evidence = JSON.parse((await page.locator("#evidence").textContent())!);
    expect(evidence.portableDownloads[0].contents[0].resource.text).toBe(
      stringifyRefrainArtifact(work.document),
    );
    await app.locator(".product-details summary").click();
    await app.locator(".exact-selection select").selectOption({ index: 1 });
    await app
      .getByRole("button", { name: "Send to conversation", exact: true })
      .last()
      .click();
    await expect
      .poll(
        async () =>
          JSON.parse((await page.locator("#evidence").textContent())!)
            .selectionReturns.length,
      )
      .toBe(1);
    evidence = JSON.parse((await page.locator("#evidence").textContent())!);
    const selectionText = JSON.stringify(evidence.selectionReturns[0]);
    expect(selectionText).toContain(work.originalBindingId);
    expect(selectionText).toContain(work.document.defaultBindingId!);
    const findRequest = (value: unknown): string | undefined => {
      if (
        typeof value === "string" &&
        value.includes("Refrain selection handoff JSON:\n")
      )
        return value;
      if (value && typeof value === "object") {
        for (const child of Object.values(value)) {
          const found = findRequest(child);
          if (found) return found;
        }
      }
      return undefined;
    };
    const request = findRequest(evidence.selectionReturns[0]);
    expect(request).toBeDefined();
    const handoff = JSON.parse(
      request!.split("Refrain selection handoff JSON:\n")[1]!,
    );
    expect(handoff.parentArtifact).toEqual(work.document);
    expect(evidence.unhandledExceptions).toEqual([]);
    expect(errors).toEqual([]);
  });
}
