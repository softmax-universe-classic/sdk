import assert from "node:assert/strict";
import test from "node:test";
import {
  createClient,
  createRecorder,
  episodeSchema,
  runExportSchema,
  runSchema,
  summarizeRun,
  UniverseApiError,
  validateEpisodeForRun,
  validateRunEpisodes,
} from "../src/index.js";
import type { Decision, Episode, Outcome, Run } from "../src/index.js";

const startedAt = "2026-11-02T10:00:00.000Z";
const endedAt = "2026-11-02T10:01:00.000Z";

function makeRun(trialCount = 1): Run {
  return runSchema.parse({
    schemaVersion: 2,
    id: "run-1",
    name: "Policy comparison",
    createdAt: startedAt,
    kind: "benchmark",
    game: { id: "example", version: "1" },
    configuration: {},
    trials: Array.from({ length: trialCount }, (_, index) => ({
      id: `trial-${index}`,
      seed: index,
      participants: [
        { id: "black", label: "Black", kind: "bot", policy: "model", model: "requested-model" },
        { id: "white", label: "White", kind: "bot", policy: "baseline" },
      ],
    })),
  });
}

function decision(): Decision {
  return {
    index: 0,
    participantId: "black",
    observation: { available: [1] },
    attemptedAction: 1,
    acceptedAction: 1,
    nextObservation: { available: [] },
    status: "accepted",
    modelCalls: [
      {
        id: "call-1",
        status: "completed",
        requestedModel: "requested-model",
        provider: "fixture",
        model: "resolved-model",
        input: "Choose an action",
        output: "1",
        latencyMs: 20,
        inputTokens: 5,
        outputTokens: 1,
        costUsd: 0.01,
      },
    ],
    toolCalls: [],
    reservedModelCalls: 0,
  };
}

function episode(
  run: Run,
  trialIndex = 0,
  outcome: Outcome = {
    kind: "terminated",
    scores: { black: 1, white: 0 },
  },
): Episode {
  const trial = run.trials[trialIndex]!;
  return {
    schemaVersion: 2,
    id: `episode-${trialIndex}`,
    runId: run.id,
    trialId: trial.id,
    game: run.game,
    seed: trial.seed,
    participants: trial.participants,
    startedAt,
    endedAt: outcome.kind === "incomplete" ? null : endedAt,
    decisions: [decision()],
    outcome,
  };
}

test("recording boundaries reject false acceptance, lost ordering, and mismatched run evidence", () => {
  const run = makeRun();
  const valid = episode(run);
  assert.deepEqual(validateEpisodeForRun(run, valid), valid);
  const invalidEpisodes: unknown[] = [
    { ...valid, decisions: [{ ...decision(), status: "rejected" }] },
    { ...valid, decisions: [{ ...decision(), status: "error" }] },
    { ...valid, decisions: [{ ...decision(), index: 1 }] },
    {
      ...valid,
      decisions: [
        { ...decision(), modelCalls: [decision().modelCalls[0], decision().modelCalls[0]] },
      ],
    },
    { ...valid, decisions: [{ ...decision(), participantId: "outsider" }] },
    { ...valid, participants: [valid.participants[0], valid.participants[0]] },
    { ...valid, outcome: { kind: "terminated", scores: { black: 1 } } },
    { ...valid, outcome: { kind: "terminated", scores: { black: 1, white: Infinity } } },
    { ...valid, outcome: { kind: "terminated", scores: { black: 1, white: 0, outsider: 1 } } },
    { ...valid, endedAt: null },
    { ...valid, endedAt: "2026-11-01T10:00:00.000Z" },
    { ...valid, outcome: { kind: "incomplete" } },
  ];
  for (const invalid of invalidEpisodes) {
    assert.equal(episodeSchema.safeParse(invalid).success, false);
  }
  const mismatches: unknown[] = [
    { ...valid, runId: "other-run" },
    { ...valid, trialId: "undeclared-trial" },
    { ...valid, game: { ...valid.game, version: "2" } },
    { ...valid, seed: 999 },
    { ...valid, participants: [...valid.participants].reverse() },
    {
      ...valid,
      participants: valid.participants.map((participant) => ({
        ...participant,
        policy: "other",
      })),
    },
  ];
  for (const mismatch of mismatches) {
    assert.throws(() => validateEpisodeForRun(run, mismatch));
  }
  assert.throws(() => validateRunEpisodes(run, [valid, { ...valid, id: "duplicate-trial" }]));
  assert.equal(
    runSchema.safeParse({ ...run, trials: [run.trials[0], run.trials[0]] }).success,
    false,
  );
});

test("recorder snapshots retain in-flight evidence and cannot mutate saved decisions", () => {
  const recorder = createRecorder({
    run: makeRun(),
    trialId: "trial-0",
    episodeId: "recorded",
    startedAt,
  });
  const pending = {
    ...decision(),
    status: "pending" as const,
    attemptedAction: null,
    acceptedAction: null,
    nextObservation: null,
    modelCalls: [
      { ...decision().modelCalls[0]!, status: "pending" as const, output: null, latencyMs: null },
    ],
  };
  const recorded = recorder.recordDecision(pending);
  const checkpoint = recorder.snapshot();
  recorded.observation = "mutated-return-value";
  pending.modelCalls[0]!.input = "mutated-input";
  assert.equal(checkpoint.outcome.kind, "incomplete");
  assert.equal(checkpoint.endedAt, null);
  assert.equal(recorder.snapshot().decisions[0]?.modelCalls[0]?.input, "Choose an action");
  assert.throws(() =>
    recorder.finish({ kind: "terminated", scores: { black: 1, white: 0 } }, endedAt),
  );
  assert.throws(() => recorder.recordDecision(decision()));
  recorder.replacePendingDecision(decision());
  const finished = recorder.finish({ kind: "terminated", scores: { black: 1, white: 0 } }, endedAt);
  finished.decisions[0]!.acceptedAction = "mutated-finished-value";
  assert.equal(recorder.snapshot().decisions[0]?.acceptedAction, 1);
  assert.equal(checkpoint.decisions[0]?.status, "pending");
  assert.throws(() => recorder.recordDecision(decision()));
});

