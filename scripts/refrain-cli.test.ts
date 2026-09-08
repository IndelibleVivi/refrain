import {
  mkdtempSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const binary = resolve("bin/refrain.mjs");

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, [binary, ...args], {
    cwd,
    encoding: "utf8",
  });
}

describe("refrain CLI", () => {
  it("reports machine-readable health from outside the repository", () => {
    const cwd = mkdtempSync(resolve(tmpdir(), "refrain-cli-"));
    const result = run(["--json", "doctor"], cwd);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      invocationDirectory: string;
      authRequired: boolean;
      networkRequired: boolean;
      mcp: { command: string };
    };
    expect(report).toMatchObject({
      ok: true,
      invocationDirectory: realpathSync(cwd),
      authRequired: false,
      networkRequired: false,
      mcp: { command: "refrain mcp stdio" },
    });
  });

  it("lists exact built-in bindings through the canonical soundpack", () => {
    const cwd = mkdtempSync(resolve(tmpdir(), "refrain-cli-"));
    const result = run(["--json", "bindings", "list"], cwd);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      bindings: Array<{ id: string }>;
    };
    expect(output.ok).toBe(true);
    expect(output.bindings.map((binding) => binding.id)).toContain(
      "f-synthetic-beat@0",
    );
  });

  // Six cold CLI processes, including WAV export, use the same integration
  // budget as the production CLI proofs rather than the 5s unit-test default.
  it("authors and revises across fresh CLI processes outside the repository", () => {
    const cwd = mkdtempSync(resolve(tmpdir(), "refrain-cli-author-"));
    try {
      const draft = run(
        [
          "draft",
          "--out",
          "source.json",
          "--title",
          "Process proof",
          "--instruments",
          "lattice_pluck",
          "--bars",
          "1",
          "--json",
        ],
        cwd,
      );
      expect(draft.status, draft.stdout + draft.stderr).toBe(0);
      const source = JSON.parse(
        readFileSync(resolve(cwd, "source.json"), "utf8"),
      );
      source.voices[0].realize = [
        { id: "hello", kind: "literal", part: "C5/4 D5/4 E5/2" },
      ];
      writeFileSync(resolve(cwd, "source.json"), JSON.stringify(source));
      const root = run(
        ["hum", "source.json", "--out", "parent.json", "--json"],
        cwd,
      );
      expect(root.status, root.stdout + root.stderr).toBe(0);
      expect(root.stdout.length).toBeLessThan(2048);
      const parent = JSON.parse(
        readFileSync(resolve(cwd, "parent.json"), "utf8"),
      );
      source.voices[0].gainDb = -4;
      writeFileSync(resolve(cwd, "source.json"), JSON.stringify(source));
      const child = run(
        [
          "hum",
          "source.json",
          "--parent",
          "parent.json",
          "--relation",
          "revise",
          "--out",
          "child.json",
          "--json",
        ],
        cwd,
      );
      expect(child.status, child.stdout + child.stderr).toBe(0);
      expect(
        JSON.parse(readFileSync(resolve(cwd, "child.json"), "utf8")).receipt
          .lineage.parentReceiptId,
      ).toBe(parent.receipt.receiptId);
      const inspection = run(
        ["inspect", "child.json", "--compare", "parent.json", "--json"],
        cwd,
      );
      expect(inspection.status, inspection.stdout + inspection.stderr).toBe(0);
      expect(JSON.parse(inspection.stdout).compare.voices[0]).toMatchObject({
        notesUnchanged: true,
        expressionUnchanged: false,
      });
      const exported = run(
        ["export", "child.json", "--out", "rendered", "--json"],
        cwd,
      );
      expect(exported.status, exported.stdout + exported.stderr).toBe(0);
      const files = JSON.parse(exported.stdout);
      expect(files.ok).toBe(true);
      expect(files.directory).toBe(resolve(realpathSync(cwd), "rendered"));
      expect(
        JSON.parse(
          readFileSync(resolve(files.directory, files.files.artifact), "utf8"),
        ).receipt.lineage.parentReceiptId,
      ).toBe(parent.receipt.receiptId);

      expect(
        JSON.parse(
          run(["inspect", "child.json", "--section", "missing", "--json"], cwd)
            .stdout,
        ).ok,
      ).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 20000);

  it("keeps the command surface small and explicit", () => {
    const result = run(["--help"], process.cwd());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("refrain open <air-or-artifact>");
    expect(result.stdout).toContain("refrain fetch");
    expect(result.stdout).toContain("refrain mcp stdio");
    expect(result.stdout).not.toContain("compose");
    const draftHelp = run(["draft", "--help"], process.cwd());
    expect(draftHelp.status).toBe(0);
    expect(draftHelp.stdout).toContain("--instruments");
  });
});
