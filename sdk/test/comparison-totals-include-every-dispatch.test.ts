import assert from "node:assert/strict";
import test from "node:test";
import { summarizeRun } from "@softmax-universe/protocol";
import { makeRun, episode } from "./support/index.js";

test("comparison totals include every dispatch and keep unresolved reservations unknown", () => {
  const run = makeRun();
  const recorded = episode(run);
  const turn = recorded.decisions[0]!;
  turn.modelCalls.push({ ...turn.modelCalls[0]!, id: "call-2", costUsd: 0.02 });
  turn.toolCalls.push({
    id: "tool-1",
    name: "read",
    input: { path: "board.json" },
    output: null,
    latencyMs: null,
    status: "unknown",
  });
  const measured = summarizeRun(run, [recorded])[0]!;
  assert.equal(measured.modelCalls, 2);
  assert.equal(measured.toolCalls, 1);
  assert.equal(measured.costUsd, 0.03);
  turn.modelCalls = [];
  turn.reservedModelCalls = 2;
  const uncertain = summarizeRun(run, [recorded])[0]!;
  assert.equal(uncertain.reservedModelCalls, 2);
  assert.equal(uncertain.costUsd, null);
  assert.equal(uncertain.outputTokens, null);
});