test("comparison keeps missing and unsuccessful coverage separate from completed scores", () => {
  const run = makeRun(6);
  const episodes = [
    episode(run),
    episode(run, 1, { kind: "failed", code: "CONTROLLER_ERROR", message: "Policy failed." }),
    episode(run, 2, { kind: "truncated", reason: "Decision limit", scores: null }),
    episode(run, 3, { kind: "cancelled", reason: "Stopped" }),
    episode(run, 4, { kind: "incomplete" }),
  ];
  episodes[4]!.decisions[0]!.modelCalls[0]!.latencyMs = null;
  delete episodes[4]!.decisions[0]!.modelCalls[0]!.inputTokens;
  const rows = summarizeRun(run, episodes);
  const model = rows.find((row) => row.policy === "model")!;
  assert.deepEqual(
    {
      planned: model.planned,
      played: model.played,
      completed: model.completed,
      failed: model.failed,
      truncated: model.truncated,
      cancelled: model.cancelled,
      incomplete: model.incomplete,
      missing: model.missing,
      averageScore: model.averageScore,
      latencyMs: model.latencyMs,
      inputTokens: model.inputTokens,
      outputTokens: model.outputTokens,
    },
    {
      planned: 6,
      played: 5,
      completed: 1,
      failed: 1,
      truncated: 1,
      cancelled: 1,
      incomplete: 1,
      missing: 1,
      averageScore: 1,
      latencyMs: null,
      inputTokens: null,
      outputTokens: 5,
    },
  );
  assert.equal(summarizeRun(run, episodes.slice(1))[0]?.averageScore, null);
  assert.throws(() => summarizeRun(run, [...episodes, { ...episodes[0]!, id: "duplicate" }]));
  const exported = runExportSchema.parse({ schemaVersion: 2, exportedAt: endedAt, run, episodes });
  assert.deepEqual(summarizeRun(exported.run, exported.episodes), rows);
});

test("comparison totals include every dispatch and keep unresolved reservations unknown", () => {
  const run = makeRun();
  const recorded = episode(run);
  const turn = recorded.decisions[0]!;
  turn.modelCalls.push({ ...turn.modelCalls[0]!, id: "call-2", costUsd: 0.02 });
  turn.toolCalls.push({
    id: "tool-1",
    name: "read",
    input: { path: "board.json" },
    output: null,
    latencyMs: null,
    status: "unknown",
  });
  const measured = summarizeRun(run, [recorded])[0]!;
  assert.equal(measured.modelCalls, 2);
  assert.equal(measured.toolCalls, 1);
  assert.equal(measured.costUsd, 0.03);
  turn.modelCalls = [];
  turn.reservedModelCalls = 2;
  const uncertain = summarizeRun(run, [recorded])[0]!;
  assert.equal(uncertain.reservedModelCalls, 2);
  assert.equal(uncertain.costUsd, null);
  assert.equal(uncertain.outputTokens, null);
});

test("same policy in both seats retains both declared participations", () => {
  const run = makeRun(2);
  for (const trial of run.trials) {
    for (const participant of trial.participants) {
      participant.policy = "baseline";
      delete participant.model;
    }
  }
  const rows = summarizeRun(run, [episode(run)]);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [
      rows[0]?.planned,
      rows[0]?.played,
      rows[0]?.completed,
      rows[0]?.missing,
      rows[0]?.averageScore,
    ],
    [4, 2, 2, 2, 0.5],
  );
});

test("HTTP reads validate returned identity and keep credentials and raw errors out of diagnostics", async () => {
  const run = makeRun();
  const requests: { url: string; options: RequestInit | undefined }[] = [];
  let response = Response.json({ run, episodes: [episode(run)] });
  const client = createClient({
    baseUrl: "https://universe.example",
    projectId: "project-1",
    token: "fixture-secret-token",
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      return response;
    },
  });
  assert.equal((await client.getRun(run.id)).episodes.length, 1);
  assert.equal(requests[0]?.url, "https://universe.example/api/projects/project-1/runs/run-1");
  assert.equal(requests[0]?.options?.credentials, "same-origin");
  assert.equal(
    new Headers(requests[0]?.options?.headers).get("Authorization"),
    "Bearer fixture-secret-token",
  );
  response = Response.json({ run: { ...run, id: "other-run" }, episodes: [] });
  await assert.rejects(client.getRun(run.id), (error: unknown) => {
    return error instanceof UniverseApiError && error.code === "INVALID_RESPONSE";
  });
  response = Response.json(
    { error: { code: "UNAUTHORIZED", message: "fixture-secret-token" } },
    { status: 401 },
  );
  await assert.rejects(client.listRuns(), (error: unknown) => {
    assert.ok(error instanceof UniverseApiError);
    assert.equal(error.status, 401);
    assert.equal(error.code, "UNAUTHORIZED");
    assert.equal(String(error).includes("fixture-secret-token"), false);
    return true;
  });
});
