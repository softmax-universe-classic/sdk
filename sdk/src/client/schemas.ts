import { z } from "zod";
import { episodeSchema, runSchema } from "@softmax-universe/protocol";

export const runResponseSchema = z.strictObject({ run: runSchema });

export const episodeResponseSchema = z.strictObject({ episode: episodeSchema });

export const runDetailSchema = z.strictObject({
  run: runSchema,
  episodes: z.array(episodeSchema).max(1000),
});

export const runListSchema = z.strictObject({ runs: z.array(runSchema).max(1000) });

export const errorResponseSchema = z.object({
  error: z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/) }),
});
