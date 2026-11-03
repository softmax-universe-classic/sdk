import type { RunLimits } from "../../src/index.js";
import { policy } from "./policy.js";

export const limits: RunLimits = {
  maxDecisionsPerEpisode: 8,
  maxModelCalls: 4,
  maxModelCallsPerDecision: 1,
  maxOutputTokens: 64,
  decisionTimeoutMs: 5_000,
  episodeTimeoutMs: 15_000,
  runTimeoutMs: 30_000,
};

export const baseline = policy(({ legalActions }) => ({ action: legalActions[0]! }));
