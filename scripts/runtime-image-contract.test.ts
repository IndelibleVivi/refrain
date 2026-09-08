import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const execFileAsync = promisify(execFile);

describe("packaged runtime image contract", () => {
  it("copies every tracked runtime-bundle root represented by release.json", async () => {
    const dockerfile = await readFile(
      `${repositoryRoot}/deploy/runtime/Dockerfile`,
      "utf8",
    );

    expect(dockerfile).toContain("COPY package.json package-lock.json ./");
    expect(dockerfile).toContain("COPY apps ./apps");
    expect(dockerfile).toContain("COPY packages ./packages");
    expect(dockerfile).toContain(
      "COPY scripts/start-mcp.mjs ./scripts/start-mcp.mjs",
    );
    expect(dockerfile).toContain("COPY deploy ./deploy");
    expect(dockerfile).toContain("COPY release.json ./release.json");
  });

  it("defers immutable image validation expansion to the shell", async () => {
    const service = await readFile(
      `${repositoryRoot}/deploy/systemd/refrain-mcp.service`,
      "utf8",
    );

    expect(service).toContain(
      '/usr/bin/printf %%s "$${REFRAIN_IMAGE}" | /bin/grep',
    );
    expect(service).not.toContain(
      '/usr/bin/printf %s "$${REFRAIN_IMAGE}" | /bin/grep',
    );

    const command = service.match(/^ExecStartPre=\/bin\/sh -c '(.*)'$/m)?.[1];
    expect(command).toBeDefined();
    const shellCommand = (command ?? "")
      .replaceAll("%%", "%")
      .replaceAll("$$", "$")
      .replace(
        "/bin/grep",
        existsSync("/bin/grep") ? "/bin/grep" : "/usr/bin/grep",
      );
    const imageId = `sha256:${"a".repeat(64)}`;
    const repositoryDigest = `refrain-mcp@sha256:${"b".repeat(64)}`;
    for (const image of [imageId, repositoryDigest]) {
      await expect(
        execFileAsync("/bin/sh", ["-c", shellCommand], {
          env: { ...process.env, REFRAIN_IMAGE: image },
        }),
      ).resolves.toBeDefined();
    }
    await expect(
      execFileAsync("/bin/sh", ["-c", shellCommand], {
        env: { ...process.env, REFRAIN_IMAGE: "refrain-mcp:latest" },
      }),
    ).rejects.toMatchObject({ code: 1 });
  });
});
