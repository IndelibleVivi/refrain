import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  publicDir: ".audio",
  build: { outDir: "dist" },
});
