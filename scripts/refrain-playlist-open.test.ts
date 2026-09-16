import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { parseRefrainArtifact, type RefrainArtifact } from "@refrain/renderer";
import {
  parsePlayerPlaylist,
  parsePlayerPlaylistBytes,
  playerPlaylistBytesFromText,
  stringifyPlayerPlaylist,
  type PlayerPlaylist,
} from "../apps/presentation/src/player-playlist.js";

const binary = resolve("bin/refrain.mjs");

interface PlayerReport {
  ok: true;
  url: string;
  delivery: "inline" | "session";
  kind?: "playlist";
  title?: string;
  entryCount?: number;
  bindings?: string[];
  binding?: string | null;
  sourceRevision?: string;
  theme?: string;
  expiresAt?: string;
}

interface Preview {
  child: ChildProcess;
  report: PlayerReport;
  errors: () => string;
}

function startOpen(cwd: string, args: string[]): Promise<Preview> {
  const child = spawn(
    process.execPath,
    [binary, "open", ...args, "--no-open", "--json"],
    {
      cwd,
      env: { ...process.env, TMPDIR: cwd },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return new Promise((done, reject) => {
    let text = "";
    let errors = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Player startup timed out: ${errors}`));
    }, 25_000);
    child.stderr!.on("data", (chunk) => {
      errors += String(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Player exited ${code}: ${errors}`));
    });
    child.stdout!.on("data", (chunk) => {
      text += String(chunk);
      if (!text.includes("\n")) return;
      clearTimeout(timer);
      try {
        done({
          child,
          report: JSON.parse(text.trim()) as PlayerReport,
          errors: () => errors,
        });
      } catch (error) {
        child.kill("SIGTERM");
        reject(error);
      }
    });
  });
}

async function close(preview: Preview): Promise<void> {
  if (preview.child.exitCode !== null) return;
  const exited = new Promise<void>((done) =>
    preview.child.once("exit", () => done()),
  );
  preview.child.kill("SIGTERM");
  await exited;
}

async function previewRoots(cwd: string): Promise<string[]> {
  return (await readdir(cwd)).filter((name) =>
    name.startsWith("refrain-preview-"),
  );
}

async function playlistsDelivered(
  preview: Preview,
): Promise<{ bytes: Uint8Array; playlist: PlayerPlaylist }> {
  const url = new URL(preview.report.url);
  const href = url.searchParams.get("playlistHref");
  expect(href).toBeTruthy();
  const session = new URL(href!);
  expect(session.origin).toBe(url.origin);
  const response = await fetch(session);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(
    "application/vnd.refrain-playlist+json",
  );
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = new URLSearchParams(url.hash.slice(1)).get("playlist");
  // The URL carries only the SHA-256 locator, never the queue itself.
  expect(hash).toBe(
    playerPlaylistBytesFromText(new TextDecoder().decode(bytes)).sha256,
  );
  const parsed = parsePlayerPlaylistBytes(bytes, hash!);
  if (!parsed.ok) throw new Error(parsed.message);
  return { bytes, playlist: parsed.playlist };
}

async function author(
  cwd: string,
  index: number,
  title: string,
): Promise<void> {
  for (const args of [
    [
      "draft",
      "--out",
      `source-${index}.json`,
      "--title",
      title,
      "--instruments",
      "lattice_pluck",
      "--bars",
      "1",
    ],
    ["hum", `source-${index}.json`, "--out", `work-${index}.refrain.json`],
  ]) {
    const result = spawnSync(process.execPath, [binary, ...args], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }
}

it("opens several works in one compact loopback Player with their exact union", async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), "refrain-player-multi-"));
  const previews: Preview[] = [];
  try {
    await author(cwd, 0, "First proof");
    await author(cwd, 1, "Second proof");

    // A raw AIR source and a sealed artifact use the same canonical loading path.
    const preview = await startOpen(cwd, [
      "source-0.json",
      "work-1.refrain.json",
      "--theme",
      "prism",
    ]);
    previews.push(preview);
    expect(preview.report).toMatchObject({
      ok: true,
      kind: "playlist",
      entryCount: 2,
      delivery: "session",
    });
    expect(JSON.stringify(preview.report).length).toBeLessThan(1_024);
    const url = new URL(preview.report.url);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.searchParams.has("sessionHref")).toBe(false);
    expect(url.searchParams.has("artifact")).toBe(false);
    expect(new URLSearchParams(url.hash.slice(1)).get("playlist")).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );

    const { playlist } = await playlistsDelivered(preview);
    expect(playlist.entries.map((entry) => entry.id)).toEqual([
      "entry-1",
      "entry-2",
    ]);
    expect(playlist.entries.map((entry) => entry.bindingId)).toEqual([
      "complete-piece-engineering@0",
      "f-synthetic-beat@0",
    ]);
    expect(playlist.entries.map((entry) => entry.presentation?.theme)).toEqual([
      "prism",
      "prism",
    ]);
    // Exact custody: each entry carries the same document the file holds.
    const sealed = JSON.parse(
      await readFile(resolve(cwd, "work-1.refrain.json"), "utf8"),
    ) as RefrainArtifact;
    expect(playlist.entries[1]!.artifact).toEqual(sealed);
    expect(parseRefrainArtifact(playlist.entries[1]!.artifact).ok).toBe(true);
    expect(preview.report.bindings).toEqual([
      "complete-piece-engineering@0",
      "f-synthetic-beat@0",
    ]);
    await close(preview);
    expect(await previewRoots(cwd)).toHaveLength(0);
  } finally {
    await Promise.all(previews.map((preview) => close(preview)));
    await rm(cwd, { recursive: true, force: true });
  }
}, 90_000);

