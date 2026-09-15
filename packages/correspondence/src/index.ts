import { z } from "zod";
import { sha256Hex } from "@refrain/identity";
import { compileAirV1 } from "@refrain/compiler/v1";
import {
  createRefrainArtifactV3,
  parseRefrainArtifact,
} from "@refrain/renderer/portable";
import type { RefrainArtifactV3 } from "@refrain/renderer";
import {
  createRefrainSelection,
  refrainSelectionIsValid,
  type RefrainSelection,
} from "@refrain/renderer/selection";
import { buildStructureViewModel } from "@refrain/renderer/view-model";
import {
  renderReceiptShapeIsValid,
  type RenderReceiptV3,
} from "@refrain/audio-engine/receipt";

export const AUDITION_FORMAT = "refrain-audition@0-experimental" as const;
export const RESPONSE_FORMAT = "refrain-response@0-experimental" as const;
export const SHARE_FORMAT = "refrain-share@0-experimental" as const;
export const SAMPLE_RATE = 44_100;

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const hex = z.string().regex(/^[0-9a-f]{64}$/);
const text = z.string().min(1).max(4000);
const frame = z.number().int().nonnegative();
export const fileSchema = z.strictObject({
  filename: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]*$/)
    .max(120),
  bytes: z.number().int().positive(),
  sha256: digest,
});
export type PacketFile = z.infer<typeof fileSchema>;

export function readArtifact(value: unknown): RefrainArtifactV3 {
  const result = parseRefrainArtifact(value);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  if (result.artifact.format !== "refrain-artifact@3-experimental")
    throw new Error(
      "Correspondence requires an exact AIR@1 Artifact@3; historical works need explicit migration.",
    );
  return result.artifact;
}

export const selectionSchema = z.custom<RefrainSelection>(
  refrainSelectionIsValid,
  "Invalid exact Refrain selection.",
);
export const targetSchema = z
  .strictObject({
    section: z.string().min(1).optional(),
    selection: selectionSchema.optional(),
    startSeconds: z.number().nonnegative().optional(),
    endSeconds: z.number().positive().optional(),
    contextSeconds: z.number().min(0).max(30).default(2),
  })
  .superRefine((value, ctx) => {
    const range =
      value.startSeconds !== undefined || value.endSeconds !== undefined;
    if (
      Number(Boolean(value.section)) +
        Number(Boolean(value.selection)) +
        Number(range) >
      1
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Choose section, exact selection, or seconds, not overlapping selectors.",
      });
    if (
      range &&
      (value.startSeconds === undefined ||
        value.endSeconds === undefined ||
        value.endSeconds <= value.startSeconds)
    )
      ctx.addIssue({
        code: "custom",
        message: "Supply startSeconds and endSeconds with a positive range.",
      });
  });
export type AuditionTarget = z.input<typeof targetSchema>;

export const rangeSchema = z
  .strictObject({
    focusStartFrame: frame,
    focusEndFrame: frame,
    startFrame: frame,
    endFrame: frame,
    totalFrames: frame.positive(),
  })
  .refine(
    (r) =>
      r.startFrame <= r.focusStartFrame &&
      r.focusStartFrame < r.focusEndFrame &&
      r.focusEndFrame <= r.endFrame &&
      r.endFrame <= r.totalFrames,
    "The focus must be contained in the delivered range and complete render.",
  );

export const measurementsSchema = z.strictObject({
  peak: z.number().min(0).max(1),
  rms: z.number().min(0).max(1),
  silentFrames: frame,
  fullScaleFrames: frame,
  energyBins: z.array(z.number().min(0).max(1)).min(1).max(32),
});

const renderReceiptSchema = z.custom<RenderReceiptV3>(
  (v) =>
    renderReceiptShapeIsValid(v) &&
    v.format === "refrain-render-receipt@3-experimental",
  "An exact complete-piece RenderReceipt@3 is required.",
);
export const auditionEntrySchema = z
  .strictObject({
    key: z.enum(["a", "b"]),
    work: z.strictObject({ sourceRevision: digest, receiptId: digest }),
    binding: z.strictObject({ id: z.string().min(1), contentSha256: hex }),
    renderReceipt: renderReceiptSchema,
    media: fileSchema.extend({
      sampleRate: z.literal(SAMPLE_RATE),
      channels: z.literal(2),
      frames: frame.positive(),
    }),
    range: rangeSchema,
    selection: selectionSchema.optional(),
    measurements: measurementsSchema,
    artifact: fileSchema.optional(),
  })
  .superRefine((entry, ctx) => {
    const error = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (
      entry.media.frames !== entry.range.endFrame - entry.range.startFrame ||
      entry.media.bytes !== 44 + entry.media.frames * 4
    )
      error("Delivered PCM WAV size/frame range mismatch.");
    if (
      entry.measurements.silentFrames > entry.media.frames ||
      entry.measurements.fullScaleFrames > entry.media.frames
    )
      error("Measured frame counts exceed the delivered media.");
    if (
      entry.renderReceipt.sourceRevision !== entry.work.sourceRevision ||
      entry.renderReceipt.adapter !== "wav" ||
      entry.renderReceipt.sampleRate !== SAMPLE_RATE ||
      !digest.safeParse(entry.renderReceipt.outputSha256).success ||
      entry.renderReceipt.outputAmplitude?.mode !== "native-gain" ||
      entry.renderReceipt.performanceBindingDigest !==
        `sha256:${entry.binding.contentSha256}`
    )
      error(
        "The source render must be the exact native WAV for this source and sample rate.",
      );
    if (
      entry.selection &&
      (entry.selection.sourceRevision !== entry.work.sourceRevision ||
        entry.selection.receiptId !== entry.work.receiptId)
    )
      error("The selection belongs to a different work revision.");
    if (
      entry.range.startFrame === 0 &&
      entry.range.endFrame === entry.range.totalFrames &&
      entry.media.sha256 !== entry.renderReceipt.outputSha256
    )
      error("Whole-render media must match its RenderReceipt output digest.");
  });
