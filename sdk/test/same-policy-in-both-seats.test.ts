import assert from "node:assert/strict";
import test from "node:test";
import { summarizeRun } from "@softmax-universe/protocol";
import { makeRun, episode } from "./support/index.js";

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
