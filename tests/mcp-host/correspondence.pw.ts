import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, expect } from "@playwright/test";
import { prepareAudition } from "../../packages/correspondence/src/node.js";
import { makeWorkDocument } from "../lib/work-document.js";

// Test only a receiving browser's standard WAV player. It does not stand in
// for a third-party host, a model audio-input adapter, or listening acceptance.
let wav: Buffer;
let duration: number;
test.beforeAll(async () => {
  const work = await makeWorkDocument();
  const root = await mkdtemp(join(tmpdir(), "refrain-audition-browser-"));
  try {
    const packet = await prepareAudition(
      [
        {
          artifact: work.document,
          target: {
            startSeconds: 1,
            endSeconds: 4,
            contextSeconds: 0,
          },
        },
      ],
      join(root, "packet"),
    );
    wav = await readFile(join(root, "packet/a.wav"));
    duration = packet.entries[0]!.media.frames / 44_100;
  } finally {
    await work.cleanup();
    await rm(root, { recursive: true, force: true });
  }
});
for (const device of ["desktop", "mobile"]) {
  test(`received WAV plays after a gesture at ${device} width`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: device === "mobile" ? 390 : 1280,
      height: 800,
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    let fetches = 0;
    await page.route("http://refrain.test/a.wav", (route) => {
      fetches++;
      return route.fulfill({ contentType: "audio/wav", body: wav });
    });
    await page.route("http://refrain.test/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Refrain WAV reception proof</title>
      <h1>Received air</h1><audio controls preload="none" src="/a.wav"></audio>
      <p><button id="play">Play</button> <button id="pause">Pause</button></p>
      <script>
        const audio = document.querySelector('audio');
        document.querySelector('#play').onclick = () => audio.play();
        document.querySelector('#pause').onclick = () => audio.pause();
      </script>`,
      }),
    );
    await page.goto("http://refrain.test/");
    expect(fetches).toBe(0);
    expect(
      await page.locator("audio").evaluate((a: HTMLAudioElement) => a.paused),
    ).toBe(true);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect
      .poll(() =>
        page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
      )
      .toBeGreaterThan(0.1);
    expect(
      await page.locator("audio").evaluate((a: HTMLAudioElement) => a.duration),
    ).toBeCloseTo(duration, 3);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    expect(
      await page.locator("audio").evaluate((a: HTMLAudioElement) => a.paused),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await mkdir("output/playwright/correspondence", { recursive: true });
    await page.screenshot({
      path: `output/playwright/correspondence/${device}.png`,
    });
  });
}
