import { z } from "zod";
import { episodeSchema, runSchema } from "../schema/index.js";
import { validateRunEpisodes } from "./validate-run-episodes.js";

export const runExportSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    exportedAt: z.iso.datetime(),
    run: runSchema,
    episodes: z.array(episodeSchema).max(1000),
  })
  .superRefine((document, context) => {
    try {
      validateRunEpisodes(document.run, document.episodes);
    } catch (error) {
      if (!(error instanceof z.ZodError)) {
        throw error;
      }
      for (const issue of error.issues) {
        context.addIssue({ ...issue, path: ["episodes", ...issue.path] });
      }
    }
  });

export type RunExport = z.infer<typeof runExportSchema>;
