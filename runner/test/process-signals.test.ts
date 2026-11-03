import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import type { Run } from "@softmax-universe/protocol";
import { readRunDirectory, runBenchmark, uploadDirectory } from "../src/index.js";
import { directory, runDefinition, limits, game, policy, server, isCode } from "./support/index.js";

test("SIGTERM leaves an incomplete artifact and a later invocation skips its reserved model work", async (t) => {
  const path = await directory(t);
  const run = runDefinition(true, 2);
  const cappedLimits = { ...limits, maxModelCalls: 1 };
  const moduleUrl = new URL("../src/index.ts", import.meta.url).href;
  const script = `
    import { runBenchmark } from ${JSON.stringify(moduleUrl)};
    const run = ${JSON.stringify(run)};
    const policy = {
      definition: { kind: 'custom', revision: 'fixture-v1', model: 'requested-model', configuration: {} },
      open: () => ({ async decide(input) {
        await input.recordModelCall({ id: 'call-1', provider: 'test', requestedModel: 'requested-model', model: null, status: 'pending', input: 'known input', output: null, latencyMs: null });
        process.send('ready');
        return new Promise((resolve, reject) => input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }));
      } })
    };
    try {
      await runBenchmark({ run, directory: process.argv[1], limits: ${JSON.stringify(cappedLimits)}, policies: { model: policy }, createGame: () => ({
        getTurn: () => ({ participantId: 'player', observation: {}, legalActions: ['advance'] }),
        apply: () => { throw new Error('No action should be applied'); },
        getOutcome: () => null
      }) });
    } catch (error) { process.exitCode = error.code === 'interrupted' ? 75 : 1; }
  `;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script, path],
    {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });
  const exit = once(child, "exit");
  const ready = once(child, "message");
  await Promise.race([
    ready,
    exit.then(() => {
      throw new Error("Interruption fixture exited before readiness");
    }),
  ]);
  child.kill("SIGTERM");
  assert.equal((await exit)[0], 75);
  const before = await readRunDirectory(path);
  assert.equal(before.episodes[0]?.outcome.kind, "incomplete");
  assert.equal(before.episodes[0]?.decisions[0]?.status, "pending");
  assert.equal(before.episodes[0]?.decisions[0]?.modelCalls[0]?.input, "known input");
  const startedTrials: string[] = [];
  const replayOptions = {
    run,
    directory: path,
    limits: cappedLimits,
    createGame: (trial: Run["trials"][number]) => {
      startedTrials.push(trial.id);
      return game();
    },
    policies: {
      model: policy(() => {
        throw new Error("Must not call again");
      }, "requested-model"),
    },
  };
  const uploadStarted = Promise.withResolvers<void>();
  const finishUpload = Promise.withResolvers<void>();
  t.after(() => finishUpload.resolve());
  const endpoint = await server(t, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const document = JSON.parse(Buffer.concat(chunks).toString());
    response.setHeader("Content-Type", "application/json");
    if (request.url?.includes("/episodes/")) {
      assert.equal(document.outcome.kind, "incomplete");
      response.end(JSON.stringify({ episode: document }));
    } else {
      uploadStarted.resolve();
      await finishUpload.promise;
      response.end(JSON.stringify({ run: document }));
    }
  });
  const uploading = uploadDirectory(path, {
    endpoint: new URL(endpoint).origin,
    projectId: "test-project",
    token: "test-token",
  });
  await uploadStarted.promise;
  await assert.rejects(runBenchmark(replayOptions), isCode("directory_locked"));
  finishUpload.resolve();
  assert.equal((await uploading).episodes, 1);
  const replay = await runBenchmark(replayOptions);
  assert.deepEqual(startedTrials, ["trial-1"]);
  assert.deepEqual(replay.episodes[0], before.episodes[0]);
  assert.deepEqual(replay.episodes[1]?.outcome, {
    kind: "truncated",
    reason: "model_call_limit",
    scores: null,
  });
  assert.equal(replay.modelCalls, 1);
});
