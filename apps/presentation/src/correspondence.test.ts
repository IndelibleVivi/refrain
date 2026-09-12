import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
  readdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRefrainArtifactV3,
  parseRefrainArtifact,
} from "@refrain/renderer/portable";
import { humV1 } from "@refrain/mcp-server/hum-v1";
import {
  readAudition,
  readResponse,
  sealResponse,
  correspondenceIdentity,
  sealAudition,
} from "@refrain/correspondence";
import {
  createShare,
  describeFile,
  jsonFile,
  prepareAudition,
  receiveShare,
  verifyAuditionDirectory,
  writeJson,
} from "@refrain/correspondence/node";
import { draftAir } from "./authoring.js";
import { runCorrespondenceCli } from "./correspondence.js";

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function root() {
  const p = await mkdtemp(join(tmpdir(), "refrain-correspondence-test-"));
  roots.push(p);
  return p;
}
function work(tempo = 120) {
  const air = draftAir({
    title: "A lingering answer",
    instruments: ["air_pad"],
    tempo,
    meter: "4/4",
    bars: 2,
  });
  air.sections = [
    { id: "call", startBar: 1, bars: 1 },
    { id: "answer", startBar: 2, bars: 1 },
  ];
  air.voices[0]!.realize = [
    { id: "held", kind: "literal", part: "C4/1 | G4/1", gate: 1.5 },
  ];
  const result = humV1({ air });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return createRefrainArtifactV3({
    source: result.source,
    receipt: result.receipt,
    performanceBinding: result.performanceBinding,
  });
}
const sharing = {
  includeArtifact: true,
  attribution: "Test author and agent",
  rights: "Test permission statement; not an identity claim.",
  invitation: { response: "music" as const },
};

