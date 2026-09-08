import { skybridge } from "skybridge/vite";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [skybridge()],
  // The local MCP host lane executes the exact production view bundle but
  // deliberately excludes the ordinary browser surface's ignored sampled
  // projection. Production package builds keep the existing public directory.
  publicDir: process.env.REFRAIN_MCP_HOST_BUILD === "1" ? false : undefined,
  resolve: {
    alias: {
      // The private MCP Canvas is a zero-asset direct-nodes build. Keep the
      // sampled/SoundFont runtime in the ordinary browser build instead of
      // shipping unreachable code inside every resources/read response.
      spessasynth_lib: fileURLToPath(
        new URL("./src/unsupported-sampled-playback.ts", import.meta.url),
      ),
      spessasynth_core: fileURLToPath(
        new URL("./src/unsupported-sampled-playback.ts", import.meta.url),
      ),
    },
  },
  build: {
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  server: {
    port: 4319,
    strictPort: true,
    forwardConsole: {
      unhandledErrors: true,
      logLevels: ["error"],
    },
  },
});
