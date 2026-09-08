import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const helper = join(
  repositoryRoot,
  "deploy/openai-tunnel/refrain-tunnel-preflight",
);
const servicePath = join(
  repositoryRoot,
  "deploy/openai-tunnel/refrain-gpt-tunnel.service",
);
const releaseIdentity = JSON.stringify({
  status: "ok",
  server: "Refrain",
  bundleDigest: `sha256:${"a".repeat(64)}`,
});

const temporaryRoots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function listen(
  respond: (path: string) => { status: number; body?: string },
  port = 0,
): Promise<number> {
  const server = createServer((request, response) => {
    const reply = respond(request.url ?? "");
    response.writeHead(reply.status, { "content-type": "application/json" });
    response.end(reply.body ?? "");
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fake origin did not expose a TCP port.");
  return address.port;
}

async function profileFor(port: number): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "refrain-tunnel-preflight-"));
  temporaryRoots.push(root);
  const profile = join(root, "profile.yaml");
  await writeFile(
    profile,
    [
      "config_version: 1",
      "mcp:",
      "  server_urls:",
      "    - channel: main",
      `      url: \"http://127.0.0.1:${port}/mcp\"`,
      "",
    ].join("\n"),
  );
  return profile;
}

async function runPreflight(
  profile: string,
  timeoutMs = 1_000,
): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  timedOut: boolean;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", [helper, profile, "0.02"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let timedOut = false;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stderr, timedOut });
    });
  });
}

describe("Refrain tunnel startup preflight", () => {
  it("derives a non-default exact MCP target from the credential profile", async () => {
    const requested: string[] = [];
    const port = await listen((path) => {
      requested.push(path);
      if (path === "/mcp") return { status: 405 };
      if (path === "/healthz") return { status: 200, body: releaseIdentity };
      return { status: 404 };
    });

    const result = await runPreflight(await profileFor(port));

    expect(result).toMatchObject({ code: 0, timedOut: false, stderr: "" });
    expect(requested).toContain("/mcp");
    expect(requested).toContain("/healthz");
  });

  it("does not accept a healthy decoy when the configured target is absent", async () => {
    let decoyRequests = 0;
    await listen(() => {
      decoyRequests += 1;
      return { status: 200, body: releaseIdentity };
    }, 18_101);
    const closedPort = await listen(() => ({ status: 200 }));
    await new Promise<void>((resolve, reject) =>
      servers.pop()!.close((error) => (error ? reject(error) : resolve())),
    );

    const result = await runPreflight(await profileFor(closedPort), 180);

    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
    expect(result.signal).toBe("SIGTERM");
    expect(decoyRequests).toBe(0);
  });

  it("keeps waiting while the configured MCP target returns 5xx", async () => {
    let requests = 0;
    const port = await listen((path) => {
      requests += 1;
      if (path === "/healthz") return { status: 200, body: releaseIdentity };
      return { status: 500 };
    });

    const result = await runPreflight(await profileFor(port), 180);

    expect(result.timedOut).toBe(true);
    expect(requests).toBeGreaterThan(0);
  });

  it("does not treat a missing /mcp route as protocol-ready", async () => {
    let requests = 0;
    const port = await listen((path) => {
      requests += 1;
      if (path === "/healthz") return { status: 200, body: releaseIdentity };
      return { status: 404 };
    });

    const result = await runPreflight(await profileFor(port), 180);

    expect(result.timedOut).toBe(true);
    expect(requests).toBeGreaterThan(0);
  });

  it("succeeds when the configured target recovers from 503 to a protocol response", async () => {
    let mcpRequests = 0;
    const port = await listen((path) => {
      if (path === "/healthz") return { status: 200, body: releaseIdentity };
      mcpRequests += 1;
      return { status: mcpRequests === 1 ? 503 : 400 };
    });

    const result = await runPreflight(await profileFor(port));

    expect(result).toMatchObject({ code: 0, timedOut: false, stderr: "" });
    expect(mcpRequests).toBe(2);
  });

  it("keeps one credential profile authority in both systemd commands", async () => {
    const service = await readFile(servicePath, "utf8");
    const preflight = service
      .split("\n")
      .find((line) => line.startsWith("ExecStartPre="));
    const start = service
      .split("\n")
      .find((line) => line.startsWith("ExecStart="));

    expect(service).toContain(
      "LoadCredential=profile.yaml:/etc/refrain-tunnel/profile.yaml",
    );
    expect(preflight).toBe(
      "ExecStartPre=/usr/bin/timeout 60s /usr/local/libexec/refrain-tunnel-preflight %d/profile.yaml",
    );
    expect(start).toContain("--profile-file %d/profile.yaml");
    expect(preflight).not.toContain("18101");
    expect(preflight).not.toContain("/etc/refrain-tunnel/profile.yaml");
  });

  it("keeps the reference 18101 profile compatible", async () => {
    const port = await listen(
      (path) =>
        path === "/mcp"
          ? { status: 405 }
          : { status: 200, body: releaseIdentity },
      18_101,
    );

    const result = await runPreflight(await profileFor(port));

    expect(port).toBe(18_101);
    expect(result).toMatchObject({ code: 0, timedOut: false, stderr: "" });
  });
});
