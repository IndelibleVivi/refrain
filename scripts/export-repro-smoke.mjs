import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

const sourceArgument = process.argv.find((item) =>
  item.startsWith("--source="),
);
const bindingArgument = process.argv.find((item) =>
  item.startsWith("--binding="),
);
const reportArgument = process.argv.find((item) =>
  item.startsWith("--report="),
);
const source =
  sourceArgument?.slice("--source=".length) ??
  "fixtures/valid/returning-home.air.json";
const binding =
  bindingArgument?.slice("--binding=".length) ??
  "engineering-audition-transparent@0";
const reportPath = resolve(
  reportArgument?.slice("--report=".length) ??
    "tmp/export-repro-smoke-report.json",
);

await mkdir(resolve("tmp"), { recursive: true });
const workingRoot = await mkdtemp(resolve("tmp/export-repro-smoke-"));
const firstOutput = resolve(workingRoot, "first");
const secondOutput = resolve(workingRoot, "second");

async function exportOnce(output) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(
    command,
    [
      "run",
      "export:air",
      "--",
      source,
      `--binding=${binding}`,
      `--out=${output}`,
    ],
    { stdio: "inherit" },
  );
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  if (exitCode !== 0)
    throw new Error(`Export reproducibility run exited with ${exitCode}.`);
}

await exportOnce(firstOutput);
await exportOnce(secondOutput);

const firstFiles = (await readdir(firstOutput)).sort();
const secondFiles = (await readdir(secondOutput)).sort();
if (JSON.stringify(firstFiles) !== JSON.stringify(secondFiles))
  throw new Error("Repeated exports emitted different file sets.");

const files = [];
for (const filename of firstFiles) {
  const [firstBytes, secondBytes] = await Promise.all([
    readFile(resolve(firstOutput, filename)),
    readFile(resolve(secondOutput, filename)),
  ]);
  if (!firstBytes.equals(secondBytes))
    throw new Error(`Repeated export bytes differ for ${filename}.`);
  files.push({
    filename,
    bytes: firstBytes.byteLength,
    sha256: createHash("sha256").update(firstBytes).digest("hex"),
  });
}

const report = {
  format: "refrain-export-repro-report@0-experimental",
  source,
  binding,
  fileCount: files.length,
  files,
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `export reproducibility: ${files.length} byte-identical files\n`,
);
