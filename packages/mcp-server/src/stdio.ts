import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRefrainServer } from "./server-factory.js";

const server = createRefrainServer();
await server.connect(new StdioServerTransport());
