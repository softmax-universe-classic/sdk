import assert from "node:assert/strict";
import test from "node:test";
import {
  episodeSchema,
  runSchema,
  validateEpisodeForRun,
  validateRunEpisodes,
} from "@softmax-universe/protocol";
import { makeRun, episode, decision } from "./support/index.js";

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
