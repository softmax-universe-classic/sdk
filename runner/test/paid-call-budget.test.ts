import { createModelPolicy } from "@softmax-universe/model-policy";
import assert from "node:assert/strict";
import test from "node:test";
import { readRunDirectory, runBenchmark } from "../src/index.js";
import { directory, server, runDefinition, limits, game } from "./support/index.js";

test("real HTTP model requests preserve evidence and stop at the paid-call budget", async (t) => {
  const path = await directory(t);
  const secret = "fixture-provider-secret";
  let requests = 0;
  let wire: string | undefined;
  let initialEvidence: unknown;
  const endpoint = await server(t, async (request, response) => {
    requests += 1;
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    wire = Buffer.concat(chunks).toString();
    initialEvidence = (await readRunDirectory(path)).episodes[0]?.decisions[0]?.modelCalls[0];
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        model: "resolved-model-version",
        choices: [{ message: { content: '{"actionIndex":0}' } }],
        usage: { prompt_tokens: 40, completion_tokens: 8, cost: 0.0001 },
      }),
    );
  });
  const options = {
    run: runDefinition(true),
    directory: path,
    limits: { ...limits, maxModelCalls: 1 },
    createGame: () => game(2),
    policies: {
      model: createModelPolicy({ apiKey: secret, model: "requested-model", endpoint }),
    },
  };
  const result = await runBenchmark(options);
  assert.equal(requests, 1);
  assert.equal((initialEvidence as { input: string }).input, wire);
  assert.equal((initialEvidence as { output: unknown }).output, null);
  assert.equal(result.modelCalls, 1);
  assert.deepEqual(result.episodes[0]?.outcome, {
    kind: "truncated",
    reason: "model_call_limit",
    scores: null,
  });
  const evidence = result.episodes[0]?.decisions[0]?.modelCalls[0];
  assert.equal(evidence?.model, "resolved-model-version");
  assert.equal(evidence?.costUsd, 0.0001);
  assert.equal(evidence?.outputTokens, 8);
  assert.ok(evidence?.input?.includes("legalActions"));
  assert.ok(!JSON.stringify(result).includes(secret));
  await runBenchmark(options);
  assert.equal(requests, 1);
});
