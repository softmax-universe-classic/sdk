import assert from "node:assert/strict";
import test from "node:test";
import { readRunDirectory, runBenchmark, RunnerError } from "../src/index.js";
import {
  directory,
  runDefinition,
  limits,
  game,
  policy,
  modelCall,
  isCode,
} from "./support/index.js";

test("uncertain remote work keeps its whole unused allowance across later trials and invocation", async (t) => {
  const path = await directory(t);
  const cancellation = new AbortController();
  let sends = 0;
  const options = {
    run: runDefinition(true, 2),
    directory: path,
    limits: { ...limits, maxModelCalls: 3, maxModelCallsPerDecision: 3 },
    createGame: () => game(),
    policies: {
      model: policy(async (input) => {
        await input.recordModelCall({ ...modelCall(input.decisionId), status: "unknown" });
        sends += 1;
        cancellation.abort();
        throw new RunnerError("cancelled");
      }, "requested-model"),
    },
  };
  await assert.rejects(
    runBenchmark({ ...options, signal: cancellation.signal }),
    isCode("cancelled"),
  );
  const stopped = await readRunDirectory(path);
  assert.equal(stopped.episodes.length, 1);
  assert.equal(stopped.episodes[0]!.decisions[0]!.reservedModelCalls, 2);
  const result = await runBenchmark(options);
  assert.equal(result.modelCalls, 3);
  assert.deepEqual(result.episodes[1]!.outcome, {
    kind: "truncated",
    reason: "model_call_limit",
    scores: null,
  });
  assert.equal(sends, 1);
});
