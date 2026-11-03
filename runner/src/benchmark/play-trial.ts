import { randomUUID } from "node:crypto";
import { jsonSchema, validateEpisodeForRun } from "@softmax-universe/protocol";
import type {
  Decision,
  Episode,
  Run,
  Trial,
  GameSession,
  PolicySession,
} from "@softmax-universe/protocol";
import { RunnerError, safeError } from "../errors/index.js";
import { abortable, checkSignal, deadline } from "../execution/index.js";
import { decisionEvidence } from "../evidence.js";
import type { ExecutionOptions, RunStore } from "./types.js";
function initialEpisode(run: Run, trial: Trial): Episode {
  return {
    schemaVersion: 2,
    id: randomUUID(),
    runId: run.id,
    trialId: trial.id,
    game: run.game,
    seed: trial.seed,
    participants: trial.participants,
    startedAt: new Date().toISOString(),
    endedAt: null,
    decisions: [],
    outcome: { kind: "incomplete" },
  };
}

async function closeSession(game: Pick<GameSession, "close">): Promise<void> {
  if (!game.close) return;
  const cleanup = deadline(new AbortController().signal, 5_000, "cleanup_failed");
  try {
    await abortable(() => game.close!(), cleanup.signal);
  } catch {
    throw new RunnerError("cleanup_failed");
  } finally {
    cleanup.dispose();
  }
}

