import assert from "node:assert/strict";
import test from "node:test";
import { runExportSchema, summarizeRun } from "@softmax-universe/protocol";
import { makeRun, episode, endedAt } from "./support/index.js";

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
