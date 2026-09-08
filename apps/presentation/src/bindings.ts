import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILT_IN_PERFORMANCE_BINDINGS } from "@refrain/soundpack";

export function builtInBindingRows() {
  return BUILT_IN_PERFORMANCE_BINDINGS.map((binding) => ({
    id: binding.id,
    format: binding.format,
    soundProfile: binding.soundProfile.id,
    renderScene: binding.renderScene.id,
    soundPalette: binding.soundPalette?.id ?? null,
    instruments: Object.keys(binding.soundProfile.selections),
    authoringGuide: binding.soundPalette?.authoringGuide ?? null,
    renderer: binding.renderer.contract,
    performancePlan: binding.renderer.performancePlanFormat,
    adapters: binding.renderer.adapters,
  }));
}

export function runBindingsCli(args: readonly string[]): string {
  const unknown = args.filter((argument) => argument !== "--json");
  if (unknown.length > 0)
    throw new Error(`Unknown bindings option ${unknown[0]}.`);
  const rows = builtInBindingRows();
  if (args.includes("--json"))
    return JSON.stringify({ ok: true, bindings: rows });
  return [
    "Built-in exact PerformanceBindings",
    "",
    ...rows.map(
      (binding) =>
        `${binding.id}\n  ${binding.soundProfile} · ${binding.renderScene} · ${binding.renderer}`,
    ),
  ].join("\n");
}

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    process.stdout.write(`${runBindingsCli(process.argv.slice(2))}\n`);
  } catch (cause) {
    process.stderr.write(
      `${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    process.exitCode = 1;
  }
}
