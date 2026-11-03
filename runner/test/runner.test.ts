import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import type { ModelCall, Run } from "@softmax-universe/sdk";
import {
  createModelPolicy,
  readRunDirectory,
  runBenchmark,
  RunnerError,
  saveEpisode,
  uploadDirectory,
} from "../src/index.js";
import type { Policy, PolicySession, GameSession, RunLimits } from "../src/index.js";

const limits: RunLimits = {
  maxDecisionsPerEpisode: 8,
  maxModelCalls: 4,
  maxModelCallsPerDecision: 1,
  maxOutputTokens: 64,
  decisionTimeoutMs: 5_000,
  episodeTimeoutMs: 15_000,
  runTimeoutMs: 30_000,
};

function runDefinition(model = false, trials = 1): Run {
  return {
    schemaVersion: 2,
    id: "test-run",
    name: "Runner integration",
    createdAt: "2026-01-01T00:00:00.000Z",
    kind: "benchmark",
    game: { id: "test-game", version: "1" },
    configuration: {},
    trials: Array.from({ length: trials }, (_, index) => ({
      id: `trial-${index}`,
      seed: index,
      participants: model
        ? [
            {
              id: "player",
              label: "Model",
              kind: "bot",
              policy: "model",
              model: "requested-model",
            },
          ]
        : [{ id: "player", label: "Baseline", kind: "bot", policy: "baseline" }],
    })),
  };
}

function game(decisions = 1): GameSession {
  let accepted = 0;
  return {
    getTurn: () => ({
      participantId: "player",
      observation: { accepted },
      legalActions: ["advance"],
    }),
    apply: (action) => {
      const valid = action === "advance";
      if (valid) accepted += 1;
      return { accepted: valid, action: valid ? action : null, nextObservation: { accepted } };
    },
    getOutcome: () => (accepted >= decisions ? { scores: { player: 1 } } : null),
  };
}

function policy(decide: PolicySession["decide"], model?: string): Policy {
  const definition: Policy["definition"] = {
    kind: model ? "custom" : "baseline",
    revision: "fixture-v1",
    configuration: {},
  };
  if (model) definition.model = model;
  return { definition, open: () => ({ decide }) };
}

const baseline = policy(({ legalActions }) => ({ action: legalActions[0]! }));

async function directory(t: TestContext): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "universe-runner-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

