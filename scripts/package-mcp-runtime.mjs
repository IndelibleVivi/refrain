import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const arguments_ = process.argv.slice(2);

function readOutputArgument() {
  const equalsArgument = arguments_.find((argument) =>
    argument.startsWith("--out="),
  );
  const outputIndex = arguments_.indexOf("--out");
  const output =
    equalsArgument?.slice("--out=".length) ??
    (outputIndex >= 0 ? arguments_[outputIndex + 1] : undefined);

  if (!output || output.startsWith("--"))
    throw new Error(
      "Usage: npm run mcp:package -- --out=tmp/refrain-mcp-runtime",
    );

  const consumed = new Set(
    outputIndex >= 0 ? [outputIndex, outputIndex + 1] : [],
  );
  const unknown = arguments_.filter(
    (argument, index) => !consumed.has(index) && argument !== equalsArgument,
  );
  if (unknown.length > 0)
    throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);

  return isAbsolute(output) ? output : resolve(repositoryRoot, output);
}

function command(file, args, cwd, options = {}) {
  return execFileSync(file, args, {
    cwd,
    encoding: "utf8",
    ...options,
  });
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function requirePath(sourceRoot, path) {
  const absolute = join(sourceRoot, path);
  if (!(await exists(absolute)))
    throw new Error(`Clean build did not produce ${path}.`);
}

async function copyWorkspaceManifests(sourceRoot, workspaceRoot, stagingRoot) {
  const names = await readdir(join(sourceRoot, workspaceRoot));
  for (const name of names.sort()) {
    const source = join(sourceRoot, workspaceRoot, name, "package.json");
    if (!(await exists(source))) continue;
    const destination = join(stagingRoot, workspaceRoot, name, "package.json");
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

async function copyPackageBuilds(sourceRoot, stagingRoot) {
  const names = await readdir(join(sourceRoot, "packages"));
  for (const name of names.sort()) {
    const manifest = join(sourceRoot, "packages", name, "package.json");
    if (!(await exists(manifest))) continue;
    const build = join(sourceRoot, "packages", name, "dist");
    await requirePath(sourceRoot, `packages/${name}/dist`);
    await cp(build, join(stagingRoot, "packages", name, "dist"), {
      recursive: true,
    });
  }
}

async function runtimeFiles(root, excluded = new Set()) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        const path = relative(root, absolute).replaceAll("\\", "/");
        if (!excluded.has(path)) files.push({ path, absolute });
      }
    }
  }
  await visit(root);
  const manifest = [];
  for (const file of files) {
    const bytes = await readFile(file.absolute);
    manifest.push({
      path: file.path,
      bytes: (await stat(file.absolute)).size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return manifest;
}

function sha256Id(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function materializeDockerfile(
  stagingRoot,
  sourceRevision,
  bundleDigest,
) {
  const path = join(stagingRoot, "deploy/runtime/Dockerfile");
  const template = await readFile(path, "utf8");
  const materialized = template
    .replaceAll("@@REFRAIN_SOURCE_REVISION@@", sourceRevision)
    .replaceAll("@@REFRAIN_BUNDLE_DIGEST@@", bundleDigest);
  if (materialized.includes("@@REFRAIN_"))
    throw new Error("The runtime Dockerfile contains an unresolved identity.");
  await writeFile(path, materialized);
}

const outputRoot = readOutputArgument();
if (outputRoot === repositoryRoot)
  throw new Error("The runtime output cannot be the repository root.");
if (await exists(outputRoot))
  throw new Error(`Refusing to overwrite existing output: ${outputRoot}`);

const dirty = command(
  "git",
  ["status", "--porcelain", "--untracked-files=all"],
  repositoryRoot,
).trim();
if (dirty)
  throw new Error(
    `Refusing to package a dirty source tree. Commit or remove these paths first:\n${dirty}`,
  );

const sourceRevision = command(
  "git",
  ["rev-parse", "HEAD"],
  repositoryRoot,
).trim();
const stagingRoot = `${outputRoot}.staging-${process.pid}`;
if (await exists(stagingRoot))
  throw new Error(`Refusing to reuse existing staging output: ${stagingRoot}`);

const temporaryRoot = await mkdtemp(join(tmpdir(), "refrain-mcp-package-"));
const cleanSourceRoot = join(temporaryRoot, "source");
let worktreeAdded = false;

try {
  command(
    "git",
    ["worktree", "add", "--detach", cleanSourceRoot, sourceRevision],
    repositoryRoot,
    { stdio: "inherit" },
  );
  worktreeAdded = true;
  command("npm", ["ci", "--ignore-scripts"], cleanSourceRoot, {
    stdio: "inherit",
  });
  command(
    "npm",
    ["run", "soundpack:fetch", "--", "--profile", "e-vsco-wind-pilots@1"],
    cleanSourceRoot,
    { stdio: "inherit" },
  );
  command("npm", ["run", "build"], cleanSourceRoot, { stdio: "inherit" });

  const requiredBuildInputs = [
    "packages/mcp-server/dist/__entry.js",
    "packages/mcp-server/dist/vite-manifest.js",
    "packages/mcp-server/dist/assets/soundpacks/GeneralUser-GS.sf2",
    "packages/mcp-server/dist/assets/spessasynth_processor.min.js",
  ];
  for (const input of requiredBuildInputs)
    await requirePath(cleanSourceRoot, input);

  await mkdir(stagingRoot, { recursive: true });
  await copyFile(
    join(cleanSourceRoot, "package.json"),
    join(stagingRoot, "package.json"),
  );
  await copyFile(
    join(cleanSourceRoot, "package-lock.json"),
    join(stagingRoot, "package-lock.json"),
  );
  // Every distributed runtime carries the selected grants and upstream notices.
  for (const file of [
    "LICENSE",
    "LICENSE-CONTENT",
    "LICENSING.md",
    "docs/SOUND-SOURCES.md",
  ]) {
    await mkdir(dirname(join(stagingRoot, file)), { recursive: true });
    await copyFile(join(cleanSourceRoot, file), join(stagingRoot, file));
  }
  await cp(
    join(cleanSourceRoot, "third_party"),
    join(stagingRoot, "third_party"),
    {
      recursive: true,
    },
  );
  await copyWorkspaceManifests(cleanSourceRoot, "apps", stagingRoot);
  await copyWorkspaceManifests(cleanSourceRoot, "packages", stagingRoot);
  await copyPackageBuilds(cleanSourceRoot, stagingRoot);

  await mkdir(join(stagingRoot, "scripts"), { recursive: true });
  await copyFile(
    join(cleanSourceRoot, "scripts/start-mcp.mjs"),
    join(stagingRoot, "scripts/start-mcp.mjs"),
  );
  await cp(join(cleanSourceRoot, "deploy"), join(stagingRoot, "deploy"), {
    recursive: true,
  });

  const bundleScope = ["release.json", "deploy/runtime/Dockerfile"];
  const payloadFiles = await runtimeFiles(stagingRoot, new Set(bundleScope));
  const bundleDigest = sha256Id(JSON.stringify(payloadFiles));
  await materializeDockerfile(stagingRoot, sourceRevision, bundleDigest);
  const files = await runtimeFiles(stagingRoot, new Set(["release.json"]));
  await writeFile(
    join(stagingRoot, "release.json"),
    `${JSON.stringify(
      {
        format: "refrain-mcp-runtime@1-experimental",
        sourceRevision,
        sourceDirty: false,
        bundleDigest,
        bundleDigestScope: {
          algorithm: "sha256",
          canonical: "JSON.stringify(payloadFiles)",
          excluded: bundleScope,
        },
        files,
        entrypoint: "scripts/start-mcp.mjs",
        mcpEndpoint: "/mcp",
        healthEndpoint: "/healthz",
      },
      null,
      2,
    )}\n`,
  );

  await mkdir(dirname(outputRoot), { recursive: true });
  await rename(stagingRoot, outputRoot);
  console.log(
    JSON.stringify(
      {
        output: outputRoot,
        sourceRevision,
        bundleDigest,
        soundProfile: "e-vsco-wind-pilots@1",
        dockerfile: join(outputRoot, "deploy/runtime/Dockerfile"),
        build: `docker build --file deploy/runtime/Dockerfile --tag refrain-mcp:${sourceRevision.slice(0, 12)} .`,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await rm(stagingRoot, { recursive: true, force: true });
  throw error;
} finally {
  if (worktreeAdded)
    command(
      "git",
      ["worktree", "remove", "--force", cleanSourceRoot],
      repositoryRoot,
      { stdio: "ignore" },
    );
  await rm(temporaryRoot, { recursive: true, force: true });
}
