import { createModelPolicy } from "@softmax-universe/model-policy";
import assert from "node:assert/strict";
import test from "node:test";
import { readRunDirectory, runBenchmark } from "../src/index.js";
import { directory, server, runDefinition, limits, game, modelCall } from "./support/index.js";

test("Foundation failures preserve uncertainty and never accept an invalid action", async (t) => {
  const secret = "fixture-secret-that-must-not-leak";
  for (const mode of ["invalid-output", "admission-rejected", "unknown"] as const) {
    await t.test(mode, async (t) => {
      const path = await directory(t);
      let requests = 0;
      const endpoint = await server(t, async (request, response) => {
        requests += 1;
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const { id } = JSON.parse(Buffer.concat(chunks).toString());
        response.setHeader("Content-Type", "application/json");
        if (mode === "admission-rejected") {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: "model_not_allowed" }));
          return;
        }
        response.end(
          JSON.stringify({
            call: {
              ...modelCall(id),
              provider: "openrouter",
              status: mode === "unknown" ? "unknown" : "completed",
              output: mode === "unknown" ? null : '{"actionIndex":999}',
            },
          }),
        );
      });
      const result = await runBenchmark({
        run: runDefinition(true, 2),
        directory: path,
        limits: { ...limits, maxModelCalls: 3, maxModelCallsPerDecision: 3 },
        createGame: () => game(),
        policies: {
          model: createModelPolicy({ token: secret, model: "requested-model", endpoint }),
        },
      });
      const uncertain = mode === "unknown";
      assert.equal(requests, uncertain ? 1 : 2);
      assert.equal(result.modelCalls, uncertain ? 3 : 2);
      const first = result.episodes[0]!.decisions[0]!;
      assert.equal(first.reservedModelCalls, uncertain ? 2 : 0);
      assert.equal(first.acceptedAction, null);
      const outcome = result.episodes[0]!.outcome;
      assert.equal(outcome.kind, "failed");
      if (outcome.kind === "failed") {
        assert.equal(
          outcome.code,
          mode === "invalid-output" ? "provider_invalid_output" : "provider_failed",
        );
      }
      if (uncertain) {
        assert.equal(first.modelCalls[0]?.status, "unknown");
        assert.equal(result.episodes[1]?.outcome.kind, "truncated");
      }
      assert.ok(!JSON.stringify(await readRunDirectory(path)).includes(secret));
    });
  }
});
