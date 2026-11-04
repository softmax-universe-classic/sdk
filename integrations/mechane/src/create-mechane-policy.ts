import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Json, RuntimeReference } from "@softmax-universe/protocol";
import type { Policy } from "@softmax-universe/protocol";
import { createEvidenceRecorder } from "./evidence.js";
import { z } from "zod";
import { createTransport, MechanePolicyError } from "./transport/index.js";
import { type MechanePolicyOptions } from "./types.js";
import { instructions } from "./constants.js";

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
    !z.uuid().safeParse(options.workspaceId).success ||
    !options.model ||
    options.model.length > 200 ||
    options.model.includes(options.apiKey) ||
    options.workspaceId.includes(options.apiKey) ||
    !Number.isInteger(pollIntervalMs) ||
    pollIntervalMs < 10 ||
    pollIntervalMs > 5000
  )
    throw new MechanePolicyError("invalid_configuration");
  const workspace = { workspace_id: options.workspaceId };

  return {
    definition: {
      kind: "mechane",
      revision: "0.3.0-alpha.2",
      model: options.model,
      configuration: { origin: transport.origin, workspaceId: options.workspaceId, instructions },
    },
    async open(context) {
      const mech = await transport.call("createMech", workspace, context.signal, {
        request_id: creationRequestId(context.episodeId, context.participant.id),
        name: `Universe ${context.episodeId.slice(0, 8)} ${context.participant.id}`.slice(0, 64),
        model: options.model,
        instructions,
      });
      const scope = { ...workspace, mech_id: mech.id };
      let activeRequestId: string | null = null;
      let closed = false;

      return {
        async decide(input) {
          input.signal.throwIfAborted();
          if (
            closed ||
            activeRequestId !== null ||
            input.maxModelCalls < 1 ||
            input.maxModelCalls > 100 ||
            input.legalActions.length === 0
          ) {
            throw new MechanePolicyError("invalid_decision");
          }
          const requestId = randomUUID();
          const target = { ...scope, request_id: requestId };
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
          activeRequestId = requestId;
          const recordEvidence = createEvidenceRecorder(input);
          let turn = await transport.call("submitBoundedTurn", target, input.signal, {
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
              activeRequestId = null;
              if (turn.evidence_complete) await input.settleModelCalls();
              if (turn.status !== "answered") throw new MechanePolicyError("turn_unanswered");
              return { action: chooseAction(turn.reply, input.legalActions) };
            }
            await delay(pollIntervalMs, undefined, { signal: input.signal });
            turn = await transport.call("showBoundedTurn", target, input.signal);
          }
        },
        async close() {
          if (closed) return;
          closed = true;
          const signal = AbortSignal.timeout(3000);
          try {
            if (activeRequestId)
              await transport.call(
                "cancelBoundedTurn",
                { ...scope, request_id: activeRequestId },
                signal,
                {},
              );
          } finally {
            await transport.call("updateMech", scope, signal, {
              expected_revision: mech.revision,
              status: "archived",
            });
          }
        },
      };
    },
  };
}
