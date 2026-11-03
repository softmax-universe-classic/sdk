import { z } from "zod";
import { episodeSchema, runSchema } from "../schema/index.js";
import type { Episode, Run } from "../schema/index.js";
import { checkEpisodeRun } from "./check-episode-run.js";

export function validateRunEpisodes(run: Run, values: readonly unknown[]): Episode[] {
  const definition = runSchema.parse(run);
  const episodeIds = new Set<string>();
  const trialIds = new Set<string>();
  return values.map((value, index) => {
    const episode = episodeSchema.parse(value);
    checkEpisodeRun(definition, episode);
    if (episodeIds.has(episode.id) || trialIds.has(episode.trialId)) {
      throw new z.ZodError([
        {
          code: "custom",
          path: [index],
          message: "A run can contain at most one episode per ID and declared trial.",
        },
      ]);
    }
    episodeIds.add(episode.id);
    trialIds.add(episode.trialId);
    return episode;
  });
}
