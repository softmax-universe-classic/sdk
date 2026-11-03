import type { Run } from "@softmax-universe/protocol";
import { RunDirectory } from "./run-directory.js";

export async function saveRun(directory: string, run: Run): Promise<void> {
  const store = new RunDirectory(directory);
  const release = await store.acquireWriter();
  try {
    await store.saveRun(run);
  } finally {
    await release();
  }
}
