import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { parseRefrainArtifact } from "@refrain/renderer/portable";

const binary = resolve("bin/refrain.mjs");
interface Preview {
  child: ChildProcess;
  report: { url: string; delivery: string };
}
async function open(cwd: string): Promise<Preview> {
  const child = spawn(
    process.execPath,
    [binary, "open", "work.json", "--no-open", "--json"],
    {
      cwd,
      env: { ...process.env, TMPDIR: cwd },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return new Promise((done, reject) => {
    let text = "",
      errors = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Preview startup timed out: ${errors}`));
    }, 20_000);
    child.stderr!.on("data", (chunk) => {
      errors += String(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Preview exited ${code}: ${errors}`));
    });
    child.stdout!.on("data", (chunk) => {
      text += String(chunk);
      if (text.includes("\n")) {
        clearTimeout(timer);
        try {
          expect(text.length).toBeLessThan(2048);
          done({ child, report: JSON.parse(text.trim()) });
        } catch (error) {
          child.kill("SIGTERM");
          reject(error);
        }
      }
    });
  });
}
async function close(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  child.kill(signal);
  await exited;
}

it.each(["SIGINT", "SIGTERM"] as const)(
  "keeps concurrent JSON previews isolated, same-origin, compact and individually disposable with %s",
  async (signal) => {
    const cwd = await mkdtemp(resolve(tmpdir(), "refrain-open-test-"));
    const previews: Preview[] = [];
    try {
      for (const args of [
        [
          "draft",
          "--out",
          "source.json",
          "--title",
          "Preview proof",
          "--instruments",
          "lattice_pluck",
          "--bars",
          "1",
        ],
        ["hum", "source.json", "--out", "work.json"],
      ]) {
        const result = spawnSync(process.execPath, [binary, ...args], {
          cwd,
          encoding: "utf8",
        });
        expect(result.status, result.stdout + result.stderr).toBe(0);
      }
      previews.push(await open(cwd));
      previews.push(await open(cwd));
      const urls = previews.map((p) => new URL(p.report.url));
      expect(urls[0]!.origin).not.toBe(urls[1]!.origin);
      const directories = () =>
        readdir(cwd).then((names) =>
          names.filter((n) => n.startsWith("refrain-preview-")),
        );
      expect(await directories()).toHaveLength(2);
      for (const [i, url] of urls.entries()) {
        expect(previews[i]!.report.delivery).toBe("session");
        const session = new URL(url.searchParams.get("sessionHref")!);
        expect(session.origin).toBe(url.origin);
        expect((await fetch(url)).status).toBe(200);
        const response = await fetch(session);
        expect(response.status).toBe(200);
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
        expect(parseRefrainArtifact(await response.json()).ok).toBe(true);
      }
      await close(previews[0]!.child, signal);
      expect(await directories()).toHaveLength(1);
      expect((await fetch(urls[1]!)).status).toBe(200);
      await close(previews[1]!.child, signal);
      expect(await directories()).toHaveLength(0);
    } finally {
      await Promise.all(previews.map((p) => close(p.child)));
      await rm(cwd, { recursive: true, force: true });
    }
  },
  40_000,
);
