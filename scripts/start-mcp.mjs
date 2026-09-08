import { fileURLToPath } from "node:url";

const arguments_ = process.argv.slice(2);
const portIndex = arguments_.findIndex(
  (argument) => argument === "--port" || argument === "-p",
);
const port =
  portIndex >= 0 ? arguments_[portIndex + 1] : (process.env.__PORT ?? "3000");

if (!port || !/^\d+$/.test(port)) {
  throw new Error(
    "Usage: npm start --workspace @refrain/mcp-server -- [--port 3000]",
  );
}

process.env.__PORT = port;
process.env.NODE_ENV = "production";
process.chdir(
  fileURLToPath(new URL("../packages/mcp-server", import.meta.url)),
);
await import("../packages/mcp-server/dist/__entry.js");
