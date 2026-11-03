import assert from "node:assert/strict";
import test from "node:test";
import { readRunDirectory, runBenchmark } from "../src/index.js";
import type { Policy } from "@softmax-universe/protocol";
import { directory, modelCall, runDefinition, limits, game } from "./support/index.js";

test("multi-dispatch policies persist reservations and release only settled unused work", async (t) => {
  const path = await directory(t);
  let opens = 0;
  let closes = 0;
  let decisions = 0;
  const bounded: Policy = {
    definition: {
      kind: "custom",
      revision: "fixture-v1",
      model: "requested-model",
      configuration: {},
    },
    open() {
      opens += 1;
      return {
        async decide(input) {
          decisions += 1;
          const saved = (await readRunDirectory(path)).episodes[0]!.decisions.at(-1)!;
          assert.equal(saved.reservedModelCalls, 3);
          const first = modelCall(`${input.decisionId}-first`);
          await input.recordModelCall(first);
          await input.recordModelCall({
            ...first,
            model: "resolved-model",
            output: "answer",
            status: "completed",
          });
          const pending = (await readRunDirectory(path)).episodes[0]!.decisions.at(-1)!;
          assert.equal(pending.modelCalls.length, 1);
          assert.equal(pending.reservedModelCalls, 2);
          await input.recordModelCall({
            ...modelCall(`${input.decisionId}-second`),
            model: "resolved-model",
            output: "answer",
            status: "completed",
          });
          await input.settleModelCalls();
          return { action: "advance" };
        },
        close() {
          closes += 1;
        },
      };
    },
  };
  const options = {
    run: runDefinition(true),
    directory: path,
    limits: { ...limits, maxModelCalls: 5, maxModelCallsPerDecision: 3 },
    createGame: () => game(2),
    policies: { model: bounded },
  };
  const result = await runBenchmark(options);
  assert.equal(result.episodes[0]!.outcome.kind, "terminated");
  assert.equal(result.modelCalls, 4);
  assert.ok(result.episodes[0]!.decisions.every((decision) => decision.reservedModelCalls === 0));
  await runBenchmark(options);
  assert.deepEqual({ opens, closes, decisions }, { opens: 1, closes: 1, decisions: 2 });
});
