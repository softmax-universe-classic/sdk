import { createClient } from "@softmax-universe/sdk";
import { RunnerError } from "../errors/index.js";
import { writeJsonFile } from "../files/index.js";
import { type TransferOptions } from "./types.js";
import { transferSignal } from "./transfer-signal.js";

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
