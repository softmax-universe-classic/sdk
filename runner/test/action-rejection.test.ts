import { limits } from "./support/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { runBenchmark } from "../src/index.js";
import { directory, runDefinition, game, policy } from "./support/index.js";

test("the game rejection is recorded without changing or retrying the attempted action", async (t) => {
  const path = await directory(t);
  let attempts = 0;
  const rejected = await runBenchmark({
    run: runDefinition(),
    directory: path,
    limits,
    createGame: () => game(),
    policies: {
      baseline: policy(() => {
        attempts += 1;
        return { action: "illegal" };
      }),
    },
  });
  assert.equal(attempts, 1);
  assert.deepEqual(rejected.episodes[0]?.decisions[0], {
    index: 0,
    participantId: "player",
    observation: { accepted: 0 },
    attemptedAction: "illegal",
    acceptedAction: null,
    nextObservation: { accepted: 0 },
    status: "rejected",
    modelCalls: [],
    toolCalls: [],
    reservedModelCalls: 0,
  });
  assert.equal(rejected.episodes[0]?.outcome.kind, "failed");
});
