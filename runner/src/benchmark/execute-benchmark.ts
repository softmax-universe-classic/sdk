import type { Episode } from "@softmax-universe/protocol";
import { safeError } from "../errors/index.js";
import { checkSignal, deadline } from "../execution/index.js";
import { validateOptions } from "./validate-options.js";
import { playTrial } from "./play-trial.js";
import type { ExecutionOptions, ExecutionResult } from "./types.js";
function countModelCalls(episodes: Episode[]): number {
  return episodes.reduce(
    (count, episode) =>
      count +
      episode.decisions.reduce(
        (total, decision) => total + decision.modelCalls.length + decision.reservedModelCalls,
        0,
      ),
    0,
  );
}

export async function executeBenchmark(options: ExecutionOptions): Promise<ExecutionResult> {
  options = { ...options, limits: { ...options.limits }, policies: { ...options.policies } };
  const run = validateOptions(options);
  const store = options.store;
  const runEndsAt = Date.now() + options.limits.runTimeoutMs;
  const runDeadline = deadline(options.signal, options.limits.runTimeoutMs, "run_timeout");
  let release: (() => Promise<void>) | undefined;
  try {
    release = await store.acquireWriter();
    await store.saveRun(run);
    const { episodes } = await store.readRecording();
    const existingTrials = new Set(episodes.map((episode) => episode.trialId));
    const budget = { modelCalls: countModelCalls(episodes) };
    for (const trial of run.trials) {
      checkSignal(runDeadline.signal);
      if (existingTrials.has(trial.id)) continue;
      episodes.push(
        await playTrial(options, run, trial, store, runDeadline.signal, runEndsAt, budget),
      );
    }
    return { run, episodes, modelCalls: budget.modelCalls };
  } catch (error) {
    throw safeError(error, "invalid_input");
  } finally {
    runDeadline.dispose();
    await release?.();
  }
}
