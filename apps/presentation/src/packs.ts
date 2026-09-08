import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalPackManager } from "@refrain/soundpack/pack-manager";
import { PROOF_EXTENSION_PACKS } from "@refrain/soundpack/proof-packs";

function optionsOf(args: readonly string[]): Map<string, string[]> {
  const options = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith("--")) continue;
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw new Error(`Option ${token} needs a value.`);
    const key = token.slice(2);
    options.set(key, [...(options.get(key) ?? []), value]);
    index += 1;
  }
  return options;
}

function required(options: Map<string, string[]>, key: string): string {
  const value = options.get(key)?.at(-1);
  if (!value) throw new Error(`Missing --${key}.`);
  return value;
}

function help(): string {
  return [
    "Refrain local extension packs",
    "",
    "  refrain-packs proofs",
    "  refrain-packs list --root <absolute-root>",
    "  refrain-packs install --root <absolute-root> --source <pack-directory>",
    "  refrain-packs shelf --root <root> --pack-id <id> --version <version> --active <true|false>",
    "  refrain-packs hydrate --root <root> --pack-id <id> --version <version> --asset <id> [--asset <id>]",
    "  refrain-packs pin --root <root> --archive <sha256:id> --pack-id <id> --version <version> --pack-sha256 <hex>",
    "  refrain-packs unpin --root <root> --archive <sha256:id>",
    "  refrain-packs uninstall --root <root> --pack-id <id> --version <version>",
    "",
    "Install records metadata only. hydrate verifies exact selected bytes. shelf changes discoverability only. uninstall refuses archive pins.",
  ].join("\n");
}

export async function runPackCli(args: readonly string[]): Promise<unknown> {
  const [command, ...rest] = args;
  if (!command || command === "help" || command === "--help") return help();
  if (command === "proofs")
    return PROOF_EXTENSION_PACKS.map((pack) => ({
      id: pack.id,
      version: pack.version,
      label: pack.label,
      contentSha256: pack.contentSha256,
      modules: pack.modules.length,
      assets: pack.assets.length,
      bytes: pack.assets.reduce((total, asset) => total + asset.bytes, 0),
    }));
  const options = optionsOf(rest);
  const manager = new LocalPackManager(resolve(required(options, "root")));
  if (command === "list") return manager.list();
  if (command === "install")
    return manager.install(resolve(required(options, "source")));
  const packId = () => required(options, "pack-id");
  const version = () => required(options, "version");
  if (command === "shelf") {
    const active = required(options, "active");
    if (active !== "true" && active !== "false")
      throw new Error("--active must be true or false.");
    await manager.setShelf(packId(), version(), active === "true");
    return manager.list();
  }
  if (command === "hydrate") {
    const assets = options.get("asset") ?? [];
    if (assets.length === 0)
      throw new Error("hydrate needs at least one --asset.");
    return manager.hydrate(packId(), version(), assets);
  }
  if (command === "pin") {
    await manager.pinArchive(required(options, "archive"), [
      {
        packId: packId(),
        version: version(),
        packSha256: required(options, "pack-sha256"),
      },
    ]);
    return manager.list();
  }
  if (command === "unpin") {
    await manager.unpinArchive(required(options, "archive"));
    return manager.list();
  }
  if (command === "uninstall") {
    await manager.uninstall(packId(), version());
    return manager.list();
  }
  throw new Error(`Unknown pack command ${command}.\n\n${help()}`);
}

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  runPackCli(process.argv.slice(2))
    .then((value) => {
      process.stdout.write(
        typeof value === "string"
          ? `${value}\n`
          : `${JSON.stringify(value, null, 2)}\n`,
      );
    })
    .catch((cause: unknown) => {
      process.stderr.write(
        `${cause instanceof Error ? cause.message : String(cause)}\n`,
      );
      process.exitCode = 1;
    });
}
