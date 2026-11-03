import { jsonSchema, type ModelCall, type ToolCall } from "@softmax-universe/protocol";
import type { PolicyInput } from "@softmax-universe/protocol";
import type { BoundedTurn } from "./protocol.js";
import { MechanePolicyError } from "./transport/index.js";

type RuntimeJson = BoundedTurn["dispatch_evidence"][number]["request"];

function object(value: RuntimeJson | undefined): Record<string, RuntimeJson> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, RuntimeJson>;
  return undefined;
}

function elapsed(start: string | undefined, end: string | undefined): number | null {
  if (start === undefined || end === undefined) return null;
  const milliseconds = Date.parse(end) - Date.parse(start);
  return milliseconds < 0 ? null : milliseconds;
}

function serialize(value: RuntimeJson): string {
  const encoded = JSON.stringify(value);
  if (encoded.length > 200_000) throw new MechanePolicyError("evidence_too_large");
  return encoded;
}

export function createEvidenceRecorder(input: PolicyInput) {
  const models = new Map<string, string>();
  const tools = new Map<string, string>();

  return async (turn: BoundedTurn): Promise<void> => {
    const payloads = new Map(turn.dispatch_evidence.map((call) => [call.id, call]));
    const ledger = new Map(turn.dispatches.map((call) => [call.id, call]));
    const dispatches = new Map(
      turn.dispatches.filter((call) => call.status !== "refused").map((call) => [call.id, call]),
    );
    const ids = new Set([...payloads.keys(), ...dispatches.keys()]);
    if (
      payloads.size !== turn.dispatch_evidence.length ||
      ledger.size !== turn.dispatches.length ||
      new Set(turn.tool_calls.map((call) => call.id)).size !== turn.tool_calls.length ||
      ids.size > input.maxModelCalls ||
      turn.dispatched_count > input.maxModelCalls ||
      [...payloads.keys()].some((id) => ledger.get(id)?.status === "refused") ||
      (turn.evidence_complete &&
        (ledger.size !== turn.dispatched_count ||
          [...payloads.keys()].some((id) => !ledger.has(id))))
    )
      throw new MechanePolicyError("invalid_dispatch_accounting");

    for (const id of ids) {
      const payload = payloads.get(id);
      const dispatch = dispatches.get(id);
      const response = object(payload?.response);
      const provider = typeof response?.provider === "string" ? response.provider : "mechane";
      const model = typeof response?.responseModel === "string" ? response.responseModel : null;
      const terminal = turn.status === "answered" || turn.status === "unanswered";
      let status: ModelCall["status"] = terminal ? "unknown" : "pending";
      if (payload && payload.status !== "running") status = payload.status;
      const call: ModelCall = {
        id,
        provider,
        requestedModel: payload?.model ?? dispatch?.model ?? null,
        model,
        input: payload && payload.request !== null ? serialize(payload.request) : null,
        output: payload?.response === undefined ? null : serialize(payload.response),
        latencyMs: elapsed(payload?.started_at, payload?.ended_at),
        status,
      };
      if (dispatch?.status === "settled" && dispatch.basis === "usage") {
        if (
          dispatch.input_tokens !== undefined &&
          dispatch.cache_read_tokens !== undefined &&
          dispatch.cache_write_tokens !== undefined
        ) {
          call.inputTokens =
            dispatch.input_tokens + dispatch.cache_read_tokens + dispatch.cache_write_tokens;
        }
        if (dispatch.output_tokens !== undefined) call.outputTokens = dispatch.output_tokens;
      }
      if (status === "failed") call.error = "mechane_model_failed";
      const encoded = JSON.stringify(call);
      if (models.get(id) !== encoded) {
        await input.recordModelCall(call);
        models.set(id, encoded);
      }
    }

    for (const payload of turn.tool_calls) {
      const call: ToolCall = {
        id: payload.id,
        name: payload.name,
        input: jsonSchema.parse(payload.input),
        output: jsonSchema.parse(payload.output ?? null),
        latencyMs: elapsed(payload.started_at, payload.ended_at),
        status: payload.status,
      };
      if (call.status === "failed") call.error = "mechane_tool_failed";
      const encoded = JSON.stringify(call);
      if (tools.get(call.id) !== encoded) {
        await input.recordToolCall(call);
        tools.set(call.id, encoded);
      }
    }
  };
}
