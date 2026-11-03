import type { Episode, Run } from "@softmax-universe/protocol";
import { RunDirectory } from "./run-directory.js";

export async function readRunDirectory(
  directory: string,
): Promise<{ run: Run; episodes: Episode[] }> {
  return new RunDirectory(directory).readRecording();
}
