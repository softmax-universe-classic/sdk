import { isDeepStrictEqual } from "node:util";
import type { Episode, Run } from "@softmax-universe/protocol";
import { RunnerError } from "../errors/index.js";
import { RunDirectory } from "./run-directory.js";

export async function saveEpisode(directory: string, run: Run, episode: Episode): Promise<void> {
  const store = new RunDirectory(directory);
  const release = await store.acquireWriter();
  try {
    await store.saveRun(run);
    const { episodes } = await store.readRecording();
    const existing = episodes.find(
      (entry) => entry.trialId === episode.trialId || entry.id === episode.id,
    );
    if (existing && !isDeepStrictEqual(existing, episode)) throw new RunnerError("run_conflict");
    await store.saveEpisode(run, episode);
  } finally {
    await release();
  }
}
