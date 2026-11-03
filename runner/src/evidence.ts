import {
  modelCallSchema,
  runtimeReferenceSchema,
  toolCallSchema,
} from "@softmax-universe/protocol";
import type { Decision } from "@softmax-universe/protocol";
import { RunnerError } from "./errors/index.js";
import { checkSignal } from "./execution/index.js";
import type { PolicyInput } from "@softmax-universe/protocol";

export function decisionEvidence(
  decision: Decision,
  persist: () => Promise<void>,
  signal: AbortSignal,
  budget: { modelCalls: number },
) {
  let active = true;
  let settled = false;
  const requireActive = () => {
    if (!active) throw new RunnerError("cancelled");
  };
  const callbacks: Pick<
    PolicyInput,
    "recordModelCall" | "recordToolCall" | "recordRuntime" | "settleModelCalls"
  > = {
    async recordModelCall(value) {
      requireActive();
      const call = modelCallSchema.parse(value);
      const index = decision.modelCalls.findIndex((previous) => previous.id === call.id);
      if (index < 0) {
        checkSignal(signal);
        if (settled || decision.reservedModelCalls < 1) throw new RunnerError("model_call_limit");
        decision.reservedModelCalls -= 1;
        decision.modelCalls.push(call);
      } else {
        decision.modelCalls[index] = call;
      }
      await persist();
    },
    async recordToolCall(value) {
      requireActive();
      const call = toolCallSchema.parse(value);
      const index = decision.toolCalls.findIndex((previous) => previous.id === call.id);
      if (index < 0) {
        checkSignal(signal);
        if (decision.toolCalls.length >= 1000) throw new RunnerError("invalid_input");
        decision.toolCalls.push(call);
      } else {
        decision.toolCalls[index] = call;
      }
      await persist();
    },
    async recordRuntime(value) {
      requireActive();
      checkSignal(signal);
      const runtime = runtimeReferenceSchema.parse(value);
      if (
        decision.runtime &&
        ["origin", "workspaceId", "mechId", "requestId"].some(
          (key) =>
            decision.runtime![key as keyof typeof runtime] !== runtime[key as keyof typeof runtime],
        )
      )
        throw new RunnerError("invalid_input");
      decision.runtime = runtime;
      await persist();
    },
    async settleModelCalls() {
      requireActive();
      checkSignal(signal);
      if (decision.modelCalls.some((call) => call.status === "pending"))
        throw new RunnerError("invalid_input");
      budget.modelCalls -= decision.reservedModelCalls;
      decision.reservedModelCalls = 0;
      settled = true;
      await persist();
    },
  };
  return {
    callbacks,
    close() {
      active = false;
      for (const call of [...decision.modelCalls, ...decision.toolCalls]) {
        if (call.status === "pending") call.status = "unknown";
      }
    },
  };
}
