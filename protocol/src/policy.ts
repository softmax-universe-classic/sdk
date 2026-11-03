import type {
  Json,
  ModelCall,
  Participant,
  RuntimeReference,
  ToolCall,
  Trial,
} from "./schema/index.js";

export type MaybePromise<T> = T | Promise<T>;

export interface GameTurn {
  participantId: string;
  observation: Json;
  legalActions: Json[];
}

export interface GameSession {
  getTurn(signal: AbortSignal): MaybePromise<GameTurn | null>;
  apply(
    action: Json,
    signal: AbortSignal,
  ): MaybePromise<{ accepted: boolean; action: Json; nextObservation: Json }>;
  getOutcome(signal: AbortSignal): MaybePromise<{ scores: Record<string, number> } | null>;
  close?(): MaybePromise<void>;
}

export interface PolicyDefinition {
  kind: "baseline" | "model" | "mechane" | "custom";
  revision: string;
  model?: string;
  configuration: Record<string, Json>;
}

export interface PolicyInput extends GameTurn {
  trial: Trial;
  decisionId: string;
  signal: AbortSignal;
  deadlineAt: string;
  maxOutputTokens: number;
  maxModelCalls: number;
  recordModelCall(call: ModelCall): Promise<void>;
  recordToolCall(call: ToolCall): Promise<void>;
  recordRuntime(runtime: RuntimeReference): Promise<void>;
  settleModelCalls(): Promise<void>;
}

export interface PolicySession {
  decide(input: PolicyInput): MaybePromise<{ action: Json }>;
  close?(): MaybePromise<void>;
}

export interface Policy {
  definition: PolicyDefinition;
  open(input: {
    trial: Trial;
    participant: Participant;
    episodeId: string;
    signal: AbortSignal;
  }): MaybePromise<PolicySession>;
}
