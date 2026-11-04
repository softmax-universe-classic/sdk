import { limits } from "./support/index.js";
import { createModelPolicy } from "@softmax-universe/model-policy";
import assert from "node:assert/strict";
import test from "node:test";
import { readRunDirectory, runBenchmark } from "../src/index.js";
import { directory, runDefinition, game } from "./support/index.js";

test("request input limits prevent dispatch and raw transport errors cannot leak credentials", async (t) => {
  for (const tooLarge of [true, false]) {
    const path = await directory(t);
    let requests = 0;
    const secret = "fixture-private-foundation-token";
    const result = await runBenchmark({
      run: runDefinition(true),
      directory: path,
      limits,
      createGame: () => game(),
      policies: {
        model: createModelPolicy({
          token: secret,
          model: "requested-model",
          endpoint: "http://127.0.0.1:1",
          maxInputChars: tooLarge ? 1 : 32_000,
          fetch: async () => {
            requests += 1;
            throw new Error(`Proxy-Authorization: ${secret}`);
          },
        }),
      },
    });
    assert.equal(requests, tooLarge ? 0 : 1);
    assert.equal(result.episodes[0]?.outcome.kind, "failed");
    assert.ok(!JSON.stringify(await readRunDirectory(path)).includes(secret));
  }
});