it("restores one saved playlist exactly and keeps the one-work report", async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), "refrain-player-restore-"));
  const previews: Preview[] = [];
  try {
    await author(cwd, 0, "Solo proof");
    const sealed = JSON.parse(
      await readFile(resolve(cwd, "work-0.refrain.json"), "utf8"),
    ) as RefrainArtifact;
    const saved: PlayerPlaylist = {
      format: "refrain-playlist@0-experimental",
      title: "Saved local queue",
      entries: [
        {
          id: "only",
          artifact: sealed,
          bindingId: "f-synthetic-beat@0",
          presentation: { theme: "herbarium" },
        },
      ],
      currentEntryId: "only",
    };
    const savedText = stringifyPlayerPlaylist(saved);
    await writeFile(resolve(cwd, "list.refrain-playlist.json"), savedText);
    expect(parsePlayerPlaylist(JSON.parse(savedText)).ok).toBe(true);

    const restored = await startOpen(cwd, ["list.refrain-playlist.json"]);
    previews.push(restored);
    expect(restored.report).toMatchObject({
      ok: true,
      kind: "playlist",
      entryCount: 1,
      title: "Saved local queue",
      delivery: "session",
    });
    const delivered = await playlistsDelivered(restored);
    // Without an explicit override the saved playlist stays byte-exact.
    expect(new TextDecoder().decode(delivered.bytes)).toBe(savedText);

    const overridden = await startOpen(cwd, [
      "list.refrain-playlist.json",
      "--theme",
      "nocturne-ink",
    ]);
    previews.push(overridden);
    const changed = await playlistsDelivered(overridden);
    expect(changed.playlist.entries[0]!.presentation).toEqual({
      theme: "nocturne-ink",
    });
    expect(new TextDecoder().decode(changed.bytes)).not.toBe(savedText);

    // The ordinary one-work path keeps its report fields and inline/session choice.
    const single = await startOpen(cwd, ["work-0.refrain.json"]);
    previews.push(single);
    expect(single.report.kind).toBeUndefined();
    expect(single.report.entryCount).toBeUndefined();
    expect(single.report.binding).toBe("f-synthetic-beat@0");
    expect(single.report.sourceRevision).toBe(sealed.receipt.sourceRevision);
    expect(single.report.expiresAt).toBeTruthy();
    const session = new URL(
      new URL(single.report.url).searchParams.get("sessionHref")!,
    );
    expect(session.origin).toBe(new URL(single.report.url).origin);
    expect(await (await fetch(session)).json()).toEqual(sealed);

    const themed = await startOpen(cwd, [
      "work-0.refrain.json",
      "--theme",
      "paper-sonata",
    ]);
    previews.push(themed);
    expect(new URL(themed.report.url).searchParams.get("theme")).toBe(
      "paper-sonata",
    );
    expect(themed.report.theme).toBe("paper-sonata");

    for (const preview of previews.splice(0)) await close(preview);
    expect(await previewRoots(cwd)).toHaveLength(0);
  } finally {
    await Promise.all(previews.map((preview) => close(preview)));
    await rm(cwd, { recursive: true, force: true });
  }
}, 90_000);

it("fails closed on an unknown theme, a mixed playlist, and an invalid playlist", async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), "refrain-player-invalid-"));
  try {
    await author(cwd, 0, "Failure proof");
    const run = (args: string[]) =>
      spawnSync(process.execPath, [binary, "open", ...args, "--json"], {
        cwd,
        encoding: "utf8",
      });

    const unknownTheme = run(["work-0.refrain.json", "--theme", "sunrise"]);
    expect(unknownTheme.status).toBe(1);
    expect(unknownTheme.stdout).toContain("Unknown --theme sunrise");

    const invalid = {
      format: "refrain-playlist@0-experimental",
      title: "Broken queue",
      entries: [{ id: "entry-1", artifact: { format: "not-an-artifact" } }],
    };
    await writeFile(
      resolve(cwd, "broken.refrain-playlist.json"),
      `${JSON.stringify(invalid, null, 2)}\n`,
    );
    const broken = run(["broken.refrain-playlist.json"]);
    expect(broken.status).toBe(1);
    const brokenReport = JSON.parse(broken.stdout) as {
      ok: boolean;
      error: { message: string };
    };
    expect(brokenReport.ok).toBe(false);
    expect(brokenReport.error.message).toContain(
      "not an exact presentable artifact",
    );

    // A playlist is never silently read as AIR, and it cannot be mixed with works.
    const mixed = run(["work-0.refrain.json", "broken.refrain-playlist.json"]);
    expect(mixed.status).toBe(1);
    expect(mixed.stdout).toContain("open it on its own");
    expect(await previewRoots(cwd)).toHaveLength(0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}, 60_000);
