import type {
  Episode,
  Run,
  Trial,
  GameSession,
  MaybePromise,
  Policy,
} from "@softmax-universe/protocol";

export interface RunStore {
  acquireWriter(): Promise<() => Promise<void>>;
  saveRun(run: Run): Promise<void>;
  saveEpisode(run: Run, episode: Episode, replace?: boolean): Promise<void>;
  readRecording(): Promise<{ run: Run; episodes: Episode[] }>;
}

export interface RunLimits {
  maxDecisionsPerEpisode: number;
  maxModelCalls: number;
  maxModelCallsPerDecision: number;
  maxOutputTokens: number;
  decisionTimeoutMs: number;
  episodeTimeoutMs: number;
  runTimeoutMs: number;
}

export interface ExecutionOptions {
  run: Run;
  createGame(trial: Trial, signal: AbortSignal): MaybePromise<GameSession>;
  policies: Record<string, Policy>;
  limits: RunLimits;
  store: RunStore;
  signal: AbortSignal;
}

export interface ExecutionResult {
  run: Run;
  episodes: Episode[];
  modelCalls: number;
}
