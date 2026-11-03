import { startedAt } from "./support/index.js";
import { createRecorder } from "../src/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { makeRun, decision, endedAt } from "./support/index.js";

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
