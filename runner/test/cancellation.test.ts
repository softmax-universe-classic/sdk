import { limits } from "./support/index.js";
import { createModelPolicy } from "@softmax-universe/model-policy";
import assert from "node:assert/strict";
import test from "node:test";
import { readRunDirectory, runBenchmark } from "../src/index.js";
import { directory, server, runDefinition, game, isCode } from "./support/index.js";

test("cancellation aborts the Foundation connection and preserves unknown model outcome", async (t) => {
  const path = await directory(t);
  const cancellation = new AbortController();
  const received = Promise.withResolvers<void>();
  const disconnected = Promise.withResolvers<void>();
  const endpoint = await server(t, (_request, response) => {
    response.on("close", () => disconnected.resolve());
    received.resolve();
  });
  const running = runBenchmark({
    run: runDefinition(true),
    directory: path,
    limits,
    createGame: () => game(),
    signal: cancellation.signal,
    policies: {
      model: createModelPolicy({ token: "test-key", model: "requested-model", endpoint }),
    },
  });
  await received.promise;
  cancellation.abort(new Error("raw credentials must not appear"));
  await assert.rejects(running, isCode("cancelled"));
  await disconnected.promise;
  const episode = (await readRunDirectory(path)).episodes[0]!;
  assert.equal(episode.outcome.kind, "cancelled");
  assert.equal(episode.decisions[0]?.status, "error");
  assert.equal(episode.decisions[0]?.modelCalls[0]?.output, null);
  assert.ok(episode.decisions[0]?.modelCalls[0]?.request?.includes("legalActions"));
  assert.ok(!JSON.stringify(episode).includes("raw credentials"));
});