describe("musical correspondence", () => {
  it("delivers reproducible native sound and crops exact finished PCM with incoming sustain", async () => {
    const dir = await root();
    const artifact = work();
    const before = JSON.stringify(artifact);
    const full = await prepareAudition([{ artifact }], join(dir, "full"));
    const clip = await prepareAudition(
      [{ artifact, target: { section: "answer", contextSeconds: 0 } }],
      join(dir, "clip"),
    );
    const again = await prepareAudition([{ artifact }], join(dir, "again"));
    expect(again.auditionId).toBe(full.auditionId);
    expect(full.entries[0]!.media.sha256).toBe(
      full.entries[0]!.renderReceipt.outputSha256,
    );
    const entry = clip.entries[0]!;
    const fullBytes = await readFile(join(dir, "full/a.wav"));
    const excerpt = await readFile(join(dir, "clip/a.wav"));
    expect(excerpt.subarray(44)).toEqual(
      fullBytes.subarray(
        44 + entry.range.startFrame * 4,
        44 + entry.range.endFrame * 4,
      ),
    );
    expect(entry.range.focusStartFrame).toBe(2 * 44_100);
    expect(entry.selection!.anchor).toContain("answer");
    expect(entry.measurements.rms).toBeGreaterThan(0);
    expect(await jsonFile(join(dir, "clip/a.refrain.json"))).toEqual(artifact);
    expect(JSON.stringify(artifact)).toBe(before);
    await expect(verifyAuditionDirectory(join(dir, "clip"))).resolves.toEqual(
      clip,
    );
  });

  it("requires explicit A/B musical targets across tempo changes and refuses stale selections", async () => {
    const dir = await root();
    await writeJson(join(dir, "a.json"), work());
    await writeJson(join(dir, "b.json"), work(90));
    await expect(
      runCorrespondenceCli(
        [
          "audition",
          "a.json",
          "--section",
          "answer",
          "--compare",
          "b.json",
          "--out",
          "bad",
        ],
        dir,
      ),
    ).rejects.toThrow(/explicit target/);
    await runCorrespondenceCli(
      [
        "audition",
        "a.json",
        "--section",
        "answer",
        "--compare",
        "b.json",
        "--compare-section",
        "answer",
        "--context",
        "0",
        "--out",
        "pair",
      ],
      dir,
    );
    const pair = await verifyAuditionDirectory(join(dir, "pair"));
    expect(pair.entries[0]!.range.startFrame).not.toBe(
      pair.entries[1]!.range.startFrame,
    );
    expect(pair.entries[0]!.selection!.timeRange).toEqual(
      pair.entries[1]!.selection!.timeRange,
    );
    const forgedFocus = structuredClone(pair.entries);
    forgedFocus[0]!.range.focusStartFrame++;
    await writeFile(
      join(dir, "pair/audition.json"),
      JSON.stringify(sealAudition(forgedFocus)),
    );
    await expect(verifyAuditionDirectory(join(dir, "pair"))).rejects.toThrow(
      /focus.*selection/,
    );
    await expect(
      prepareAudition(
        [
          {
            artifact: work(90),
            target: { selection: pair.entries[0]!.selection },
          },
        ],
        join(dir, "stale"),
      ),
    ).rejects.toThrow(/stale/);
    await expect(
      prepareAudition(
        [{ artifact: work(), target: { startSeconds: 10, endSeconds: 11 } }],
        join(dir, "outside"),
      ),
    ).rejects.toThrow(/outside/);
    expect(await readdir(dir)).not.toContain("stale");
  });

  it("keeps optional subjective responses outside music and bound to the exact audition", async () => {
    const dir = await root();
    const packet = await prepareAudition(
      [{ artifact: work() }],
      join(dir, "packet"),
    );
    const response = sealResponse(packet, {
      entry: "a",
      observer: "Listener",
      basis: ["render-measurements"],
      message: "The ending remains active in the delivered signal.",
      focus: { startSeconds: 1, endSeconds: 2 },
    });
    expect(readResponse(response, packet)).toEqual(response);
    expect(response.access).toBe("observer-declared");
    expect(() =>
      readResponse({ ...response, message: "changed" }, packet),
    ).toThrow(/changed/);
    expect(() =>
      readResponse(
        { ...response, auditionId: `sha256:${"0".repeat(64)}` },
        packet,
      ),
    ).toThrow();
    expect(() =>
      sealResponse(packet, {
        entry: "a",
        observer: "Listener",
        basis: ["score-reading"],
        message: "hi",
        focus: { startSeconds: 1, endSeconds: 999 },
      }),
    ).toThrow(/outside/);
    const bad = { ...packet, heard: true };
    expect(() => readAudition(bad)).toThrow();
  });

  it("receives frozen sound without source or sound assets, and selectively carries responses", async () => {
    const dir = await root();
    const packet = await prepareAudition(
      [{ artifact: work() }],
      join(dir, "private"),
    );
    const response = sealResponse(packet, {
      entry: "a",
      observer: "Listener",
      basis: ["score-reading"],
      message: "A reply can take its time.",
    });
    await writeJson(join(dir, "selected.json"), response);
    await writeFile(
      join(dir, "private/unselected-private-note.txt"),
      "MUST STAY LOCAL",
    );
    await createShare(join(dir, "private"), join(dir, "share"), {
      ...sharing,
      includeArtifact: false,
      responses: [join(dir, "selected.json")],
    });
    const result = await receiveShare(
      join(dir, "share"),
      join(dir, "receiver"),
    );
    expect(result.auditionId).toBe(packet.auditionId);
    expect(result.modelAudioInput).toBe("unknown");
    expect(result.materials[0]!.formalReply).toBe("requires-parent-artifact");
    expect(result.untrustedContent.responses).toEqual([response]);
    expect((await readdir(join(dir, "receiver"))).sort()).toEqual([
      "a.wav",
      "audition.json",
      "response-1.json",
      "share.json",
    ]);
    await expect(
      receiveShare(join(dir, "share"), join(dir, "receiver")),
    ).rejects.toThrow(/EEXIST/);
  });

  it("rejects changed sound, forged measurements, traversal, and symlink members", async () => {
    const dir = await root();
    const packet = await prepareAudition(
      [{ artifact: work() }],
      join(dir, "packet"),
    );
    const p = join(dir, "packet/a.wav");
    const bytes = await readFile(p);
    bytes[50] = bytes[50]! ^ 1;
    await writeFile(p, bytes);
    await expect(verifyAuditionDirectory(join(dir, "packet"))).rejects.toThrow(
      /SHA-256/,
    );
    const forged = structuredClone(packet);
    forged.entries[0]!.measurements.rms = 0;
    expect(() => readAudition(forged)).toThrow(/identity/);
    await symlink(p, join(dir, "link.wav"));
    await expect(describeFile(dir, "link.wav")).rejects.toThrow(/regular file/);
    await expect(describeFile(dir, "../a.wav")).rejects.toThrow();
    const crossed = structuredClone(packet);
    crossed.entries[0]!.binding.contentSha256 = "0".repeat(64);
    expect(() => readAudition(crossed)).toThrow(/source render/);
  });

  it("preserves all parent authorities through fresh-process share reception and a formal musical reply", async () => {
    const dir = await root();
    const parent = work();
    await prepareAudition([{ artifact: parent }], join(dir, "packet"));
    await createShare(join(dir, "packet"), join(dir, "shared"), sharing);
    const cli = resolve("bin/refrain.mjs");
    const received = JSON.parse(
      (
        await execute(
          process.execPath,
          [cli, "receive", "shared", "--out", "received", "--json"],
          { cwd: dir },
        )
      ).stdout,
    );
    const parentPath = received.materials[0].parentArtifact;
    expect(await jsonFile(parentPath)).toEqual(parent);
    const child = structuredClone(parent.source);
    child.title = "An answer in return";
    child.voices[0]!.realize = [
      { id: "reply", kind: "literal", part: "E4/1 | D4/1", gate: 1.5 },
    ];
    await writeJson(join(dir, "reply.air.json"), child);
    await execute(
      process.execPath,
      [
        cli,
        "hum",
        "reply.air.json",
        "--parent",
        parentPath,
        "--relation",
        "reply",
        "--out",
        "reply.refrain.json",
        "--json",
      ],
      { cwd: dir },
    );
    const result = parseRefrainArtifact(
      await jsonFile(join(dir, "reply.refrain.json")),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.receipt.lineage!.parentReceiptId).toBe(
      parent.receipt.receiptId,
    );
    expect(result.artifact.receipt.lineage!.relation).toBe("reply");
    expect(correspondenceIdentity(await jsonFile(parentPath))).toBe(
      correspondenceIdentity(parent),
    );
  }, 20_000);

  it("keeps unavailable sound exact and cleans failed preparation without overwriting a folder", async () => {
    const dir = await root();
    const artifact = work();
    artifact.performanceBindings = [];
    delete artifact.defaultBindingId;
    await expect(
      prepareAudition([{ artifact }], join(dir, "unbound")),
    ).rejects.toThrow(/no audition default/);
    expect(await readdir(dir)).toEqual([]);
    await prepareAudition([{ artifact: work() }], join(dir, "existing"));
    await expect(
      prepareAudition([{ artifact: work() }], join(dir, "existing")),
    ).rejects.toThrow(/EEXIST/);
  });
});
