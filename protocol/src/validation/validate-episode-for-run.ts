import { episodeSchema, runSchema } from "../schema/index.js";
import type { Episode, Run } from "../schema/index.js";
import { checkEpisodeRun } from "./check-episode-run.js";

export function validateEpisodeForRun(run: Run, value: unknown): Episode {
  const definition = runSchema.parse(run);
  const episode = episodeSchema.parse(value);
  checkEpisodeRun(definition, episode);
  return episode;
}
