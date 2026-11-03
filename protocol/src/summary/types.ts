import type { Participant } from "../schema/index.js";

export interface RunSummaryRow {
  key: string;
  policy: string;
  model: string | null;
  kind: Participant["kind"];
  participantLabels: string[];
  planned: number;
  played: number;
  completed: number;
  failed: number;
  truncated: number;
  cancelled: number;
  incomplete: number;
  missing: number;
  averageScore: number | null;
  decisions: number;
  modelCalls: number;
  toolCalls: number;
  reservedModelCalls: number;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}
