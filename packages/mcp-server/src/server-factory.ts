import { McpServer } from "skybridge/server";
import {
  createRefrainArtifact,
  createRefrainArtifactV3,
} from "@refrain/renderer/portable";
import {
  F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
  candidateForInstrument,
} from "@refrain/soundpack";
import {
  artifactBytesOf,
  REFRAIN_ARTIFACT_MEDIA_TYPE,
} from "@refrain/renderer/presentation-ref";
import {
  authoringCard,
  humAnyInputObjectSchema,
  humAnyInputSchema,
  humAnyModelSuccessOutputSchema,
} from "./contract.js";
import { humAny } from "./hum-any.js";
import type { HumSuccess } from "./hum.js";
import type { HumSuccessV1 } from "./hum-v1.js";
import { loadSelfContainedHumView } from "./self-contained-view.js";
import { loadRuntimeReleaseIdentity } from "./release-identity.js";
import { MCP_CANVAS_ASSETS } from "./canvas-runtime.js";

interface HealthResponse {
  status(code: number): HealthResponse;
  json(value: unknown): void;
}

export function createRefrainServer() {
  const release = loadRuntimeReleaseIdentity();
  const defaultAirV1PerformanceBinding = F_SYNTHETIC_BEAT_PERFORMANCE_BINDING;
  const canvasSynthInstruments = Object.entries(
    defaultAirV1PerformanceBinding.soundProfile.selections,
  )
    .filter(([instrumentId, selection]) =>
      selection.candidateChain.every(
        (pin) =>
          candidateForInstrument(instrumentId, pin.id).engine === "synth",
      ),
    )
    .map(([instrumentId]) => instrumentId)
    .sort();
  const productionView =
    process.env.NODE_ENV === "production"
      ? loadSelfContainedHumView(process.cwd())
      : undefined;
  const server = new McpServer(
    {
      name: "Refrain",
      version: "0.0.0-experimental",
    },
    { capabilities: {} },
  );
  server.express.get(
    "/healthz",
    (_request: unknown, response: HealthResponse) =>
      response.status(200).json({
        status: "ok",
        server: "Refrain",
        release: release ?? null,
      }),
  );
  if (productionView) {
    server.registerResource(
      "hum",
      productionView.uri,
      {
        description: "Hear and inspect one Refrain air.",
        mimeType: productionView.mimeType,
        size: productionView.bytes,
        _meta: productionView.meta,
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: productionView.mimeType,
            text: productionView.html,
            _meta: productionView.meta,
          },
        ],
      }),
    );
  }
  return server.registerTool(
    {
      name: "hum",
      title: "Hum an air",
      description: [
        "Render one complete air@1-experimental source authored by you, the current host agent; exact historical air@0 sources remain accepted.",
        "Refrain validates, compiles, gives the person manual playback, and returns verified receipt integrity; it does not contain another composing model.",
        `This MCP host defaults omitted AIR@1 performance.bindingId to ${defaultAirV1PerformanceBinding.id}. Its Canvas is a zero-asset direct-nodes build, so an explicit sampled binding remains exact but unavailable there; ordinary browser surfaces retain sampled playback.`,
        `For audible playback in this Canvas, use only these exact zero-asset instrument identities: ${canvasSynthInstruments.join(", ")}. An AIR using any sample-backed identity remains canonical, but its performanceStatus is unavailable in this Canvas.`,
        "For AIR@1 continuation, pass the exact Artifact@3 from the prior result unchanged as from.parentArtifact, then choose revise, extend, reply, variation, or quote. Explicit evidence may bind motif transformation, orchestration, recurrence, section contrast, and meaningful absence. Optional embodiment lineage stays separate. Never send only an ID because the server is stateless.",
        "On failure, the MCP result is isError with strict structured content { ok: false, diagnostics }. On success, outputSchema exposes a compact result envelope while the returned Artifact@3 remains complete and from.parentArtifact validates it unchanged.",
        authoringCard,
      ].join(" "),
      // Skybridge's generic currently types only raw input shapes even though
      // its SDK runtime also accepts a Zod object. Preserve handler inference
      // while publishing and enforcing a closed top-level object.
      inputSchema:
        humAnyInputObjectSchema as unknown as typeof humAnyInputSchema,
      // MCP outputSchema describes non-error structured content. Error results
      // are returned with isError and validated separately in the core tests.
      outputSchema: humAnyModelSuccessOutputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      ...(productionView
        ? {}
        : {
            view: {
              component: "hum" as const,
              description: "Hear and inspect one Refrain air.",
              prefersBorder: false,
            },
          }),
      _meta: {
        ui: {
          visibility: ["model"],
          ...(productionView ? { resourceUri: productionView.uri } : {}),
        },
        ...(productionView
          ? { "openai/outputTemplate": productionView.uri }
          : {}),
        "openai/toolInvocation/invoking": "Tuning the air…",
        "openai/toolInvocation/invoked": "The air is ready",
        securitySchemes: [{ type: "noauth" }],
      },
      securitySchemes: [{ type: "noauth" }],
    },
    async (input) => {
      const result = humAny(input as never, {
        defaultPerformanceBindingId: defaultAirV1PerformanceBinding.id,
        playbackAssets: MCP_CANVAS_ASSETS,
      });
      if (!result.ok) {
        return {
          isError: true,
          structuredContent: result,
          content: [
            {
              type: "text" as const,
              text: `The air did not compile. ${result.diagnostics.map((item) => `${item.path}: ${item.message}`).join(" ")}`,
            },
          ],
        };
      }
      const currentResult =
        result.source.format === "air@1-experimental"
          ? (result as HumSuccessV1)
          : undefined;
      const historicalResult = currentResult
        ? undefined
        : (result as HumSuccess);
      const lineage = result.receipt.lineage
        ? `${result.receipt.lineage.relation} from ${result.receipt.lineage.parentReceiptId} (${result.receipt.verification.status})`
        : "root air";
      const voiceSummary = result.summary.voices
        .map(
          (voice) =>
            `${voice.instrument} (${voice.role}, ${voice.eventCount} events)`,
        )
        .join(", ");
      const motifSummary =
        result.summary.motifOccurrences.length === 0
          ? "none"
          : result.summary.motifOccurrences
              .map((motif) => `${motif.motif} ×${motif.count}`)
              .join(", ");
      const meterText =
        result.summary.format === "compiled-air-summary@1-experimental"
          ? result.summary.meters
              .map((meter) => `${meter.meter}@bar${meter.bar}`)
              .join(" → ")
          : result.summary.meter;
      const performanceText = result.performanceBinding
        ? currentResult?.performanceStatus.status === "unavailable"
          ? `Exact embodiment attached: ${result.performanceBinding.id} (sha256:${result.performanceBinding.contentSha256}, ${result.performanceBinding.renderer.contract}), but playback is unavailable in this MCP Canvas: ${currentResult.performanceStatus.message}`
          : `Exact audible embodiment: ${result.performanceBinding.id} (sha256:${result.performanceBinding.contentSha256}, ${result.performanceBinding.renderer.contract}).`
        : "Exact audible embodiment: unavailable; canonical source and receipt remain valid.";
      const text = [
        `${result.source.title}: ${result.summary.durationSeconds.toFixed(1)} seconds, ${result.summary.eventCount} events, ${result.summary.tempo} BPM, ${meterText}.`,
        `Voices: ${voiceSummary}. Motif occurrences: ${motifSummary}.`,
        `Receipt integrity: ${result.receipt.receiptId}. Lineage and musical verification: ${lineage}.`,
        performanceText,
      ]
        .filter(Boolean)
        .join("\n");
      const artifact =
        result.source.format === "air@1-experimental"
          ? createRefrainArtifactV3({
              source: result.source,
              receipt:
                result.receipt as import("@refrain/renderer/v1").AirReceiptV1,
              ...(result.performanceBinding
                ? { performanceBinding: result.performanceBinding }
                : {}),
              ...(result.caption === undefined
                ? {}
                : { caption: result.caption }),
            })
          : createRefrainArtifact({
              source: result.source,
              receipt: result.receipt as import("@refrain/renderer").AirReceipt,
              performanceBinding: result.performanceBinding!,
              ...(result.caption === undefined
                ? {}
                : { caption: result.caption }),
            });
      const artifactDelivery = artifactBytesOf(artifact);
      const structuredContent = currentResult
        ? {
            ok: true as const,
            artifact,
            summary: currentResult.summary,
            diagnostics: currentResult.diagnostics,
            performanceStatus: currentResult.performanceStatus,
            ...(currentResult.caption === undefined
              ? {}
              : { caption: currentResult.caption }),
            ...(currentResult.presentation === undefined
              ? {}
              : { presentation: currentResult.presentation }),
          }
        : {
            ...historicalResult!,
            performanceBinding: {
              format: historicalResult!.performanceBinding.format,
              id: historicalResult!.performanceBinding.id,
              contentSha256: historicalResult!.performanceBinding.contentSha256,
              renderer: historicalResult!.performanceBinding.renderer,
            },
          };
      return {
        structuredContent,
        content: [{ type: "text" as const, text }],
        _meta: {
          ...(currentResult ? {} : { "refrain/canvas": result }),
          ...(release ? { "refrain/release": release } : {}),
          "refrain/artifact": {
            uri: `refrain://artifact/${artifactDelivery.artifactSha256}`,
            mimeType: REFRAIN_ARTIFACT_MEDIA_TYPE,
            sha256: artifactDelivery.artifactSha256,
            ...(currentResult
              ? {}
              : { text: new TextDecoder().decode(artifactDelivery.bytes) }),
          },
        },
      };
    },
  );
}
