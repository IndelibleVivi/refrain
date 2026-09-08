import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === "try"
      ? [
          {
            name: "first-listen-notices",
            generateBundle(_options, bundle) {
              for (const name of [
                "LICENSE",
                "LICENSE-CONTENT",
                "LICENSING.md",
              ]) {
                this.emitFile({
                  type: "asset",
                  fileName: name,
                  source: readFileSync(
                    new URL(`../../${name}`, import.meta.url),
                    "utf8",
                  ),
                });
              }
              const packages = new Set<string>();
              for (const output of Object.values(bundle)) {
                if (output.type !== "chunk") continue;
                for (const id of Object.keys(output.modules)) {
                  if (id.startsWith("\0")) continue;
                  const marker = "/node_modules/";
                  const index = id.lastIndexOf(marker);
                  if (index < 0) continue;
                  const parts = id.slice(index + marker.length).split("/");
                  const name = parts[0]!.startsWith("@")
                    ? parts.slice(0, 2).join("/")
                    : parts[0]!;
                  packages.add(id.slice(0, index + marker.length) + name);
                }
              }
              const notices = Array.from(packages)
                .sort()
                .map((root) => {
                  const pkg = JSON.parse(
                    readFileSync(`${root}/package.json`, "utf8"),
                  );
                  return `${pkg.name} ${pkg.version}\n\n${readFileSync(`${root}/LICENSE`, "utf8")}`;
                });
              this.emitFile({
                type: "asset",
                fileName: "THIRD-PARTY-NOTICES.txt",
                source: notices.join(
                  "\n\n----------------------------------------\n\n",
                ),
              });
            },
          } satisfies Plugin,
        ]
      : []),
  ],
  ...(mode === "try"
    ? {
        base: "./",
        publicDir: false,
        build: { outDir: "dist-try" },
        resolve: {
          alias: {
            // Reuse the existing zero-asset Canvas guard; no SoundFont code is needed.
            spessasynth_lib: fileURLToPath(
              new URL(
                "../../packages/mcp-server/src/unsupported-sampled-playback.ts",
                import.meta.url,
              ),
            ),
            spessasynth_core: fileURLToPath(
              new URL(
                "../../packages/mcp-server/src/unsupported-sampled-playback.ts",
                import.meta.url,
              ),
            ),
          },
        },
      }
    : {}),
  server: { port: 4318, strictPort: mode !== "try", open: mode === "try" },
}));
