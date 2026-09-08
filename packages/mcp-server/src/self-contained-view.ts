import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const VIEW_MANIFEST_PATH = path.join(
  "dist",
  "assets",
  ".vite",
  "manifest.json",
);

const VIEW_MIME_TYPE = "text/html;profile=mcp-app";
const VIEW_URI = "ui://refrain/hum/v3.html";
const CHATGPT_FILE_DOWNLOAD_ORIGIN = "https://files.oaiusercontent.com";

interface ViewManifestEntry {
  file?: string;
}

interface ViewManifest {
  "skybridge:view:hum"?: ViewManifestEntry;
  "style.css"?: ViewManifestEntry;
}

export interface SelfContainedHumView {
  uri: string;
  mimeType: typeof VIEW_MIME_TYPE;
  html: string;
  bytes: number;
  meta: Record<string, unknown>;
}

export function selfContainedHumViewMeta(): Record<string, unknown> {
  const description = "Hear and inspect one Refrain air.";
  return {
    ui: {
      description,
      prefersBorder: false,
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
    "openai/widgetDescription": description,
    "openai/widgetCSP": {
      connect_domains: [],
      resource_domains: [],
      frame_domains: [],
      redirect_domains: [CHATGPT_FILE_DOWNLOAD_ORIGIN],
    },
  };
}

function escapeClosingTag(source: string, tag: "script" | "style"): string {
  return source.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
}

function requiredManifestFile(
  manifest: ViewManifest,
  key: keyof ViewManifest,
): string {
  const file = manifest[key]?.file;
  if (!file) {
    throw new Error(
      `The production MCP Canvas manifest is missing ${JSON.stringify(key)}.`,
    );
  }
  return file;
}

export function loadSelfContainedHumView(
  root = process.cwd(),
): SelfContainedHumView {
  const assetsRoot = path.join(root, "dist", "assets");
  const manifestPath = path.join(root, VIEW_MANIFEST_PATH);
  if (!existsSync(manifestPath)) {
    throw new Error(
      "The MCP Canvas is not built. Run npm run build:mcp-host from the Refrain repository, then restart the MCP connection.",
    );
  }
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as ViewManifest;
  const script = readFileSync(
    path.join(assetsRoot, requiredManifestFile(manifest, "skybridge:view:hum")),
    "utf8",
  );
  const style = readFileSync(
    path.join(assetsRoot, requiredManifestFile(manifest, "style.css")),
    "utf8",
  );
  const html = [
    '<div id="root"></div>',
    `<style>${escapeClosingTag(style, "style")}</style>`,
    '<script type="module">',
    'window.skybridge = { hostType: "mcp-app" };',
    escapeClosingTag(script, "script"),
    "</script>",
  ].join("\n");
  const meta = selfContainedHumViewMeta();
  return {
    uri: VIEW_URI,
    mimeType: VIEW_MIME_TYPE,
    html,
    bytes: Buffer.byteLength(html),
    meta,
  };
}
