import { decisionSchema, episodeSchema, MAX_DECISIONS, runSchema } from "./schema.js";
import type { Decision, Episode, Outcome, Run } from "./schema.js";

export interface RecorderOptions {
  run: Run;
  trialId: string;
  episodeId: string;
  startedAt?: string;
}

export type DecisionInput = Omit<
  Decision,
  "index" | "modelCalls" | "toolCalls" | "reservedModelCalls"
> &
  Partial<Pick<Decision, "modelCalls" | "toolCalls" | "reservedModelCalls">>;
export type FinalOutcome = Exclude<Outcome, { kind: "incomplete" }>;

export interface EpisodeRecorder {
  recordDecision(decision: DecisionInput): Decision;
  replacePendingDecision(decision: DecisionInput): Decision;
  finish(outcome: FinalOutcome, endedAt?: string): Episode;
  snapshot(): Episode;
}

export function createRecorder(options: RecorderOptions): EpisodeRecorder {
  const run = runSchema.parse(options.run);
  const trial = run.trials.find((candidate) => candidate.id === options.trialId);
  if (!trial) {
    throw new Error("Recorder trial must be declared by the run.");
  }
  let episode = episodeSchema.parse({
    schemaVersion: 2,
    id: options.episodeId,
    runId: run.id,
    trialId: trial.id,
    game: run.game,
    seed: trial.seed,
    participants: trial.participants,
    startedAt: options.startedAt ?? new Date().toISOString(),
    endedAt: null,
    decisions: [],
    outcome: { kind: "incomplete" },
  });
  const participantIds = new Set(trial.participants.map((participant) => participant.id));

  function requireOpen(): void {
    if (episode.outcome.kind !== "incomplete") {
      throw new Error("This episode is finished.");
    }
  }

  function parseDecision(input: DecisionInput, index: number): Decision {
    const decision = decisionSchema.parse({
      modelCalls: [],
      toolCalls: [],
      reservedModelCalls: 0,
      ...input,
      index,
    });
    if (!participantIds.has(decision.participantId)) {
      throw new Error("Decision participant must be declared by the trial.");
    }
    return decision;
  }

  return {
    recordDecision(input) {
      requireOpen();
      if (episode.decisions.at(-1)?.status === "pending") {
        throw new Error("Resolve the pending decision before recording another decision.");
      }
      if (episode.decisions.length >= MAX_DECISIONS) {
        throw new Error("The episode decision limit has been reached.");
      }
      const decision = parseDecision(input, episode.decisions.length);
      episode.decisions.push(decision);
      return decisionSchema.parse(decision);
    },
    replacePendingDecision(input) {
      requireOpen();
      const previous = episode.decisions.at(-1);
      if (!previous || previous.status !== "pending") {
        throw new Error("There is no pending decision to replace.");
      }
      const decision = parseDecision(input, previous.index);
      if (decision.participantId !== previous.participantId) {
        throw new Error("A pending decision cannot change its participant.");
      }
      episode.decisions[previous.index] = decision;
      return decisionSchema.parse(decision);
    },
    finish(outcome, endedAt = new Date().toISOString()) {
      requireOpen();
      const finished = episodeSchema.parse({ ...episode, outcome, endedAt });
      episode = finished;
      return episodeSchema.parse(episode);
    },
    snapshot() {
      return episodeSchema.parse(episode);
    },
  };
}
