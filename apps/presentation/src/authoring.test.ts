import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseRefrainArtifact } from "@refrain/renderer/portable";
import { draftAir, runAuthoringCli } from "./authoring.js";
import { inspectMusic, readMusic } from "./inspect-air.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function directory() {
  const root = await mkdtemp(resolve(tmpdir(), "refrain-authoring-test-"));
  roots.push(root);
  return root;
}
function score() {
  const air = draftAir({
    title: "A reply",
    instruments: ["lattice_pluck", "sub_bass"],
    tempo: 96,
    meter: "4/4",
    bars: 2,
  });
  air.sections = [
    { id: "call", startBar: 1, bars: 1 },
    { id: "answer", startBar: 2, bars: 1 },
  ];
  air.voices[0] = {
    ...air.voices[0]!,
    part: undefined,
    role: "lead",
    realize: [{ id: "call", kind: "literal", part: "C5/1 | D5/1", gate: 1.2 }],
  };
  air.voices[1] = {
    ...air.voices[1]!,
    part: undefined,
    role: "bass",
    realize: [{ id: "floor", kind: "literal", part: "C2/1 | G2/1" }],
  };
  return air;
}

describe("file-based authoring workflow", () => {
  it("creates an exact silent AIR@1 vocabulary and meter duration, never overwriting authored files", async () => {
    const root = await directory();
    const args = [
      "draft",
      "--out",
      "draft.json",
      "--title",
      "A place",
      "--instruments",
      "warm_piano,harp",
      "--meter",
      "7/8",
      "--bars",
      "3",
    ];
    await runAuthoringCli(args, root);
    const source = JSON.parse(
      await readFile(resolve(root, "draft.json"), "utf8"),
    );
    const music = readMusic(source);
    expect(music.compiled.durationBeats).toBe(10.5);
    expect(music.compiled.events).toHaveLength(0);
    expect(
      source.vocabulary.instruments.map((i: { id: string }) => i.id),
    ).toEqual(["warm_piano", "harp"]);
    await expect(runAuthoringCli(args, root)).rejects.toThrow(/EEXIST/);
    expect(() =>
      draftAir({
        title: "x",
        instruments: ["imaginary"],
        tempo: 96,
        meter: "4/4",
        bars: 2,
      }),
    ).toThrow(/Unknown instrument/);
  });

  it("seals and continues an exact artifact in fresh file calls, inheriting the selected body", async () => {
    const root = await directory();
    await writeFile(resolve(root, "source.json"), JSON.stringify(score()));
    await runAuthoringCli(
      [
        "hum",
        "source.json",
        "--out",
        "parent.json",
        "--binding",
        "f-luminous-hybrid@0",
      ],
      root,
    );
    const input = JSON.parse(
      await readFile(resolve(root, "parent.json"), "utf8"),
    );
    const parent = parseRefrainArtifact(input);
    expect(parent.ok).toBe(true);
    await expect(
      runAuthoringCli(
        [
          "hum",
          "source.json",
          "--out",
          "unchanged.json",
          "--parent",
          "parent.json",
          "--relation",
          "revise",
        ],
        root,
      ),
    ).rejects.toThrow(/must change/);
    const revised = score();
    revised.voices[0]!.gainDb = -5;
    await writeFile(resolve(root, "source.json"), JSON.stringify(revised));
    await runAuthoringCli(
      [
        "hum",
        "source.json",
        "--out",
        "child.json",
        "--parent",
        "parent.json",
        "--relation",
        "revise",
      ],
      root,
    );
    const child = JSON.parse(
      await readFile(resolve(root, "child.json"), "utf8"),
    );
    expect(parseRefrainArtifact(child).ok).toBe(true);
    expect(child.defaultBindingId).toBe("f-luminous-hybrid@0");
    expect(child.receipt.lineage.parentReceiptId).toBe(input.receipt.receiptId);
    expect(child.receipt.airId).toBe(input.receipt.airId);
    expect(child.source).toEqual(revised);
    expect(
      inspectMusic(child, {}, input).compare!.voices.every(
        (v) => v.notesUnchanged,
      ),
    ).toBe(true);
    input.source.title = "Tampered";
    await writeFile(resolve(root, "tampered.json"), JSON.stringify(input));
    await expect(
      runAuthoringCli(
        [
          "hum",
          "source.json",
          "--out",
          "rejected.json",
          "--parent",
          "tampered.json",
          "--relation",
          "revise",
        ],
        root,
      ),
    ).rejects.toThrow(/valid exact/);
    expect(() => inspectMusic(input)).toThrow();
    await expect(readFile(resolve(root, "rejected.json"))).rejects.toThrow(
      /ENOENT/,
    );
    await expect(
      runAuthoringCli(["hum", "source.json", "--out", "child.json"], root),
    ).rejects.toThrow(/EEXIST/);
  });

  it("separates note preservation from expression and includes authored sustains crossing a selection", () => {
    const before = score();
    const after = structuredClone(before);
    after.voices[0]!.gainDb = -5;
    const report = inspectMusic(after, { section: "answer" }, before);
    after.voices[0]!.role = "counter";
    expect(
      inspectMusic(after, {}, before).compare!.voices[0]!.roleUnchanged,
    ).toBe(false);
    after.voices[0]!.role = "lead";
    expect(report.voices[0]!.carryIn).toBe(1);
    expect(report.compare!.voices[0]).toMatchObject({
      notesUnchanged: true,
      expressionUnchanged: false,
      instrumentUnchanged: true,
    });
    expect(report.compare!.voices[1]).toMatchObject({
      notesUnchanged: true,
      expressionUnchanged: true,
    });
    after.voices[0]!.realize![0] = {
      id: "call",
      kind: "literal",
      part: "C5/1 | D5/1",
      gate: 0.5,
    };
    expect(
      inspectMusic(after, { section: "answer" }, before).compare!.voices[0],
    ).toMatchObject({ notesUnchanged: true, expressionUnchanged: false });
    after.voices[0]!.realize![0] = {
      id: "call",
      kind: "literal",
      part: "C5/1 | E5/1",
      gate: 1.2,
    };
    expect(
      inspectMusic(after, { section: "answer" }, before).compare!.voices[0]!
        .notesUnchanged,
    ).toBe(false);
    expect(() => inspectMusic(after, { section: "typo" })).toThrow(
      /Unknown section/,
    );
    expect(() => inspectMusic(after, { voice: "typo" })).toThrow(
      /Unknown voice/,
    );
    expect(JSON.stringify(report)).not.toContain('"midi":');
    expect(() => inspectMusic({ format: "air@99" })).toThrow(/Expected/);
  });
});
