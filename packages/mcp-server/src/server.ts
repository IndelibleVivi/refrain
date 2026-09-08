import { createRefrainServer } from "./server-factory.js";

export const server = createRefrainServer();
export type AppType = typeof server;

export default await server.run();
