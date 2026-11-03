import { runSchema } from "./schema.js";
import type { Episode, Participant, Run } from "./schema.js";
import { validateRunEpisodes } from "./validation.js";

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

function participantKey(participant: Participant): string {
  return JSON.stringify([participant.kind, participant.policy, participant.model ?? null]);
}

function createRow(participant: Participant): RunSummaryRow {
  return {
    key: participantKey(participant),
    policy: participant.policy,
    model: participant.model ?? null,
    kind: participant.kind,
    participantLabels: [],
    planned: 0,
    played: 0,
    completed: 0,
    failed: 0,
    truncated: 0,
    cancelled: 0,
    incomplete: 0,
    missing: 0,
    averageScore: null,
    decisions: 0,
    modelCalls: 0,
    toolCalls: 0,
    reservedModelCalls: 0,
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };
}

function addKnownTotal(total: number | null, value: number | null | undefined): number | null {
  if (total === null || value === null || value === undefined) {
    return null;
  }
  return total + value;
}

export function summarizeRun(run: Run, episodes: readonly Episode[]): RunSummaryRow[] {
  const definition = runSchema.parse(run);
  const acceptedEpisodes = validateRunEpisodes(definition, episodes);
  const episodesByTrial = new Map(acceptedEpisodes.map((episode) => [episode.trialId, episode]));
  const rows = new Map<string, RunSummaryRow>();

  for (const trial of definition.trials) {
    const episode = episodesByTrial.get(trial.id);
    const participantRows = new Map<string, RunSummaryRow>();
    for (const participant of trial.participants) {
      const key = participantKey(participant);
      let row = rows.get(key);
      if (!row) {
        row = createRow(participant);
        rows.set(key, row);
      }
      if (!row.participantLabels.includes(participant.label)) {
        row.participantLabels.push(participant.label);
      }
      participantRows.set(participant.id, row);
      row.planned += 1;
      if (!episode) {
        row.missing += 1;
        continue;
      }
      row.played += 1;
      if (episode.outcome.kind === "terminated") {
        row.completed += 1;
        const score = episode.outcome.scores[participant.id]!;
        if (row.averageScore === null) {
          row.averageScore = score;
        } else {
          row.averageScore =
            row.averageScore * ((row.completed - 1) / row.completed) + score / row.completed;
        }
      } else {
        row[episode.outcome.kind] += 1;
      }
    }

    if (!episode) {
      continue;
    }
    for (const decision of episode.decisions) {
      const row = participantRows.get(decision.participantId)!;
      row.decisions += 1;
      row.toolCalls += decision.toolCalls.length;
      row.reservedModelCalls += decision.reservedModelCalls;
      if (decision.reservedModelCalls > 0) {
        row.latencyMs = row.inputTokens = row.outputTokens = row.costUsd = null;
      }
      for (const call of decision.modelCalls) {
        row.modelCalls += 1;
        row.latencyMs = addKnownTotal(row.latencyMs, call.latencyMs);
        row.inputTokens = addKnownTotal(row.inputTokens, call.inputTokens);
        row.outputTokens = addKnownTotal(row.outputTokens, call.outputTokens);
        row.costUsd = addKnownTotal(row.costUsd, call.costUsd);
      }
    }
  }

  return [...rows.values()];
}
