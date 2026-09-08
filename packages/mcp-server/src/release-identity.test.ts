import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRuntimeReleaseIdentity } from "./release-identity.js";

describe("runtime release identity", () => {
  it("loads only a clean digest-bearing packaged release", () => {
    const directory = mkdtempSync(join(tmpdir(), "refrain-release-test-"));
    const path = join(directory, "release.json");
    try {
      writeFileSync(
        path,
        JSON.stringify({
          format: "refrain-mcp-runtime@1-experimental",
          sourceRevision: "1".repeat(40),
          sourceDirty: false,
          bundleDigest: `sha256:${"2".repeat(64)}`,
          files: [
            {
              path: "server.js",
              bytes: 42,
              sha256: "3".repeat(64),
            },
          ],
        }),
      );
      expect(loadRuntimeReleaseIdentity(path)).toEqual({
        format: "refrain-mcp-runtime@1-experimental",
        sourceRevision: "1".repeat(40),
        bundleDigest: `sha256:${"2".repeat(64)}`,
        fileCount: 1,
      });
      writeFileSync(
        path,
        JSON.stringify({
          format: "refrain-mcp-runtime@1-experimental",
          sourceRevision: "1".repeat(40),
          sourceDirty: true,
          bundleDigest: `sha256:${"2".repeat(64)}`,
          files: [
            {
              path: "server.js",
              bytes: 42,
              sha256: "3".repeat(64),
            },
          ],
        }),
      );
      expect(() => loadRuntimeReleaseIdentity(path)).toThrow(/clean runtime/);

      writeFileSync(
        path,
        JSON.stringify({
          format: "refrain-mcp-runtime@1-experimental",
          sourceRevision: "1".repeat(40),
          sourceDirty: false,
          bundleDigest: `sha256:${"2".repeat(64)}`,
          files: [
            {
              path: "../outside",
              bytes: 42,
              sha256: "3".repeat(64),
            },
          ],
        }),
      );
      expect(() => loadRuntimeReleaseIdentity(path)).toThrow(/clean runtime/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
