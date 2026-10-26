import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createRefrainArtifactV3 } from "@refrain/renderer/portable";
import { humV1 } from "@refrain/mcp-server/hum-v1";
import { correspondenceIdentity, sealResponse } from "@refrain/correspondence";
import {
  createShare,
  prepareAudition,
  sliceAudition,
  writeJson,
} from "@refrain/correspondence/node";
import { draftAir } from "./authoring.js";
import { runCorrespondenceCli, inspectResponse } from "./correspondence.js";
const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture(includeArtifact = true) {
  const root = await mkdtemp(join(tmpdir(), "refrain-listening-"));
  roots.push(root);
  const air = draftAir({
    title: "PRIVATE SOURCE TITLE",
    instruments: ["lattice_pluck"],
    tempo: 220,
    meter: "4/4",
    bars: 1,
  });
  air.voices[0]!.realize = [{ id: "line", kind: "literal", part: "C4/1" }];
  const result = humV1({ air, caption: "PRIVATE CAPTION" });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const artifact = createRefrainArtifactV3({
    source: result.source,
    receipt: result.receipt,
    performanceBinding: result.performanceBinding,
    caption: result.caption,
  });
  const packet = await prepareAudition([{ artifact }], join(root, "audition"));
  const response = sealResponse(packet, {
    entry: "a",
    observer: "A listener",
    basis: ["human-listening"],
    message: "A quiet return.",
  });
  await writeJson(join(root, "response.json"), response);
  const share = await createShare(join(root, "audition"), join(root, "share"), {
    includeArtifact,
    attribution: "Author </script><script>BAD()</script>\u2028\u2029",
    rights: "Permission applies to this recording.",
    invitation: { response: "welcome" },
    responses: [join(root, "response.json")],
  });
  return { root, packet, artifact, response, share };
}

describe("exact response inspection", () => {
  it("inspects exact responses and maps clip time back to source frames with carried parent custody", async () => {
    const { root } = await fixture();
    const packet = await sliceAudition(
      join(root, "audition"),
      join(root, "clip"),
      { startSeconds: 0.25, endSeconds: 0.75, contextSeconds: 0 },
    );
    const response = sealResponse(packet, {
      entry: "a",
      observer: "Listener",
      basis: ["human-listening"],
      message: "Please leave this phrase alone.",
      focus: { startSeconds: 0.1, endSeconds: 0.2 },
    });
    await writeJson(join(root, "clip-response.json"), response);
    const result = await inspectResponse(
      join(root, "clip-response.json"),
      join(root, "clip"),
    );
    const entry = packet.entries[0]!;
    expect(result.focus!.start.sourceFrame).toBe(
      entry.range.startFrame + Math.round(0.1 * entry.media.sampleRate),
    );
    expect(result.focus!.end.sourceSeconds).toBe(
      (entry.range.startFrame + Math.round(0.2 * entry.media.sampleRate)) /
        entry.media.sampleRate,
    );
    expect(result.untrustedContent.message).toBe(response.message);
    expect(result.parentArtifact).toBe(join(root, "clip/a.refrain.json"));
    expect(result.basis).toEqual(["human-listening"]);
    expect(result.access).toBe("observer-declared");
    const shared = await inspectResponse(
      join(root, "response.json"),
      join(root, "share"),
    );
    expect(shared.parentArtifact).toBe(join(root, "share/a.refrain.json"));
  });

  it("preserves existing respond syntax and rejects wrong audition, tampering and invalid focus", async () => {
    const { root, response } = await fixture(false);
    const inspected = await runCorrespondenceCli(
      ["respond", "inspect", "response.json", "--audition", "share", "--json"],
      root,
    );
    expect(inspected).not.toHaveProperty("parentArtifact");
    const old = await runCorrespondenceCli(
      [
        "respond",
        "audition",
        "--observer",
        "Agent",
        "--basis",
        "score-reading",
        "--message",
        "A written answer.",
        "--out",
        "old.json",
      ],
      root,
    );
    expect(old).toHaveProperty("responseId");
    for (const changed of [
      { ...response, message: "changed" },
      { ...response, auditionId: `sha256:${"0".repeat(64)}` },
      { ...response, focus: { startSeconds: 0, endSeconds: 999 } },
    ]) {
      const { responseId: _id, ...body } = changed;
      // Rehash the invalid-focus document so identity alone cannot mask a bad range.
      const value =
        "focus" in changed
          ? { ...body, responseId: correspondenceIdentity(body) }
          : changed;
      await writeFile(join(root, "bad.json"), JSON.stringify(value));
      await expect(
        inspectResponse(join(root, "bad.json"), join(root, "share")),
      ).rejects.toThrow();
    }
    await writeFile(join(root, "share/share.json"), "{");
    await expect(
      inspectResponse(join(root, "response.json"), join(root, "share")),
    ).rejects.toThrow();
  });

  it("verifies in a fresh CLI process from the caller directory and fails on changed audio", async () => {
    const { root, response } = await fixture(false);
    const { stdout } = await execute(
      process.execPath,
      [
        resolve("bin/refrain.mjs"),
        "respond",
        "inspect",
        "response.json",
        "--audition",
        "share",
        "--json",
      ],
      { cwd: root },
    );
    expect(JSON.parse(stdout)).toMatchObject({
      responseId: response.responseId,
      access: "observer-declared",
    });
    expect(JSON.parse(stdout)).not.toHaveProperty("parentArtifact");
    const media = await readFile(join(root, "share/a.wav"));
    media[60] = media[60]! ^ 1;
    await writeFile(join(root, "share/a.wav"), media);
    await expect(
      inspectResponse(join(root, "response.json"), join(root, "share")),
    ).rejects.toThrow(/SHA-256/);
  }, 25000);
});
