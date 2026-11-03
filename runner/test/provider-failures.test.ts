import { createModelPolicy } from "@softmax-universe/model-policy";
import assert from "node:assert/strict";
import test from "node:test";
import { readRunDirectory, runBenchmark } from "../src/index.js";
import { directory, server, runDefinition, limits, game } from "./support/index.js";

test("provider failures are bounded, sanitized, and never retried", async (t) => {
  const secret = "fixture-secret-that-must-not-leak";
  for (const mode of ["invalid-output", "missing-content", "http-error", "oversize"] as const) {
    await t.test(mode, async (t) => {
      const path = await directory(t);
      let requests = 0;
      const endpoint = await server(t, (_request, response) => {
        requests += 1;
        response.setHeader("Content-Type", "application/json");
        if (mode === "http-error") {
          response.statusCode = 502;
          response.end(JSON.stringify({ error: { message: `Authorization: Bearer ${secret}` } }));
        } else if (mode === "oversize") {
          response.end("x".repeat(1_025));
        } else if (mode === "missing-content") {
          response.end(
            JSON.stringify({
              model: "resolved-model-version",
              choices: [{ message: { content: null, reasoning: "private reasoning sentinel" } }],
              usage: { prompt_tokens: 40, completion_tokens: 64, cost: 0.0005 },
            }),
          );
        } else {
          response.end(
            JSON.stringify({
              model: "requested-model",
              choices: [{ message: { content: '{"actionIndex":999}' } }],
            }),
          );
        }
      });
      const result = await runBenchmark({
        run: runDefinition(true, mode === "http-error" ? 2 : 1),
        directory: path,
        limits: { ...limits, maxModelCalls: 3, maxModelCallsPerDecision: 3 },
        createGame: () => game(),
        policies: {
          model: createModelPolicy({
            apiKey: secret,
            model: "requested-model",
            endpoint,
            maxResponseBytes: 1_024,
          }),
        },
      });
      assert.equal(requests, mode === "http-error" ? 2 : 1);
      assert.equal(result.modelCalls, requests);
      assert.ok(result.episodes.every((episode) => episode.decisions[0]?.reservedModelCalls === 0));
      const outcome = result.episodes[0]!.outcome;
      assert.equal(outcome.kind, "failed");
      if (outcome.kind === "failed") {
        const expected = {
          "invalid-output": "provider_invalid_output",
          "missing-content": "provider_invalid_response",
          "http-error": "provider_http_error",
          oversize: "provider_response_too_large",
        };
        assert.equal(outcome.code, expected[mode]);
        if (mode === "http-error")
          assert.equal(outcome.message, "The model provider returned HTTP 502.");
      }
      if (mode === "missing-content") {
        const call = result.episodes[0]?.decisions[0]?.modelCalls[0];
        assert.equal(call?.model, "resolved-model-version");
        assert.equal(call?.inputTokens, 40);
        assert.equal(call?.outputTokens, 64);
        assert.equal(call?.costUsd, 0.0005);
        assert.equal(typeof call?.latencyMs, "number");
        assert.equal(call?.output, null);
        assert.ok(
          !JSON.stringify(await readRunDirectory(path)).includes("private reasoning sentinel"),
        );
      }
      assert.equal(result.episodes[0]?.decisions[0]?.acceptedAction, null);
      assert.ok(!JSON.stringify(await readRunDirectory(path)).includes(secret));
    });
  }
});
