import { createOpenRouterClient, ModelError } from "@softmax-foundation/models";
import type { Policy } from "./types.js";
import { RunnerError } from "./errors.js";

export type ModelPolicyOptions = Parameters<typeof createOpenRouterClient>[0];

export function createModelPolicy(options: ModelPolicyOptions): Policy {
  const client = createOpenRouterClient(options);
  return {
    definition: {
      kind: "model",
      revision: "legal-action-v1",
      model: options.model,
      configuration: {
        provider: client.provider,
        endpoint: options.endpoint,
        maxInputChars: options.maxInputChars ?? 32_000,
        maxResponseBytes: options.maxResponseBytes ?? 262_144,
      },
    },
    open() {
      return {
        async decide(input) {
          if (input.maxModelCalls < 1 || input.legalActions.length === 0)
            throw new RunnerError("model_call_limit");
          let text: string;
          try {
            ({ text } = await client.generate({
              messages: [
                {
                  role: "system",
                  content:
                    'Choose one action from legalActions using the observation. Reply only with JSON {"actionIndex":N}, where N is the zero-based index of your chosen action. The game validates your action.',
                },
                {
                  role: "user",
                  content: JSON.stringify({
                    participantId: input.participantId,
                    observation: input.observation,
                    legalActions: input.legalActions,
                  }),
                },
              ],
              responseSchema: {
                type: "object",
                properties: { actionIndex: { type: "integer" } },
                required: ["actionIndex"],
                additionalProperties: false,
              },
              maxOutputTokens: input.maxOutputTokens,
              signal: input.signal,
              recordCall: input.recordModelCall,
            }));
          } catch (error) {
            if (error instanceof ModelError) {
              if (!input.signal.aborted) await input.settleModelCalls();
              throw new RunnerError(error.code, error.status);
            }
            throw error;
          }
          await input.settleModelCalls();
          let choice: unknown;
          try {
            choice = JSON.parse(text);
          } catch {
            throw new RunnerError("provider_invalid_output");
          }
          if (
            choice === null ||
            typeof choice !== "object" ||
            Array.isArray(choice) ||
            Object.keys(choice).length !== 1 ||
            !("actionIndex" in choice)
          )
            throw new RunnerError("provider_invalid_output");
          const index = choice.actionIndex;
          if (
            typeof index !== "number" ||
            !Number.isSafeInteger(index) ||
            index < 0 ||
            index >= input.legalActions.length
          )
            throw new RunnerError("provider_invalid_output");
          return { action: input.legalActions[index]! };
        },
      };
    },
  };
}
