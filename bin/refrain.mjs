#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const commandPath = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(commandPath));
const packageJsonPath = resolve(repoRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const tsxLoader = resolve(repoRoot, "node_modules/tsx/dist/loader.mjs");
const invocationDirectory = process.cwd();
const rawArguments = process.argv.slice(2);
const json = rawArguments.includes("--json");
const arguments_ = rawArguments.filter((argument) => argument !== "--json");

const help = `Refrain · let your agent hum

Usage:
  refrain doctor [--json]
  refrain bindings list [--json]
  refrain draft --out <air-file> --title <title> --instruments <id,id> [--tempo <bpm>] [--meter <meter>] [--bars <count>]
  refrain inspect <air-or-artifact> [--section <id>] [--voice <id>] [--compare <previous-file>] [--json]
  refrain hum <air-file> --out <artifact-file> [--binding <id-or-file>] [--parent <artifact-file> --relation <relation>] [--evidence <file>] [--caption <text>]
  refrain produce init <artifact> --id <new-binding-id> --out <settings-file> [--binding <carried-id>]
  refrain produce inspect <artifact> [--settings <file>] [--binding <carried-id>] [--json]
  refrain produce apply <artifact> --settings <file> --out <new-artifact> [--binding <carried-id>]
  refrain audition <artifact> --out <directory> [--binding <carried-id>] [--section <id> | --selection <file> | --start <seconds> --end <seconds>] [--context <seconds>] [--compare <artifact> --compare-section <id>] [--asset-root <directory>]
  refrain audition slice <full-audition-directory> --out <directory> [--section <id> | --selection <file> | --start <seconds> --end <seconds>] [--context <seconds>]
  refrain audition verify <audition-directory> [--json]
  refrain audition locate <audition-directory> --at <local-seconds> [--entry a|b] [--json]
  refrain respond <audition-directory> --observer <name> --basis <audio-input,score-reading,render-measurements,human-listening> --message <text> --out <response-file> [--entry a|b] [--start <seconds> --end <seconds>]
  refrain share <audition-directory> --out <directory> --attribution <text> --rights <text> [--include-artifact] [--response <file>] [--invitation welcome|music|conversation|none] [--message <text>]
  refrain receive <share-directory> [--out <new-directory>] [--json]
  refrain fetch (--candidate <id> | --profile <id> | --palette <id> | --air <file> --binding <id>)
  refrain open <air-or-artifact> [--binding <id>] [--no-open] [--json]
  refrain export <air-or-artifact> [--binding <id>] [--out <directory>] [--matched-preview]
  refrain packs <command> [options]
  refrain mcp stdio

The CLI is a local shell over Refrain's canonical compiler, renderer, exporter,
pack manager, and MCP server. It does not add a second runtime or composition model.`;

function nodeAtLeast(actual, minimum) {
  const left = actual.replace(/^v/, "").split(".").map(Number);
  const right = minimum.replace(/^v/, "").split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) > (right[index] ?? 0)) return true;
    if ((left[index] ?? 0) < (right[index] ?? 0)) return false;
  }
  return true;
}

function doctor() {
  const minimumNode = String(packageJson.engines?.node ?? ">=22.23.1").replace(
    /^>=/,
    "",
  );
  const entrypoints = {
    open: resolve(repoRoot, "apps/presentation/src/open-air.ts"),
    export: resolve(repoRoot, "apps/presentation/src/export-air.ts"),
    bindings: resolve(repoRoot, "apps/presentation/src/bindings.ts"),
    authoring: resolve(repoRoot, "apps/presentation/src/authoring.ts"),
    production: resolve(repoRoot, "apps/presentation/src/production.ts"),
    correspondence: resolve(
      repoRoot,
      "apps/presentation/src/correspondence.ts",
    ),
    packs: resolve(repoRoot, "apps/presentation/src/packs.ts"),
    mcpStdio: resolve(repoRoot, "packages/mcp-server/src/stdio.ts"),
  };
  const missing = Object.entries({ tsx: tsxLoader, ...entrypoints })
    .filter(([, path]) => !existsSync(path))
    .map(([name]) => name);
  const nodeSupported = nodeAtLeast(process.version, minimumNode);
  const report = {
    ok: nodeSupported && missing.length === 0,
    command: "refrain",
    version: packageJson.version,
    sourceRoot: repoRoot,
    invocationDirectory,
    runtime: {
      node: process.version,
      minimumNode,
      nodeSupported,
    },
    authRequired: false,
    networkRequired: false,
    mcp: { transport: "stdio", command: "refrain mcp stdio" },
    entrypoints: Object.fromEntries(
      Object.entries(entrypoints).map(([name, path]) => [
        name,
        { available: existsSync(path) },
      ]),
    ),
    missing,
  };
  if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    process.stdout.write(
      [
        `Refrain ${report.version}`,
        `Node ${report.runtime.node} (minimum ${report.runtime.minimumNode}): ${nodeSupported ? "ok" : "unsupported"}`,
        `Local entrypoints: ${missing.length === 0 ? "ok" : `missing ${missing.join(", ")}`}`,
        "Auth: none · doctor network: none",
        `MCP: ${report.mcp.command}`,
      ].join("\n") + "\n",
    );
  }
  return report.ok ? 0 : 1;
}

