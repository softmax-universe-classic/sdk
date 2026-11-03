import { jsonSchema, runSchema, MAX_MODEL_CALLS } from "@softmax-universe/protocol";
import type { Run } from "@softmax-universe/protocol";
import { isDeepStrictEqual } from "node:util";
import { RunnerError, safeError } from "../errors/index.js";
import type { RunLimits, ExecutionOptions } from "./types.js";
export function validateOptions(options: ExecutionOptions): Run {
  try {
    const run = runSchema.parse(options.run);
    const limits = options.limits;
    const bounds: Record<keyof RunLimits, [number, number]> = {
      maxDecisionsPerEpisode: [1, 20_000],
      maxModelCalls: [0, 20_000_000],
      maxModelCallsPerDecision: [1, MAX_MODEL_CALLS],
      maxOutputTokens: [1, 32_000],
      decisionTimeoutMs: [1, 2_147_483_647],
      episodeTimeoutMs: [1, 2_147_483_647],
      runTimeoutMs: [1, 2_147_483_647],
    };
    for (const name of Object.keys(bounds) as (keyof RunLimits)[]) {
      const [min, max] = bounds[name];
      if (!Number.isSafeInteger(limits[name]) || limits[name] < min || limits[name] > max) {
        throw new RunnerError("invalid_input");
      }
    }
    if (
      Object.hasOwn(run.configuration, "runnerLimits") &&
      !isDeepStrictEqual(run.configuration.runnerLimits, limits)
    ) {
      throw new RunnerError("invalid_input");
    }
    run.configuration.runnerLimits = { ...limits };
    const definitions: Record<string, import("@softmax-universe/protocol").Json> = {};
    for (const trial of run.trials) {
      for (const participant of trial.participants) {
        const policy = options.policies[participant.policy];
        if (
          !policy ||
          policy.definition.model !== participant.model ||
          !policy.definition.revision ||
          !["baseline", "model", "mechane", "custom"].includes(policy.definition.kind)
        ) {
          throw new RunnerError("missing_policy");
        }
        if (
          (policy.definition.kind === "model" || policy.definition.kind === "mechane") &&
          !policy.definition.model
        )
          throw new RunnerError("invalid_input");
        definitions[participant.policy] = jsonSchema.parse(policy.definition);
      }
    }
    if (
      Object.hasOwn(run.configuration, "policies") &&
      !isDeepStrictEqual(run.configuration.policies, definitions)
    )
      throw new RunnerError("invalid_input");
    run.configuration.policies = definitions;
    return run;
  } catch (error) {
    throw safeError(error, "invalid_input");
  }
}