export async function playTrial(
  options: ExecutionOptions,
  run: Run,
  trial: Trial,
  store: RunStore,
  signal: AbortSignal,
  runEndsAt: number,
  budget: { modelCalls: number },
): Promise<Episode> {
  const episode = initialEpisode(run, trial);
  let writes = Promise.resolve();
  let created = false;
  const persist = () => {
    const snapshot = structuredClone(episode);
    writes = writes.then(async () => {
      await store.saveEpisode(run, snapshot, created);
      created = true;
    });
    return writes;
  };
  await persist();

  const episodeEndsAt = Math.min(runEndsAt, Date.now() + options.limits.episodeTimeoutMs);
  const episodeDeadline = deadline(signal, options.limits.episodeTimeoutMs, "episode_timeout");
  const policySessions = new Map<string, PolicySession>();
  let game: GameSession | undefined;
  let finished = false;
  let activeDecision: Decision | undefined;
  let evidence: ReturnType<typeof decisionEvidence> | undefined;
  let fatal: RunnerError | undefined;
  try {
    game = await abortable(async () => {
      const session = await options.createGame(structuredClone(trial), episodeDeadline.signal);
      if (finished || episodeDeadline.signal.aborted) {
        await closeSession(session);
        checkSignal(episodeDeadline.signal);
      }
      return session;
    }, episodeDeadline.signal);

    for (;;) {
      const decisionEndsAt = Math.min(episodeEndsAt, Date.now() + options.limits.decisionTimeoutMs);
      const decisionDeadline = deadline(
        episodeDeadline.signal,
        options.limits.decisionTimeoutMs,
        "decision_timeout",
      );
      try {
        const outcome = await abortable(
          () => game!.getOutcome(decisionDeadline.signal),
          decisionDeadline.signal,
        );
        if (outcome !== null) {
          const completed = validateEpisodeForRun(run, {
            ...episode,
            endedAt: new Date().toISOString(),
            outcome: { kind: "terminated", scores: outcome.scores },
          });
          episode.outcome = completed.outcome;
          break;
        }
        if (episode.decisions.length >= options.limits.maxDecisionsPerEpisode) {
          episode.outcome = { kind: "truncated", reason: "decision_limit", scores: null };
          break;
        }

        const turn = await abortable(
          () => game!.getTurn(decisionDeadline.signal),
          decisionDeadline.signal,
        );
        if (!turn || !Array.isArray(turn.legalActions) || turn.legalActions.length === 0) {
          throw new RunnerError("invalid_game_result");
        }
        const participant = trial.participants.find((entry) => entry.id === turn.participantId);
        if (!participant) throw new RunnerError("invalid_game_result");
        const policy = options.policies[participant.policy]!;
        if (policy.definition.model && budget.modelCalls >= options.limits.maxModelCalls) {
          episode.outcome = { kind: "truncated", reason: "model_call_limit", scores: null };
          break;
        }
        const observation = jsonSchema.parse(turn.observation);
        const legalActions = turn.legalActions.map((action) => jsonSchema.parse(action));
        const decision: Decision = {
          index: episode.decisions.length,
          participantId: participant.id,
          observation,
          attemptedAction: null,
          acceptedAction: null,
          nextObservation: null,
          status: "pending",
          modelCalls: [],
          toolCalls: [],
          reservedModelCalls: policy.definition.model
            ? Math.min(
                options.limits.maxModelCallsPerDecision,
                options.limits.maxModelCalls - budget.modelCalls,
              )
            : 0,
        };
        activeDecision = decision;
        episode.decisions.push(decision);
        budget.modelCalls += decision.reservedModelCalls;
        await persist();
        evidence = decisionEvidence(decision, persist, decisionDeadline.signal, budget);
        let policySession = policySessions.get(participant.id);
        if (!policySession) {
          policySession = await abortable(async () => {
            const session = await policy.open({
              trial: structuredClone(trial),
              participant: structuredClone(participant),
              episodeId: episode.id,
              signal: decisionDeadline.signal,
            });
            if (finished || decisionDeadline.signal.aborted) {
              await closeSession(session);
              checkSignal(decisionDeadline.signal);
            }
            return session;
          }, decisionDeadline.signal).catch((error) => {
            throw safeError(error, "policy_failed");
          });
          policySessions.set(participant.id, policySession);
        }
        const choice = await abortable(
          () =>
            policySession.decide({
              trial: structuredClone(trial),
              decisionId: `${episode.id}-${decision.index}`,
              participantId: participant.id,
              observation: structuredClone(observation),
              legalActions: structuredClone(legalActions),
              signal: decisionDeadline.signal,
              deadlineAt: new Date(decisionEndsAt).toISOString(),
              maxOutputTokens: options.limits.maxOutputTokens,
              maxModelCalls: decision.reservedModelCalls,
              ...evidence!.callbacks,
            }),
          decisionDeadline.signal,
        ).catch((error) => {
          throw safeError(error, "policy_failed");
        });
        evidence.close();
        decision.attemptedAction = jsonSchema.parse(choice.action);
        await persist();

        const result = await abortable(
          () => game!.apply(structuredClone(decision.attemptedAction), decisionDeadline.signal),
          decisionDeadline.signal,
        );
        if (typeof result.accepted !== "boolean") throw new RunnerError("invalid_game_result");
        decision.acceptedAction = result.accepted ? jsonSchema.parse(result.action) : null;
        decision.nextObservation = jsonSchema.parse(result.nextObservation);
        decision.status = result.accepted ? "accepted" : "rejected";
        await persist();
        if (!result.accepted) throw new RunnerError("action_rejected");
      } finally {
        evidence?.close();
        evidence = undefined;
        decisionDeadline.dispose();
      }
    }
  } catch (error) {
    evidence?.close();
    const failure = safeError(error, "game_failed");
    if (failure.code === "interrupted") {
      fatal = failure;
    } else {
      if (activeDecision?.status === "pending") {
        activeDecision.status = "error";
        activeDecision.error = failure.code;
      }
      if (failure.code === "cancelled") {
        episode.outcome = { kind: "cancelled", reason: "cancelled" };
        fatal = failure;
      } else if (failure.code === "episode_timeout" || failure.code === "run_timeout") {
        episode.outcome = { kind: "truncated", reason: failure.code, scores: null };
        if (failure.code === "run_timeout") fatal = failure;
      } else {
        episode.outcome = { kind: "failed", code: failure.code, message: failure.message };
        if (failure.code === "storage_failed") fatal = failure;
      }
    }
  } finally {
    finished = true;
    episodeDeadline.dispose();
    if (episode.outcome.kind !== "incomplete") episode.endedAt = new Date().toISOString();
    try {
      await persist();
    } finally {
      const closing = [...policySessions.values(), ...(game ? [game] : [])];
      const closed = await Promise.allSettled(closing.map(closeSession));
      for (const result of closed) {
        if (result.status === "rejected") fatal ??= safeError(result.reason, "cleanup_failed");
      }
    }
  }
  if (fatal) throw fatal;
  return episode;
}
