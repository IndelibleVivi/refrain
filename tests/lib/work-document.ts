import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRefrainArtifactV3 } from "../../packages/renderer/src/portable.js";
import { createRootReceiptV1 } from "../../packages/renderer/src/v1.js";
import { F_SYNTHETIC_BEAT_PERFORMANCE_BINDING as binding } from "../../packages/soundpack/src/index.js";
import {
  applyProduction,
  initProduction,
} from "../../apps/presentation/src/production.js";

/** Real exporter + production path; all music and files are disposable synthetic fixtures. */
export async function makeWorkDocument() {
  const directory = await mkdtemp(join(tmpdir(), "refrain-custody-"));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const source = JSON.parse(
      await readFile("fixtures/air-v1/synthetic-counterpulse.air.json", "utf8"),
    );
    const root = createRefrainArtifactV3({
      source,
      receipt: createRootReceiptV1(source),
      performanceBinding: binding,
      caption: "",
    });
    const input = join(directory, "root.refrain.json");
    await writeFile(input, JSON.stringify(root));
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          resolve("bin/refrain.mjs"),
          "export",
          input,
          "--out",
          join(directory, "export"),
          "--json",
        ],
        { encoding: "utf8" },
      ),
    );
    const exported = JSON.parse(
      await readFile(join(result.directory, result.files.artifact), "utf8"),
    );
    const settings = initProduction(exported, "custody-treatment@1");
    settings.scene.master.gainDb -= 2;
    return {
      document: applyProduction(exported, settings),
      originalBindingId: binding.id,
      cleanup,
    };
  } catch (cause) {
    await cleanup();
    throw cause;
  }
}
