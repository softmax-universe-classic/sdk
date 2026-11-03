import { startedAt } from "./constants.js";
import type { Episode, Outcome, Run } from "@softmax-universe/protocol";
import { endedAt } from "./constants.js";
import { decision } from "./decision.js";

export function episode(
  run: Run,
  trialIndex = 0,
  outcome: Outcome = {
    kind: "terminated",
    scores: { black: 1, white: 0 },
  },
): Episode {
  const trial = run.trials[trialIndex]!;
  return {
    schemaVersion: 2,
    id: `episode-${trialIndex}`,
    runId: run.id,
    trialId: trial.id,
    game: run.game,
    seed: trial.seed,
    participants: trial.participants,
    startedAt,
    endedAt: outcome.kind === "incomplete" ? null : endedAt,
    decisions: [decision()],
    outcome,
  };
}
