import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_EVENTS,
  MAX_EXPANDED_ATOMS,
  MAX_SCORE_SECONDS,
  MAX_SOURCE_BYTES,
  MAX_VOICES,
} from "@refrain/air-schema";
import {
  AIR_V1_FORMAT,
  createAirVocabularyClosure,
} from "@refrain/air-schema/v1";
import { MAX_MOTIF_DEPTH } from "@refrain/compiler";
import {
  F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
  INSTRUMENTS,
  candidateForInstrument,
} from "@refrain/soundpack";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(repositoryRoot, "plugins", "refrain");
const contractPath = join(
  pluginRoot,
  "skills",
  "refrain-air-authoring",
  "references",
  "current-contract.md",
);
const skillPath = join(
  pluginRoot,
  "skills",
  "refrain-air-authoring",
  "SKILL.md",
);
const zeroAssetVocabularyPath = join(
  pluginRoot,
  "skills",
  "refrain-air-authoring",
  "references",
  "zero-asset-vocabulary.json",
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const manifest = JSON.parse(
  await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"),
) as Record<string, unknown>;
assert(manifest.name === "refrain", "Plugin manifest name must be refrain.");
assert(
  typeof manifest.version === "string" &&
    /^\d+\.\d+\.\d+$/.test(manifest.version),
  "Plugin manifest version must be strict semver.",
);
assert(manifest.skills === "./skills/", "Plugin skills path drifted.");
assert(
  manifest.license === "SEE LICENSE IN ../../LICENSING.md",
  "Plugin license must point to the layered rights map.",
);
assert(!("apps" in manifest), "Do not declare .app.json before it exists.");
assert(
  !("mcpServers" in manifest),
  "Do not declare a public MCP connection before it exists.",
);

const pluginFiles = await filesUnder(pluginRoot);
for (const path of pluginFiles) {
  const text = await readFile(path, "utf8");
  assert(
    !text.includes("[TODO"),
    `${relative(repositoryRoot, path)} has TODO text.`,
  );
  assert(
    !text.includes("/Users/") && !text.includes("/Volumes/"),
    `${relative(repositoryRoot, path)} leaks a local absolute path.`,
  );
  assert(
    !text.includes("plugin_asdk_app") && !text.includes("usw2"),
    `${relative(repositoryRoot, path)} contains private runtime identity.`,
  );
}

const contract = await readFile(contractPath, "utf8");
const skill = await readFile(skillPath, "utf8");
const defaultBinding = F_SYNTHETIC_BEAT_PERFORMANCE_BINDING;
const synthInstruments = Object.entries(defaultBinding.soundProfile.selections)
  .filter(([instrumentId, selection]) =>
    selection.candidateChain.every(
      (pin) => candidateForInstrument(instrumentId, pin.id).engine === "synth",
    ),
  )
  .map(([instrumentId]) => instrumentId)
  .sort();

const expectedZeroAssetVocabulary = createAirVocabularyClosure({
  id: "refrain-zero-asset-canvas@1",
  instruments: synthInstruments.map((instrumentId) => {
    const instrument = INSTRUMENTS.find((item) => item.id === instrumentId);
    assert(instrument, `Missing canonical instrument ${instrumentId}.`);
    return {
      ...instrument,
      ...(instrument.supportedNotes === undefined
        ? {}
        : { supportedNotes: Array.from(instrument.supportedNotes) }),
    };
  }),
  techniques: [],
});
const packagedZeroAssetVocabulary = JSON.parse(
  await readFile(zeroAssetVocabularyPath, "utf8"),
);
assert(
  JSON.stringify(packagedZeroAssetVocabulary) ===
    JSON.stringify(expectedZeroAssetVocabulary),
  "Packaged zero-asset vocabulary drifted from canonical source.",
);

for (const expected of [
  AIR_V1_FORMAT,
  "refrain-artifact@3-experimental",
  defaultBinding.id,
  ...synthInstruments,
  MAX_SOURCE_BYTES.toLocaleString("en-US"),
  MAX_SCORE_SECONDS.toLocaleString("en-US"),
  MAX_VOICES.toLocaleString("en-US"),
  MAX_EVENTS.toLocaleString("en-US"),
  MAX_EXPANDED_ATOMS.toLocaleString("en-US"),
  MAX_MOTIF_DEPTH.toLocaleString("en-US"),
  "refrain --json doctor",
  "refrain --json bindings list",
  "refrain fetch",
  "refrain open",
  "refrain export",
  "refrain packs",
  "refrain mcp stdio",
])
  assert(
    contract.includes(expected),
    `Plugin contract reference misses ${expected}.`,
  );

for (const expected of [
  "callable MCP `hum`",
  "refrain --json doctor",
  "refrain open",
  "refrain export",
  "refrain mcp stdio",
])
  assert(skill.includes(expected), `Plugin Skill misses ${expected}.`);

const tests = JSON.parse(
  await readFile(join(pluginRoot, "submission", "test-cases.json"), "utf8"),
) as { positive?: unknown[]; negative?: unknown[] };
assert(
  tests.positive?.length === 5,
  "Submission packet needs 5 positive cases.",
);
assert(
  tests.negative?.length === 3,
  "Submission packet needs 3 negative cases.",
);

const listing = JSON.parse(
  await readFile(join(pluginRoot, "submission", "listing.json"), "utf8"),
) as { status?: string; publicationReady?: boolean };
assert(
  listing.status === "local-candidate",
  "Listing must remain a local candidate.",
);
assert(
  listing.publicationReady === false,
  "Listing must not claim publication readiness.",
);

const serverFactory = await readFile(
  join(repositoryRoot, "packages", "mcp-server", "src", "server-factory.ts"),
  "utf8",
);
for (const annotation of [
  "readOnlyHint: true",
  "openWorldHint: false",
  "destructiveHint: false",
  'securitySchemes: [{ type: "noauth" }]',
])
  assert(
    serverFactory.includes(annotation),
    `hum metadata drifted: ${annotation}`,
  );

const viewSource = await readFile(
  join(
    repositoryRoot,
    "packages",
    "mcp-server",
    "src",
    "self-contained-view.ts",
  ),
  "utf8",
);
assert(
  viewSource.includes('const VIEW_URI = "ui://refrain/hum/v3.html"'),
  "Plugin reference expects the current one-resource v3 Canvas.",
);

console.log(
  `Refrain Plugin candidate is internally consistent (${pluginFiles.length} files, ${synthInstruments.length} zero-asset instruments, 5 positive + 3 negative cases).`,
);