function assignedOptions(args, names) {
  const normalized = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (names.has(token)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new Error(`${token} needs a value.`);
      normalized.push(`${token}=${value}`);
      index += 1;
    } else normalized.push(token);
  }
  return normalized;
}

async function runTypeScript(relativePath, args, options = {}) {
  if (!existsSync(tsxLoader))
    throw new Error("Refrain dependencies are missing. Run npm ci first.");
  const child = spawn(
    process.execPath,
    // A direct loader keeps signal ownership with the actual entrypoint. The
    // tsx CLI's signal relay can force-kill a busy preview before cleanup ends.
    ["--import", tsxLoader, resolve(repoRoot, relativePath), ...args],
    {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, INIT_CWD: invocationDirectory, ...options.env },
      stdio: "inherit",
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }
  return await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) =>
      resolveExit(code ?? (signal === "SIGINT" ? 130 : 1)),
    );
  });
}

async function main() {
  const [command, ...rest] = arguments_;
  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    process.stdout.write(`${help}\n`);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${packageJson.version}\n`);
    return 0;
  }
  if (command === "doctor") return doctor();
  if (rest.includes("--help") || rest.includes("-h")) {
    const usage = help
      .split("\n")
      .filter((line) => line.startsWith(`  refrain ${command} `));
    if (!usage.length)
      throw new Error(`Unknown command ${command}. Run refrain --help.`);
    if (["audition", "respond", "share", "receive"].includes(command)) {
      process.stdout.write(
        `Usage:\n${usage.join("\n")}\n\nSee docs/CORRESPONDENCE.md for exact sound, comparison, optional responses, and local sharing. No automatic playback, upload, or model-hearing claim.\n`,
      );
      return 0;
    }
    if (command === "produce") {
      process.stdout.write(
        `Usage:\n${usage.join("\n")}\n\nInit writes editable scene settings; inspect resolves current or proposed routing; apply retains the music and adds a new exact binding.\nUse --json for machine output. See plugins/refrain/skills/refrain-air-authoring/references/production.md.\n`,
      );
      return 0;
    }
    process.stdout.write(
      `Usage:\n${usage.join("\n")}\n\nDraft writes a silent AIR@1 score; the host authors its music.\nInspect compares --compare to the input; hum writes the complete Artifact@3.\nSee plugins/refrain/skills/refrain-air-authoring/references/local-workflow.md for the workflow.\n`,
    );
    return 0;
  }
  if (command === "produce")
    return runTypeScript("apps/presentation/src/production.ts", [
      ...rest,
      ...(json ? ["--json"] : []),
    ]);
  if (["audition", "respond", "share", "receive"].includes(command))
    return runTypeScript("apps/presentation/src/correspondence.ts", [
      command,
      ...rest,
      ...(json ? ["--json"] : []),
    ]);
  if (["draft", "inspect", "hum"].includes(command))
    return runTypeScript("apps/presentation/src/authoring.ts", [
      command,
      ...rest,
      ...(json ? ["--json"] : []),
    ]);
  if (command === "bindings") {
    const [subcommand = "list", ...bindingArguments] = rest;
    if (subcommand !== "list")
      throw new Error(
        `Unknown bindings command ${subcommand}. Use bindings list.`,
      );
    return runTypeScript("apps/presentation/src/bindings.ts", [
      ...(json ? ["--json"] : []),
      ...bindingArguments,
    ]);
  }
  if (command === "fetch")
    return runTypeScript("scripts/fetch-soundpack.ts", rest);
  if (command === "open")
    return runTypeScript(
      "apps/presentation/src/open-air.ts",
      assignedOptions(
        [...rest, ...(json ? ["--json"] : [])],
        new Set(["--binding"]),
      ),
    );
  if (command === "export")
    return runTypeScript(
      "apps/presentation/src/export-air.ts",
      assignedOptions(
        [...rest, ...(json ? ["--json"] : [])],
        new Set(["--binding", "--out"]),
      ),
    );
  if (command === "packs")
    return runTypeScript("apps/presentation/src/packs.ts", rest);
  if (command === "mcp") {
    const [transport, ...transportArguments] = rest;
    if (transport !== "stdio" || transportArguments.length > 0)
      throw new Error("The local MCP entrypoint is: refrain mcp stdio");
    return runTypeScript("packages/mcp-server/src/stdio.ts", [], {
      cwd: resolve(repoRoot, "packages/mcp-server"),
      env: { NODE_ENV: "production" },
    });
  }
  throw new Error(`Unknown command ${command}. Run refrain --help.`);
}

try {
  process.exitCode = await main();
} catch (cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (json)
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: { message } })}\n`,
    );
  else process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
