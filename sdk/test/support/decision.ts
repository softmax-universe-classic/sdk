import type { Decision } from "@softmax-universe/protocol";

export function decision(): Decision {
  return {
    index: 0,
    participantId: "black",
    observation: { available: [1] },
    attemptedAction: 1,
    acceptedAction: 1,
    nextObservation: { available: [] },
    status: "accepted",
    modelCalls: [
      {
        id: "call-1",
        status: "completed",
        requestedModel: "requested-model",
        provider: "fixture",
        model: "resolved-model",
        input: "Choose an action",
        output: "1",
        latencyMs: 20,
        inputTokens: 5,
        outputTokens: 1,
        costUsd: 0.01,
      },
    ],
    toolCalls: [],
    reservedModelCalls: 0,
  };
}