export type AuditionEntry = z.infer<typeof auditionEntrySchema>;
const packetBodySchema = z.strictObject({
  format: z.literal(AUDITION_FORMAT),
  entries: z.array(auditionEntrySchema).min(1).max(2),
});
export const auditionPacketSchema = packetBodySchema.extend({
  auditionId: digest,
});
export type AuditionPacket = z.infer<typeof auditionPacketSchema>;

// Transport key order is not identity. Array order remains meaningful.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, canonical(v)]),
  );
}
export function correspondenceIdentity(value: unknown): string {
  return `sha256:${sha256Hex(JSON.stringify(canonical(value)))}`;
}
export function sealAudition(entries: AuditionEntry[]): AuditionPacket {
  const body = packetBodySchema.parse({ format: AUDITION_FORMAT, entries });
  if (
    entries.map((e) => e.key).join(",") !== (entries.length === 1 ? "a" : "a,b")
  )
    throw new Error("Audition entries must be ordered a, then optional b.");
  const identity = {
    format: body.format,
    entries: body.entries.map(({ artifact: _artifact, media, ...entry }) => {
      const { filename: _filename, ...sound } = media;
      return { ...entry, media: sound };
    }),
  };
  return { ...body, auditionId: correspondenceIdentity(identity) };
}
export function readAudition(value: unknown): AuditionPacket {
  const packet = auditionPacketSchema.parse(value);
  if (sealAudition(packet.entries).auditionId !== packet.auditionId)
    throw new Error("Audition identity mismatch.");
  return packet;
}

export function resolveTarget(
  artifact: RefrainArtifactV3,
  target: AuditionTarget,
  totalFrames: number,
) {
  const input = targetSchema.parse(target);
  const result = compileAirV1(artifact.source);
  if (!result.compiled)
    throw new Error("The canonical source could not compile.");
  const compiled = result.compiled;
  const model = buildStructureViewModel(
    artifact.source,
    compiled,
    artifact.receipt,
  );
  let selection: RefrainSelection | undefined;
  if (input.section) {
    const section = model.sections.find((s) => s.id === input.section);
    if (!section) throw new Error(`Unknown section ${input.section}.`);
    selection = createRefrainSelection(model, "section", section.anchor);
  } else if (input.selection) {
    selection = createRefrainSelection(
      model,
      input.selection.kind,
      input.selection.anchor,
    );
    if (
      correspondenceIdentity(selection) !==
      correspondenceIdentity(input.selection)
    )
      throw new Error(
        "The selection is stale or disagrees with its canonical anchor.",
      );
  }
  const duration = totalFrames / SAMPLE_RATE;
  const start = selection
    ? (selection.timeRange.startBeat * 60) / compiled.tempo
    : (input.startSeconds ?? 0);
  const end = selection
    ? (selection.timeRange.endBeat * 60) / compiled.tempo
    : (input.endSeconds ?? duration);
  if (start < 0 || end > duration || start >= end)
    throw new Error("Requested range is outside the exact render.");
  const focusStartFrame = Math.floor(start * SAMPLE_RATE);
  const focusEndFrame = Math.min(totalFrames, Math.ceil(end * SAMPLE_RATE));
  return {
    range: rangeSchema.parse({
      focusStartFrame,
      focusEndFrame,
      startFrame: Math.max(
        0,
        focusStartFrame - Math.round(input.contextSeconds * SAMPLE_RATE),
      ),
      endFrame: Math.min(
        totalFrames,
        focusEndFrame + Math.round(input.contextSeconds * SAMPLE_RATE),
      ),
      totalFrames,
    }),
    ...(selection ? { selection } : {}),
  };
}

