import {
  COMPLETE_PIECE_PERFORMANCE_PLAN_FORMAT,
  COMPLETE_PIECE_RENDER_ADAPTERS,
  COMPLETE_PIECE_RENDERER_CONTRACT,
  PERFORMANCE_BINDING_FORMAT,
  PERFORMANCE_PLAN_FORMAT,
  REFRAIN_RENDERER_CONTRACT,
  RENDER_ADAPTERS,
  RENDER_SCENE_FORMAT,
  SOUND_PALETTE_FORMAT,
} from "@refrain/soundpack";
import { z } from "zod";

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const soundProfileSchema = z
  .object({
    format: z.literal("refrain-sound-profile@1-experimental"),
    id: z.string().min(1),
    contentSha256: sha256HexSchema,
    vocabulary: z
      .object({ id: z.string().min(1), sha256: sha256HexSchema })
      .strict(),
    selections: z.record(
      z.string(),
      z
        .object({
          candidateChain: z
            .array(
              z
                .object({ id: z.string().min(1), sha256: sha256HexSchema })
                .strict(),
            )
            .min(1),
          fallbackPolicy: z.enum(["strict", "whole-identity-audition"]),
          profileGainDb: z.number().finite().optional(),
        })
        .strict(),
    ),
  })
  .strict();
const renderSceneSchema = z
  .object({
    format: z.literal(RENDER_SCENE_FORMAT),
    id: z.string().min(1),
    contentSha256: sha256HexSchema,
    masterGainDb: z.number().min(-60).max(-6),
    peakCeiling: z.number().min(0.05).max(1),
    velocityScale: z.number().min(0.05).max(2),
  })
  .strict();
const soundObjectReferenceSchema = z
  .object({ id: z.string().min(1), sha256: sha256HexSchema })
  .strict();
const soundPaletteSchema = z
  .object({
    format: z.literal(SOUND_PALETTE_FORMAT),
    id: z.string().min(1),
    contentSha256: sha256HexSchema,
    status: z.enum([
      "engineering",
      "listening-candidate",
      "listening-accepted",
      "release-candidate",
    ]),
    soundProfile: soundObjectReferenceSchema,
    renderScene: soundObjectReferenceSchema,
    authoringGuide: z.string().min(1).max(2000),
    descriptors: z.array(z.string().min(1)),
    strengths: z.array(z.string().min(1)),
    constraints: z.array(z.string().min(1)),
    intentionalContrasts: z.array(z.string().min(1)),
  })
  .strict();
const overrideKeySchema = z.enum([
  "masterGainDb",
  "peakCeiling",
  "velocityScale",
]);
const rendererSchema = z.union([
  z
    .object({
      contract: z.literal(REFRAIN_RENDERER_CONTRACT),
      performancePlanFormat: z.literal(PERFORMANCE_PLAN_FORMAT),
      adapters: z.array(z.enum(RENDER_ADAPTERS)),
    })
    .strict(),
  z
    .object({
      contract: z.literal(COMPLETE_PIECE_RENDERER_CONTRACT),
      performancePlanFormat: z.literal(COMPLETE_PIECE_PERFORMANCE_PLAN_FORMAT),
      adapters: z.array(z.enum(COMPLETE_PIECE_RENDER_ADAPTERS)),
    })
    .strict(),
]);

export const performanceBindingSchema = z
  .object({
    format: z.literal(PERFORMANCE_BINDING_FORMAT),
    id: z.string().min(1),
    contentSha256: sha256HexSchema,
    soundProfile: soundProfileSchema,
    soundProfileSha256: sha256HexSchema,
    renderScene: renderSceneSchema,
    soundPalette: soundPaletteSchema.optional(),
    soundPaletteSha256: sha256HexSchema.optional(),
    candidateDigests: z.record(z.string(), sha256HexSchema),
    permittedOverrides: z.array(overrideKeySchema),
    overrides: z
      .object({
        masterGainDb: z.number().min(-60).max(-6).optional(),
        peakCeiling: z.number().min(0.05).max(1).optional(),
        velocityScale: z.number().min(0.05).max(2).optional(),
      })
      .strict(),
    renderer: rendererSchema,
  })
  .strict()
  .meta({ id: "RefrainPerformanceBindingV0" });