async function server(
  t: TestContext,
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
): Promise<string> {
  const instance = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(() => {
      response.statusCode = 500;
      response.end();
    });
  });
  instance.listen(0, "127.0.0.1");
  await once(instance, "listening");
  t.after(async () => {
    instance.closeAllConnections();
    await new Promise<void>((resolve) => instance.close(() => resolve()));
  });
  const address = instance.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/chat/completions`;
}

function isCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof RunnerError && error.code === code;
}

test("finished episodes are durable before the next trial and never replayed or replaced", async (t) => {
  const path = await directory(t);
  const run = runDefinition(false, 2);
  let starts = 0;
  const options = {
    run,
    directory: path,
    limits,
    policies: { baseline },
    createGame: async () => {
      if (starts > 0) {
        const saved = await readRunDirectory(path);
        const firstTrial = saved.episodes.find((episode) => episode.trialId === run.trials[0]!.id);
        assert.equal(firstTrial?.outcome.kind, "terminated");
      }
      starts += 1;
      return game();
    },
  };
  const completed = await runBenchmark(options);
  assert.equal(
    completed.episodes.filter((episode) => episode.outcome.kind === "terminated").length,
    2,
  );
  const replay = await runBenchmark(options);
  assert.equal(starts, 2);
  assert.deepEqual(new Set(replay.episodes), new Set(completed.episodes));

  const changed = structuredClone(completed.episodes[0]!);
  changed.outcome = { kind: "terminated", scores: { player: 0 } };
  await assert.rejects(saveEpisode(path, completed.run, changed), isCode("run_conflict"));
  await assert.rejects(
    runBenchmark({ ...options, run: { ...run, name: "Changed run" } }),
    isCode("run_conflict"),
  );
  assert.deepEqual(new Set((await readRunDirectory(path)).episodes), new Set(completed.episodes));
  const otherPath = await directory(t);
  const otherRun = await runBenchmark({
    ...options,
    directory: otherPath,
    run: { ...run, id: "second-run" },
  });
  assert.equal(
    new Set([...completed.episodes, ...otherRun.episodes].map((episode) => episode.id)).size,
    4,
  );
});

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
  assert.ok(evidence?.input.includes("legalActions"));
  assert.ok(!JSON.stringify(result).includes(secret));
  await runBenchmark(options);
  assert.equal(requests, 1);
});

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

test("request input limits prevent dispatch and raw transport errors cannot leak credentials", async (t) => {
  for (const tooLarge of [true, false]) {
    const path = await directory(t);
    let requests = 0;
    const secret = "fixture-private-provider-key";
    const result = await runBenchmark({
      run: runDefinition(true),
      directory: path,
      limits,
      createGame: () => game(),
      policies: {
        model: createModelPolicy({
          apiKey: secret,
          model: "requested-model",
          endpoint: "http://127.0.0.1:1/chat/completions",
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

test("cancellation aborts the real provider connection and preserves unknown model outcome", async (t) => {
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
      model: createModelPolicy({ apiKey: "test-key", model: "requested-model", endpoint }),
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
  assert.ok(episode.decisions[0]?.modelCalls[0]?.input.includes("legalActions"));
  assert.ok(!JSON.stringify(episode).includes("raw credentials"));
});

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

function modelCall(id: string): ModelCall {
  return {
    id,
    provider: "fixture",
    requestedModel: "requested-model",
    model: null,
    input: "observed input",
    output: null,
    latencyMs: null,
    status: "pending",
  };
}

test("multi-dispatch policies persist reservations and release only settled unused work", async (t) => {
  const path = await directory(t);
  let opens = 0;
  let closes = 0;
  let decisions = 0;
  const bounded: Policy = {
    definition: {
      kind: "custom",
      revision: "fixture-v1",
      model: "requested-model",
      configuration: {},
    },
    open() {
      opens += 1;
      return {
        async decide(input) {
          decisions += 1;
          const saved = (await readRunDirectory(path)).episodes[0]!.decisions.at(-1)!;
          assert.equal(saved.reservedModelCalls, 3);
          const first = modelCall(`${input.decisionId}-first`);
          await input.recordModelCall(first);
          await input.recordModelCall({
            ...first,
            model: "resolved-model",
            output: "answer",
            status: "completed",
          });
          const pending = (await readRunDirectory(path)).episodes[0]!.decisions.at(-1)!;
          assert.equal(pending.modelCalls.length, 1);
          assert.equal(pending.reservedModelCalls, 2);
          await input.recordModelCall({
            ...modelCall(`${input.decisionId}-second`),
            model: "resolved-model",
            output: "answer",
            status: "completed",
          });
          await input.settleModelCalls();
          return { action: "advance" };
        },
        close() {
          closes += 1;
        },
      };
    },
  };
  const options = {
    run: runDefinition(true),
    directory: path,
    limits: { ...limits, maxModelCalls: 5, maxModelCallsPerDecision: 3 },
    createGame: () => game(2),
    policies: { model: bounded },
  };
  const result = await runBenchmark(options);
  assert.equal(result.episodes[0]!.outcome.kind, "terminated");
  assert.equal(result.modelCalls, 4);
  assert.ok(result.episodes[0]!.decisions.every((decision) => decision.reservedModelCalls === 0));
  await runBenchmark(options);
  assert.deepEqual({ opens, closes, decisions }, { opens: 1, closes: 1, decisions: 2 });
});

test("uncertain remote work keeps its whole unused allowance across later trials and invocation", async (t) => {
  const path = await directory(t);
  const cancellation = new AbortController();
  let sends = 0;
  const options = {
    run: runDefinition(true, 2),
    directory: path,
    limits: { ...limits, maxModelCalls: 3, maxModelCallsPerDecision: 3 },
    createGame: () => game(),
    policies: {
      model: policy(async (input) => {
        await input.recordModelCall({ ...modelCall(input.decisionId), status: "unknown" });
        sends += 1;
        cancellation.abort();
        throw new RunnerError("cancelled");
      }, "requested-model"),
    },
  };
  await assert.rejects(
    runBenchmark({ ...options, signal: cancellation.signal }),
    isCode("cancelled"),
  );
  const stopped = await readRunDirectory(path);
  assert.equal(stopped.episodes.length, 1);
  assert.equal(stopped.episodes[0]!.decisions[0]!.reservedModelCalls, 2);
  const result = await runBenchmark(options);
  assert.equal(result.modelCalls, 3);
  assert.deepEqual(result.episodes[1]!.outcome, {
    kind: "truncated",
    reason: "model_call_limit",
    scores: null,
  });
  assert.equal(sends, 1);
});

test("dispatch beyond the reserved allowance fails before a policy can send it", async (t) => {
  const path = await directory(t);
  let sends = 0;
  const result = await runBenchmark({
    run: runDefinition(true),
    directory: path,
    limits: { ...limits, maxModelCalls: 2, maxModelCallsPerDecision: 2 },
    createGame: () => game(),
    policies: {
      model: policy(async (input) => {
        for (let index = 0; index < 3; index += 1) {
          await input.recordModelCall(modelCall(`dispatch-${index}`));
          sends += 1;
        }
        return { action: "advance" };
      }, "requested-model"),
    },
  });
  assert.equal(sends, 2);
  assert.equal(result.modelCalls, 2);
  assert.equal(result.episodes[0]!.outcome.kind, "failed");
  assert.equal(result.episodes[0]!.decisions[0]!.acceptedAction, null);
});

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

test("CLI upload and dataset export use only saved files and preserve them on delivery failure", async (t) => {
  const path = await directory(t);
  const { run, episodes } = await runBenchmark({
    run: runDefinition(),
    directory: path,
    limits,
    createGame: () => game(),
    policies: { baseline },
  });
  const episodePath = join(path, "episodes", `${episodes[0]!.id}.json`);
  const original = await readFile(episodePath, "utf8");
  let fail = false;
  const methods: string[] = [];
  const endpoint = await server(t, async (request, response) => {
    methods.push(`${request.method} ${request.url}`);
    assert.equal(request.headers.authorization, "Bearer fixture-upload-secret");
    for await (const _chunk of request) {
      /* Drain the request before replying. */
    }
    response.setHeader("Content-Type", "application/json");
    if (fail) {
      response.statusCode = 503;
      response.end(JSON.stringify({ error: { message: "fixture-upload-secret" } }));
    } else if (request.url?.endsWith("/export")) {
      response.end(
        JSON.stringify({ schemaVersion: 2, exportedAt: "2026-01-02T00:00:00.000Z", run, episodes }),
      );
    } else if (request.url?.includes("/episodes/")) {
      response.end(JSON.stringify({ episode: episodes[0] }));
    } else {
      response.end(JSON.stringify({ run }));
    }
  });
  async function cli(args: string[]) {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        new URL("../src/cli.ts", import.meta.url).pathname,
        ...args,
        "--endpoint",
        new URL(endpoint).origin,
        "--project",
        "project-a",
        "--key-env",
        "UNIVERSE_TEST_TOKEN",
      ],
      {
        env: { ...process.env, UNIVERSE_TEST_TOKEN: "fixture-upload-secret" },
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    const [code] = await once(child, "exit");
    return { code, output };
  }
  assert.equal((await cli(["upload", path])).code, 0);
  const output = join(path, "dataset.json");
  assert.equal((await cli(["dataset", "export", run.id, "--out", output])).code, 0);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")).episodes, episodes);
  assert.deepEqual(methods, [
    "PUT /api/projects/project-a/runs/test-run",
    `PUT /api/projects/project-a/runs/test-run/episodes/${episodes[0]!.id}`,
    "GET /api/projects/project-a/runs/test-run/export",
  ]);
  fail = true;
  const failure = await cli(["upload", path]);
  assert.equal(failure.code, 1);
  assert.ok(!failure.output.includes("fixture-upload-secret"));
  assert.equal(await readFile(episodePath, "utf8"), original);
});