export function verifyEntryArtifact(entry: AuditionEntry, value: unknown) {
  const artifact = readArtifact(value);
  if (
    artifact.receipt.sourceRevision !== entry.work.sourceRevision ||
    artifact.receipt.receiptId !== entry.work.receiptId
  )
    throw new Error("Audition and carried artifact identify different works.");
  const binding = artifact.performanceBindings.find(
    (b) =>
      b.id === entry.binding.id &&
      b.contentSha256 === entry.binding.contentSha256,
  );
  if (!binding)
    throw new Error("The exact audition binding is absent from the artifact.");
  // The canonical artifact verifier owns source/receipt/binding/render graph checks.
  readArtifact(
    createRefrainArtifactV3({
      source: artifact.source,
      receipt: artifact.receipt,
      performanceBinding: binding,
      renderReceipts: [entry.renderReceipt],
    }),
  );
  if (entry.selection) {
    const expected = resolveTarget(
      artifact,
      { selection: entry.selection },
      entry.range.totalFrames,
    );
    if (
      expected.range.focusStartFrame !== entry.range.focusStartFrame ||
      expected.range.focusEndFrame !== entry.range.focusEndFrame
    )
      throw new Error(
        "Audition focus does not match its exact musical selection.",
      );
  }
  return artifact;
}

export const responseBodySchema = z.strictObject({
  format: z.literal(RESPONSE_FORMAT),
  auditionId: digest,
  entry: z.enum(["a", "b"]),
  mediaSha256: digest,
  observer: z.string().min(1).max(160),
  basis: z
    .array(
      z.enum([
        "audio-input",
        "score-reading",
        "render-measurements",
        "human-listening",
      ]),
    )
    .min(1)
    .max(4),
  access: z.literal("observer-declared"),
  message: text,
  focus: z
    .strictObject({
      startSeconds: z.number().nonnegative(),
      endSeconds: z.number().positive(),
    })
    .optional(),
  hypothesis: text.optional(),
  experiment: text.optional(),
});
export const responseSchema = responseBodySchema.extend({ responseId: digest });
export type MusicalResponse = z.infer<typeof responseSchema>;
export function sealResponse(
  packet: AuditionPacket,
  input: Omit<
    z.input<typeof responseBodySchema>,
    "format" | "auditionId" | "mediaSha256" | "access"
  >,
): MusicalResponse {
  const entry = packet.entries.find((e) => e.key === input.entry);
  if (!entry) throw new Error("Response entry is absent from the audition.");
  const body = responseBodySchema.parse({
    ...input,
    format: RESPONSE_FORMAT,
    auditionId: packet.auditionId,
    mediaSha256: entry.media.sha256,
    access: "observer-declared",
  });
  if (
    body.focus &&
    (body.focus.startSeconds >= body.focus.endSeconds ||
      body.focus.endSeconds > entry.media.frames / SAMPLE_RATE)
  )
    throw new Error(
      "Response focus is outside the delivered audio; times are relative to this clip.",
    );
  return { ...body, responseId: correspondenceIdentity(body) };
}
export function readResponse(
  value: unknown,
  packet: AuditionPacket,
): MusicalResponse {
  const response = responseSchema.parse(value);
  const {
    format: _format,
    auditionId: _auditionId,
    mediaSha256: _mediaSha256,
    access: _access,
    responseId: _responseId,
    ...input
  } = response;
  const expected = sealResponse(packet, input);
  if (
    expected.responseId !== response.responseId ||
    response.auditionId !== packet.auditionId ||
    expected.mediaSha256 !== response.mediaSha256
  )
    throw new Error(
      "Response is bound to a different audition or has been changed.",
    );
  return response;
}

export const shareBodySchema = z.strictObject({
  format: z.literal(SHARE_FORMAT),
  audition: fileSchema,
  files: z.array(fileSchema).min(1).max(24),
  attribution: z.string().min(1).max(1000),
  rights: z.string().min(1).max(4000),
  invitation: z.strictObject({
    response: z.enum(["welcome", "music", "conversation", "none"]),
    message: text.optional(),
  }),
});
export const shareSchema = shareBodySchema.extend({ shareId: digest });
export type ShareManifest = z.infer<typeof shareSchema>;
export function sealShare(
  input: z.input<typeof shareBodySchema>,
): ShareManifest {
  const body = shareBodySchema.parse(input);
  const names = [body.audition.filename, ...body.files.map((f) => f.filename)];
  if (new Set(names).size !== names.length || names.includes("share.json"))
    throw new Error(
      "Share file names must be unique and cannot replace the manifest.",
    );
  return { ...body, shareId: correspondenceIdentity(body) };
}
export function readShare(value: unknown): ShareManifest {
  const share = shareSchema.parse(value);
  const { shareId, ...body } = share;
  if (sealShare(body).shareId !== shareId)
    throw new Error("Share identity mismatch.");
  return share;
}
