import { createModelPolicy } from "@softmax-universe/model-policy";
import assert from "node:assert/strict";
import test from "node:test";
import { runBenchmark, RunnerError } from "../src/index.js";
import { directory, server, runDefinition, limits, game } from "./support/index.js";

test("a provider timeout consumes one reservation and persists a failed decision", async (t) => {
  const path = await directory(t);
  let requests = 0;
  const endpoint = await server(t, () => {
    requests += 1;
  });
  const result = await runBenchmark({
    run: runDefinition(true),
    directory: path,
    limits: { ...limits, decisionTimeoutMs: 300 },
    createGame: () => game(),
    policies: {
      model: createModelPolicy({ apiKey: "test-key", model: "requested-model", endpoint }),
    },
  });
  assert.equal(requests, 1);
  assert.equal(result.modelCalls, 1);
  assert.deepEqual(result.episodes[0]?.outcome, {
    kind: "failed",
    code: "decision_timeout",
    message: new RunnerError("decision_timeout").message,
  });
});
