import { createClient } from "@softmax-universe/sdk";
import { RunnerError } from "../errors/index.js";
import { RunDirectory } from "../storage/index.js";
import { type TransferOptions } from "./types.js";
import { transferSignal } from "./transfer-signal.js";

export async function uploadDirectory(
  directory: string,
  options: TransferOptions,
): Promise<{ episodes: number }> {
  const store = new RunDirectory(directory);
  const release = await store.acquireWriter();
  try {
    const { run, episodes } = await store.readRecording();
    const signal = transferSignal(options);
    try {
      const client = createClient({
        baseUrl: options.endpoint,
        projectId: options.projectId,
        token: options.token,
      });
      await client.putRun(run, { signal });
      for (const episode of episodes) await client.putEpisode(run.id, episode, { signal });
      return { episodes: episodes.length };
    } catch {
      throw new RunnerError("transport_failed");
    }
  } finally {
    await release();
  }
}
