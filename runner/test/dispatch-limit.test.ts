import assert from "node:assert/strict";
import test from "node:test";
import { runBenchmark } from "../src/index.js";
import { directory, runDefinition, limits, game, policy, modelCall } from "./support/index.js";

test("dispatch beyond the reserved allowance fails before a policy can send it", async (t) => {
  const path = await directory(t);
  let sends = 0;
  const result = await runBenchmark({
    run: runDefinition(true),
    directory: path,
    limits: { ...limits, maxModelCalls: 2, maxModelCallsPerDecision: 2 },
    createGame: () => game(),
    policies: {
      model: policy(async (input) => {
        for (let index = 0; index < 3; index += 1) {
          await input.recordModelCall(modelCall(`dispatch-${index}`));
          sends += 1;
        }
        return { action: "advance" };
      }, "requested-model"),
    },
  });
  assert.equal(sends, 2);
  assert.equal(result.modelCalls, 2);
  assert.equal(result.episodes[0]!.outcome.kind, "failed");
  assert.equal(result.episodes[0]!.decisions[0]!.acceptedAction, null);
});
