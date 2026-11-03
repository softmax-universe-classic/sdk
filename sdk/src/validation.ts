import { z } from "zod";
import { episodeSchema, runSchema } from "./schema.js";
import type { Episode, Participant, Run } from "./schema.js";

function sameParticipant(left: Participant, right: Participant): boolean {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.kind === right.kind &&
    left.policy === right.policy &&
    left.model === right.model
  );
}

function checkEpisodeRun(run: Run, episode: Episode): void {
  const issues: z.ZodIssue[] = [];
  const mismatch = (path: string, message: string): void => {
    issues.push({ code: "custom", path: [path], message });
  };
  if (episode.runId !== run.id) {
    mismatch("runId", "Episode run ID does not match the run.");
  }
  if (episode.game.id !== run.game.id || episode.game.version !== run.game.version) {
    mismatch("game", "Episode game and version must match the run.");
  }
  const trial = run.trials.find((candidate) => candidate.id === episode.trialId);
  if (!trial) {
    mismatch("trialId", "Episode trial must be declared by the run.");
  } else {
    if (episode.seed !== trial.seed) {
      mismatch("seed", "Episode seed must match its declared trial.");
    }
    if (
      episode.participants.length !== trial.participants.length ||
      episode.participants.some((participant, index) => {
        const declaredParticipant = trial.participants[index];
        return !declaredParticipant || !sameParticipant(participant, declaredParticipant);
      })
    ) {
      mismatch("participants", "Episode participants and order must match the declared trial.");
    }
  }
  if (issues.length > 0) {
    throw new z.ZodError(issues);
  }
}

export function validateEpisodeForRun(run: Run, value: unknown): Episode {
  const definition = runSchema.parse(run);
  const episode = episodeSchema.parse(value);
  checkEpisodeRun(definition, episode);
  return episode;
}

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
