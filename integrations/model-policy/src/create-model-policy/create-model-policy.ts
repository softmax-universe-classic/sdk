import {
  createFoundationClient,
  FoundationError,
  type ModelCallInput,
} from "@softmax-foundation/client";
import { PolicyError, type ModelCall, type Policy } from "@softmax-universe/protocol";
import { type ModelPolicyOptions } from "./types.js";

export function createModelPolicy(options: ModelPolicyOptions): Policy {
  const client = createFoundationClient(options);
  const maxInputChars = options.maxInputChars ?? 32_000;
  if (!Number.isSafeInteger(maxInputChars) || maxInputChars < 1 || maxInputChars > 200_000)
    throw new PolicyError("provider_configuration");
  return {
    definition: {
      kind: "model",
      revision: "foundation-legal-action-v1",
      model: options.model,
      configuration: {
        service: "foundation",
        endpoint: options.endpoint,
        maxInputChars,
      },
    },
    open() {
      return {
        async decide(input) {
          if (input.maxModelCalls < 1 || input.legalActions.length === 0)
            throw new PolicyError("model_call_limit");
          const request: ModelCallInput = {
            id: input.decisionId,
            model: options.model,
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
            deadlineAt: input.deadlineAt,
          };
          const serialized = JSON.stringify(request);
          if (serialized.length > maxInputChars) {
            await input.settleModelCalls();
            throw new PolicyError("provider_input_too_large");
          }
          const pending: ModelCall = {
            id: request.id,
            provider: "foundation",
            requestedModel: request.model,
            model: null,
            input: null,
            request: serialized,
            output: null,
            latencyMs: null,
            status: "pending",
          };
          await input.recordModelCall(pending);
          let call: ModelCall;
          try {
            call = await client.models.call(request, { signal: input.signal });
          } catch (error) {
            if (error instanceof FoundationError && error.outcome === "not_started") {
              await input.recordModelCall({ ...pending, status: "failed", error: error.code });
              await input.settleModelCalls();
            } else if (error instanceof FoundationError) {
              await input.recordModelCall({ ...pending, status: "unknown", error: error.code });
            }
            throw new PolicyError(input.signal.aborted ? "provider_aborted" : "provider_failed");
          }
          await input.recordModelCall({ ...call, request: serialized });
          if (call.status === "pending" || call.status === "unknown")
            throw new PolicyError("provider_failed");
          await input.settleModelCalls();
          if (call.status === "failed") throw new PolicyError("provider_failed");
          if (call.output === null) throw new PolicyError("provider_invalid_response");
          let choice: unknown;
          try {
            choice = JSON.parse(call.output);
          } catch {
            throw new PolicyError("provider_invalid_output");
          }
          if (
            choice === null ||
            typeof choice !== "object" ||
            Array.isArray(choice) ||
            Object.keys(choice).length !== 1 ||
            !("actionIndex" in choice)
          )
            throw new PolicyError("provider_invalid_output");
          const index = choice.actionIndex;
          if (
            typeof index !== "number" ||
            !Number.isSafeInteger(index) ||
            index < 0 ||
            index >= input.legalActions.length
          )
            throw new PolicyError("provider_invalid_output");
          return { action: input.legalActions[index]! };
        },
      };
    },
  };
}
