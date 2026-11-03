import { limits, baseline } from "./support/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readRunDirectory, runBenchmark, saveEpisode } from "../src/index.js";
import { directory, runDefinition, game, isCode } from "./support/index.js";

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
