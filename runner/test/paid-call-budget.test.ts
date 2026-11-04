import { createModelPolicy } from "@softmax-universe/model-policy";
import assert from "node:assert/strict";
import test from "node:test";
import { readRunDirectory, runBenchmark } from "../src/index.js";
import { directory, server, runDefinition, limits, game, modelCall } from "./support/index.js";
import type { ModelCall } from "@softmax-universe/protocol";

test("Foundation polling preserves the durable request and charges one call across saved-trial reuse", async (t) => {
  const path = await directory(t);
  const secret = "fixture-foundation-secret";
  let submissions = 0;
  let polls = 0;
  let wire = "";
  let initialEvidence: ModelCall | undefined;
  let id = "";
  const endpoint = await server(t, async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    response.setHeader("Content-Type", "application/json");
    if (request.method === "POST") {
      submissions += 1;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      wire = Buffer.concat(chunks).toString();
      id = JSON.parse(wire).id;
      initialEvidence = (await readRunDirectory(path)).episodes[0]?.decisions[0]?.modelCalls[0];
      response.statusCode = 202;
      response.end(JSON.stringify({ call: { ...modelCall(id), provider: "openrouter" } }));
      return;
    }
    polls += 1;
    assert.equal(request.url, `/api/v1/models/calls/${id}`);
    response.end(
      JSON.stringify({
        call: {
          ...modelCall(id),
          provider: "openrouter",
          input: "observed provider request",
          model: "resolved-model-version",
          status: "completed",
          output: '{"actionIndex":0}',
          inputTokens: 40,
          outputTokens: 8,
          costUsd: 0.0001,
        },
      }),
    );
  });
  const options = {
    run: runDefinition(true),
    directory: path,
    limits: { ...limits, maxModelCalls: 1 },
    createGame: () => game(2),
    policies: {
      model: createModelPolicy({ token: secret, model: "requested-model", endpoint }),
    },
  };
  const result = await runBenchmark(options);
  assert.equal(submissions, 1);
  assert.ok(polls > 0);
  assert.equal(initialEvidence?.id, id);
  assert.equal(initialEvidence?.request, wire);
  assert.equal(initialEvidence?.output, null);
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
  assert.equal(evidence?.input, "observed provider request");
  assert.equal(evidence?.request, wire);
  assert.ok(!JSON.stringify(result).includes(secret));
  await runBenchmark(options);
  assert.equal(submissions, 1);
});
