import { z } from "zod";
import type { Episode, Participant, Run } from "../schema/index.js";

function sameParticipant(left: Participant, right: Participant): boolean {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.kind === right.kind &&
    left.policy === right.policy &&
    left.model === right.model
  );
}

export function checkEpisodeRun(run: Run, episode: Episode): void {
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
