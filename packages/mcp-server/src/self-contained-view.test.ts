import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadSelfContainedHumView,
  selfContainedHumViewMeta,
} from "./self-contained-view.js";

describe("self-contained Canvas metadata", () => {
  it("explains the build prerequisite for a fresh source installation", () => {
    const root = mkdtempSync(path.join(tmpdir(), "refrain-unbuilt-view-"));
    try {
      expect(() => loadSelfContainedHumView(root)).toThrow(
        "Run npm run build:mcp-host",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows no embedded network and only the ChatGPT file redirect", () => {
    expect(selfContainedHumViewMeta()).toMatchObject({
      ui: {
        permissions: {
          clipboardWrite: {},
        },
        csp: {
          resourceDomains: [],
          connectDomains: [],
          frameDomains: [],
          baseUriDomains: [],
        },
      },
      "openai/widgetCSP": {
        connect_domains: [],
        resource_domains: [],
        frame_domains: [],
        redirect_domains: ["https://files.oaiusercontent.com"],
      },
    });
  });

  it("uses one explicit App contract URI instead of a build-derived pointer", () => {
    const root = mkdtempSync(path.join(tmpdir(), "refrain-view-"));
    try {
      const assets = path.join(root, "dist", "assets");
      mkdirSync(path.join(assets, ".vite"), { recursive: true });
      writeFileSync(
        path.join(assets, ".vite", "manifest.json"),
        JSON.stringify({
          "skybridge:view:hum": { file: "hum.js" },
          "style.css": { file: "style.css" },
        }),
      );
      writeFileSync(path.join(assets, "hum.js"), "document.title='Refrain';");
      writeFileSync(
        path.join(assets, "style.css"),
        ":root{color-scheme:light}",
      );

      const first = loadSelfContainedHumView(root);
      expect(first.uri).toBe("ui://refrain/hum/v3.html");

      writeFileSync(path.join(assets, "hum.js"), "document.title='Changed';");
      const changed = loadSelfContainedHumView(root);
      expect(changed.html).not.toBe(first.html);
      expect(changed.uri).toBe(first.uri);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
