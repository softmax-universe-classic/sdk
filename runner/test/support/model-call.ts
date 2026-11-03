import type { ModelCall } from "@softmax-universe/protocol";

export function modelCall(id: string): ModelCall {
  return {
    id,
    provider: "fixture",
    requestedModel: "requested-model",
    model: null,
    input: "observed input",
    output: null,
    latencyMs: null,
    status: "pending",
  };
}
