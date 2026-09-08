import "@refrain/renderer/styles.css";
import {
  AirRenderer,
  LanguageSwitch,
  useRefrainLocale,
  uiCopy,
  type AnyAirArtifact,
  type DownloadArtifact,
  type RefrainArtifactV3,
} from "@refrain/renderer";
import { presentPortableArtifact } from "@refrain/renderer/artifact-document";
import { compileAnyAir } from "@refrain/compiler/any";
import { performanceBindingShapeIsValid } from "@refrain/soundpack";
import {
  useDownload,
  useFiles,
  useOpenExternal,
  useSendFollowUpMessage,
  useToolInfo,
  useUser,
} from "skybridge/web";
import type { HumInput, HumResult } from "../hum.js";
import type { HumInputV1, HumResultV1, HumSuccessV1 } from "../hum-v1.js";
import { MCP_CANVAS_ASSETS } from "../canvas-runtime.js";
import { exportCanvasArtifact } from "./canvas-export.js";

type HumModelSuccessV1 = Pick<
  HumSuccessV1,
  | "ok"
  | "summary"
  | "diagnostics"
  | "performanceStatus"
  | "caption"
  | "presentation"
> & { artifact: RefrainArtifactV3 };

export default function HumView() {
  const [locale, setLocale] = useRefrainLocale();
  const copy = uiCopy(locale);
  const languageSwitch = (
    <LanguageSwitch locale={locale} onChange={setLocale} />
  );
  const info = useToolInfo<{
    input: Record<string, unknown> & (HumInput | HumInputV1);
    output: Record<string, unknown>;
    responseMetadata: {
      "refrain/canvas"?: HumResult | HumResultV1;
    };
  }>();
  const { download } = useDownload();
  const { upload, getDownloadUrl } = useFiles();
  const openExternal = useOpenExternal();
  const sendFollowUpMessage = useSendFollowUpMessage();
  const { userAgent } = useUser();

  if (!info.isSuccess)
    return (
      <section lang={locale}>
        {languageSwitch}
        <p>{copy.compiling}</p>
      </section>
    );
  const output = (info.responseMetadata["refrain/canvas"] ?? info.output) as
    HumResult | HumResultV1 | HumModelSuccessV1;
  if (!output.ok) {
    return (
      <section lang={locale} aria-label={copy.diagnostics}>
        {languageSwitch}
        <h1>{copy.compileFailed}</h1>
        <ul>
          {output.diagnostics.map((item) => (
            <li key={`${item.code}-${item.path}`}>
              <code>{item.path}</code> — {item.message}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const modelOutput =
    "artifact" in output ? (output as HumModelSuccessV1) : undefined;
  const ordinaryOutput = modelOutput
    ? undefined
    : (output as Extract<HumResult | HumResultV1, { ok: true }>);
  const carriedArtifact = modelOutput?.artifact;
  const source = carriedArtifact
    ? carriedArtifact.source
    : ordinaryOutput!.source;
  const receipt = carriedArtifact
    ? carriedArtifact.receipt
    : ordinaryOutput!.receipt;
  let artifact: AnyAirArtifact;
  if (carriedArtifact) {
    const presented = presentPortableArtifact(carriedArtifact);
    if (!presented.ok)
      return (
        <section lang={locale} aria-label={copy.diagnostics}>
          {languageSwitch}
          <h1>{copy.reconstructionFailed}</h1>
          <p>{presented.message}</p>
        </section>
      );
    artifact = presented.artifact;
  } else {
    const local = compileAnyAir(source);
    if (!local.compiled)
      return (
        <section lang={locale} aria-label={copy.diagnostics}>
          {languageSwitch}
          <h1>{copy.reconstructionFailed}</h1>
          <ul>
            {local.diagnostics.map((item) => (
              <li key={`${item.code}-${item.path}`}>
                {item.path} — {item.message}
              </li>
            ))}
          </ul>
        </section>
      );
    const binding = ordinaryOutput!.performanceBinding;
    const shared = {
      diagnostics: output.diagnostics,
      ...(performanceBindingShapeIsValid(binding)
        ? { performanceBinding: binding }
        : {}),
      ...(output.caption === undefined ? {} : { caption: output.caption }),
    };
    artifact =
      source.format === "air@1-experimental"
        ? {
            ...shared,
            source,
            compiled:
              local.compiled as import("@refrain/compiler/v1").CompiledAirV1,
            receipt: receipt as import("@refrain/renderer/v1").AirReceiptV1,
          }
        : {
            ...shared,
            source,
            compiled: local.compiled as import("@refrain/compiler").CompiledAir,
            receipt: receipt as import("@refrain/renderer").AirReceipt,
          };
  }

  const hostDownload = async (file: DownloadArtifact) => {
    const openai = typeof window === "undefined" ? undefined : window.openai;
    const chatFile =
      userAgent.device.type !== "mobile" &&
      typeof openai?.uploadFile === "function" &&
      typeof openai?.getFileDownloadUrl === "function" &&
      typeof openai?.openExternal === "function"
        ? { upload, getDownloadUrl, openExternal }
        : undefined;
    return exportCanvasArtifact(file, {
      ...(chatFile ? { chatFile } : {}),
      portableDownload: download,
      ...(typeof navigator.clipboard?.writeText === "function"
        ? {
            copyText: (text) => navigator.clipboard.writeText(text),
          }
        : {}),
    });
  };

  return (
    <AirRenderer
      initialLocale={locale}
      artifact={artifact}
      assets={MCP_CANVAS_ASSETS}
      onDownload={hostDownload}
      onSelectionRequest={async (_selection, request) =>
        sendFollowUpMessage(request)
      }
      surface="mcp-canvas"
    />
  );
}
