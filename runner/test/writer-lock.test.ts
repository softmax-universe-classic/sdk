import { limits } from "./support/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { runBenchmark, uploadDirectory } from "../src/index.js";
import { directory, runDefinition, game, policy, isCode } from "./support/index.js";

test("active execution blocks another run or an upload from publishing its mutable checkpoint", async (t) => {
  const path = await directory(t);
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  t.after(() => finish.resolve());
  const options = {
    run: runDefinition(true),
    directory: path,
    limits,
    createGame: () => game(),
    policies: {
      model: policy(async (input) => {
        started.resolve();
        await finish.promise;
        await input.settleModelCalls();
        return { action: "advance" };
      }, "requested-model"),
    },
  };
  const first = runBenchmark(options);
  await started.promise;
  await assert.rejects(runBenchmark(options), isCode("directory_locked"));
  await assert.rejects(
    uploadDirectory(path, {
      endpoint: "http://127.0.0.1:1",
      projectId: "test-project",
      token: "test-token",
    }),
    isCode("directory_locked"),
  );
  finish.resolve();
  assert.equal((await first).episodes[0]?.outcome.kind, "terminated");
});
