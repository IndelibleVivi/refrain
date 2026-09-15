import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import type { McpServer } from "skybridge/server";
import { sealAudition, type AuditionTarget } from "@refrain/correspondence";
import { prepareAudition } from "@refrain/correspondence/node";
import { parentArtifactInputSchemaV1 } from "./contract-v1.js";
import type { loadRuntimeReleaseIdentity } from "./release-identity.js";

const target = z.strictObject({
  section: z.string().min(1).max(256).optional(),
  selection: z
    .strictObject({
      format: z.literal("refrain-selection@0-experimental"),
      sourceRevision: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      receiptId: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      kind: z.enum(["motif", "segment", "section"]),
      anchor: z.string().min(1).max(512),
      voiceId: z.string().min(1).max(256).optional(),
      timeRange: z.strictObject({ startBeat: z.number(), endBeat: z.number() }),
    })
    .optional(),
  startSeconds: z.number().nonnegative().optional(),
  endSeconds: z.number().positive().optional(),
  contextSeconds: z.number().min(0).max(30).optional(),
});
const performance = z.strictObject({
  artifact: parentArtifactInputSchemaV1,
  bindingId: z.string().min(1).max(256).optional(),
  target: target.optional(),
});
export const auditionInputSchema = performance.extend({
  compare: performance.optional(),
});
export const MCP_AUDITION_MAX_SECONDS = 20;

export function registerAuditionTool(
  server: McpServer,
  release?: ReturnType<typeof loadRuntimeReleaseIdentity>,
) {
  server.registerTool(
    {
      name: "audition",
      title: "Receive an exact performance",
      description: [
        "Prepare actual native WAV audio from your exact AIR@1 Artifact@3 for self-listening or a musical response. No judging model, quality score, automatic revision, publication, or speaker playback.",
        "Choose a carried binding or retain the artifact default/sole binding. Never reassemble the artifact or silently substitute sound.",
        "Request a section, exact selection, or startSeconds/endSeconds; the default context is two seconds on each side. Each returned entry is at most 20 seconds including context. Use the local refrain audition CLI for complete pieces.",
        "An optional compare entry requires its own explicit passage when either side selects one; native levels remain unchanged. Audio is cropped from the complete reference render so prior sustain and scene history survive.",
        "The result carries an exact audition packet and ordered audio/wav content blocks (a, then optional b). Time in a clip maps back via range.startFrame / media.sampleRate. Measurements describe the delivered PCM, not emotional meaning or quality.",
        "Audio content returned by MCP does not prove your host submitted it to the model. State whether you used audio input, score reading, measurements, or human feedback. A response is optional. Use the original full Artifact@3 with hum relation=reply for a musical reply.",
        "Exact sampled rendering requires operator-provisioned local assets; unavailable sound fails explicitly. This tool never fetches sound or calls another model.",
      ].join(" "),
      inputSchema:
        auditionInputSchema as unknown as typeof auditionInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      securitySchemes: [{ type: "noauth" }],
      _meta: { securitySchemes: [{ type: "noauth" }] },
    },
    async (args, extra) => {
      let temporary: string | undefined;
      try {
        const input = auditionInputSchema.parse(args);
        const hasTarget = (t: AuditionTarget | undefined) =>
          Boolean(
            t &&
            (t.section !== undefined ||
              t.selection !== undefined ||
              t.startSeconds !== undefined ||
              t.endSeconds !== undefined),
          );
        if (
          input.compare &&
          hasTarget(input.target) !== hasTarget(input.compare.target)
        )
          throw new Error(
            "Specify a target for each side of an excerpt comparison; equal clock times are not assumed to align music.",
          );
        temporary = await mkdtemp(join(tmpdir(), "refrain-mcp-audition-"));
        const directory = join(temporary, "packet");
        const packet = await prepareAudition(
          [input, ...(input.compare ? [input.compare] : [])],
          directory,
          {
            maxMediaSeconds: MCP_AUDITION_MAX_SECONDS,
            assetRoot: process.env.REFRAIN_AUDITION_ASSET_ROOT,
            isCancelled: () => extra.signal.aborted,
          },
        );
        // The caller already carries its full parent artifact. Local temporary
        // artifact files are not remote resources and must not escape as locators.
        const audition = sealAudition(
          packet.entries.map(({ artifact: _artifact, ...entry }) => entry),
        );
        const content: Array<
          | { type: "text"; text: string }
          | { type: "audio"; data: string; mimeType: string }
        > = [];
        for (const entry of audition.entries) {
          content.push({
            type: "text",
            text: `Entry ${entry.key}: ${entry.media.sha256}; ${entry.media.frames / entry.media.sampleRate} seconds, native PCM WAV. Audio prepared; model audio-input delivery is unknown.`,
          });
          content.push({
            type: "audio",
            data: (
              await readFile(join(directory, entry.media.filename))
            ).toString("base64"),
            mimeType: "audio/wav",
          });
        }
        return {
          structuredContent: {
            ok: true,
            audition,
            delivery: { mode: "mcp-audio-content", modelAudioInput: "unknown" },
          },
          content,
          ...(release ? { _meta: { "refrain/release": release } } : {}),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          structuredContent: {
            ok: false,
            error: { code: "audition-unavailable", message },
          },
          content: [{ type: "text", text: message }],
        };
      } finally {
        if (temporary) await rm(temporary, { recursive: true, force: true });
      }
    },
  );
}
