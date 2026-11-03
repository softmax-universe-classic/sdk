import { createClient } from "@softmax-universe/sdk";
import { RunnerError } from "./errors.js";
import { RunDirectory, writeJsonFile } from "./storage.js";

export interface TransferOptions {
  endpoint: string;
  projectId: string;
  token: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function transferSignal(options: TransferOptions): AbortSignal {
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new RunnerError("invalid_input");
  }
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (options.signal) signals.push(options.signal);
  return AbortSignal.any(signals);
}

export async function uploadDirectory(
  directory: string,
  options: TransferOptions,
): Promise<{ episodes: number }> {
  const store = new RunDirectory(directory);
  const release = await store.lock();
  try {
    const { run, episodes } = await store.read();
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

export async function exportDataset(
  runId: string,
  output: string,
  options: TransferOptions,
): Promise<void> {
  let dataset;
  const signal = transferSignal(options);
  try {
    const client = createClient({
      baseUrl: options.endpoint,
      projectId: options.projectId,
      token: options.token,
    });
    dataset = await client.exportRun(runId, { signal });
  } catch {
    throw new RunnerError("transport_failed");
  }
  await writeJsonFile(output, dataset);
}
