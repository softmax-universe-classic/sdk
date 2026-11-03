import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

export async function directory(t: TestContext): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "universe-runner-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
