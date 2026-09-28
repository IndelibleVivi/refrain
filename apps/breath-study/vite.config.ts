import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  publicDir: false,
  worker: { format: "es" },
});
