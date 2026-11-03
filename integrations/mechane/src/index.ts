import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Json, RuntimeReference } from "@softmax-universe/sdk";
import type { Policy } from "@softmax-universe/runner";
import { createEvidenceRecorder } from "./evidence.js";
import { boundedTurnSchema, mechSchema, recordIdSchema } from "./protocol.js";
import { createTransport, MechanePolicyError } from "./transport.js";

export { MechanePolicyError } from "./transport.js";

export interface MechanePolicyOptions {
  endpoint: string;
  apiKey: string;
  workspaceId: string;
  model: string;
  pollIntervalMs?: number;
  fetch?: typeof fetch;
}

const instructions =
  'Choose one action from legalActions using the observation. Finish each request with only JSON {"actionIndex":N}, where N is the zero-based index of your chosen action. The game validates the action. Do not create background work.';

function creationRequestId(episodeId: string, participantId: string): string {
  // The saved episode identifies an idle mech even if its creation response is lost.
  const bytes = createHash("sha256")
    .update(JSON.stringify(["universe-mech", episodeId, participantId]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function chooseAction(reply: string | undefined, legalActions: Json[]): Json {
  let value: unknown;
  try {
    value = JSON.parse(reply ?? "");
  } catch {
    throw new MechanePolicyError("invalid_action");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MechanePolicyError("invalid_action");
  }
  const choice = value as Record<string, unknown>;
  const index = choice.actionIndex;
  if (
    Object.keys(choice).length !== 1 ||
    typeof index !== "number" ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= legalActions.length
  ) {
    throw new MechanePolicyError("invalid_action");
  }
  return structuredClone(legalActions[index]!);
}

export function createMechanePolicy(suppliedOptions: MechanePolicyOptions): Policy {
  const options = { ...suppliedOptions };
  const transport = createTransport(options);
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  if (
    !recordIdSchema.safeParse(options.workspaceId).success ||
    !options.model ||
    options.model.length > 200 ||
    options.model.includes(options.apiKey) ||
    options.workspaceId.includes(options.apiKey) ||
    !Number.isInteger(pollIntervalMs) ||
    pollIntervalMs < 10 ||
    pollIntervalMs > 5000
  )
    throw new MechanePolicyError("invalid_configuration");
  const workspacePath = `/api/v1/workspaces/${encodeURIComponent(options.workspaceId)}/mechs`;

  return {
    definition: {
      kind: "mechane",
      revision: "0.2.0-alpha.1",
      model: options.model,
      configuration: { origin: transport.origin, workspaceId: options.workspaceId, instructions },
    },
    async open(context) {
      const mech = await transport.send(workspacePath, mechSchema, context.signal, {
        request_id: creationRequestId(context.episodeId, context.participant.id),
        name: `Universe ${context.episodeId.slice(0, 8)} ${context.participant.id}`.slice(0, 64),
        model: options.model,
        instructions,
      });
      const mechPath = `${workspacePath}/${encodeURIComponent(mech.id)}`;
      let activePath: string | null = null;
      let closed = false;

      return {
        async decide(input) {
          input.signal.throwIfAborted();
          if (
            closed ||
            activePath !== null ||
            input.maxModelCalls < 1 ||
            input.maxModelCalls > 100 ||
            input.legalActions.length === 0
          ) {
            throw new MechanePolicyError("invalid_decision");
          }
          const requestId = randomUUID();
          const path = `${mechPath}/bounded-turns/${requestId}`;
          const runtime: RuntimeReference = {
            kind: "mechane",
            origin: transport.origin,
            workspaceId: options.workspaceId,
            mechId: mech.id,
            requestId,
            turnId: null,
          };
          await input.recordRuntime(runtime);
          input.signal.throwIfAborted();
          activePath = path;
          const recordEvidence = createEvidenceRecorder(input);
          let turn = await transport.send(path, boundedTurnSchema, input.signal, {
            text: JSON.stringify({
              participantId: input.participantId,
              observation: input.observation,
              legalActions: input.legalActions,
            }),
            max_model_dispatches: input.maxModelCalls,
            max_output_tokens: input.maxOutputTokens,
            deadline_at: input.deadlineAt,
          });

          for (;;) {
            if (
              turn.request_id !== requestId ||
              turn.max_model_dispatches !== input.maxModelCalls ||
              turn.max_output_tokens !== input.maxOutputTokens ||
              Date.parse(turn.deadline_at) !== Date.parse(input.deadlineAt)
            ) {
              throw new MechanePolicyError("invalid_turn_response");
            }
            if (turn.turn_id && runtime.turnId !== turn.turn_id) {
              runtime.turnId = turn.turn_id;
              await input.recordRuntime({ ...runtime });
            }
            await recordEvidence(turn);
            if (turn.status === "answered" || turn.status === "unanswered") {
              activePath = null;
              if (turn.evidence_complete) await input.settleModelCalls();
              if (turn.status !== "answered") throw new MechanePolicyError("turn_unanswered");
              return { action: chooseAction(turn.reply, input.legalActions) };
            }
            await delay(pollIntervalMs, undefined, { signal: input.signal });
            turn = await transport.send(path, boundedTurnSchema, input.signal);
          }
        },
        async close() {
          if (closed) return;
          closed = true;
          const signal = AbortSignal.timeout(3000);
          try {
            if (activePath)
              await transport.send(`${activePath}/cancel`, boundedTurnSchema, signal, {});
          } finally {
            await transport.send(`${mechPath}/definition`, mechSchema, signal, {
              expected_revision: mech.revision,
              status: "archived",
            });
          }
        },
      };
    },
  };
}
