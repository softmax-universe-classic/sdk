import type { Decision, Episode, Outcome, Run } from "@softmax-universe/protocol";

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
