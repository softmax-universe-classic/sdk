import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, link, unlink, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { runSchema, validateEpisodeForRun, validateRunEpisodes } from "@softmax-universe/sdk";
import type { Episode, Run } from "@softmax-universe/sdk";
import { RunnerError, safeError } from "./errors.js";

const maxFileBytes = 64 * 1024 * 1024;

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function readJson(path: string): Promise<unknown> {
  const size = (await stat(path)).size;
  if (size > maxFileBytes) throw new RunnerError("invalid_input");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw safeError(error, "invalid_input");
  }
}

export async function writeJsonFile(path: string, value: unknown, replace = false): Promise<void> {
  const bytes = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(bytes) > maxFileBytes) throw new RunnerError("storage_failed");
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (replace) {
      await rename(temporary, path);
    } else {
      try {
        await link(temporary, path);
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
        if (!isDeepStrictEqual(await readJson(path), value)) throw new RunnerError("run_conflict");
      }
    }
    const parent = await open(dirname(path), "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } catch (error) {
    throw safeError(error, "storage_failed");
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

export class RunDirectory {
  readonly path: string;

  constructor(directory: string) {
    this.path = resolve(directory);
  }

  async lock(): Promise<() => Promise<void>> {
    const lockPath = join(this.path, ".execution-lock");
    let lock;
    try {
      await mkdir(join(this.path, "episodes"), { recursive: true, mode: 0o700 });
      lock = await open(lockPath, "wx", 0o600);
      await lock.writeFile(
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      );
    } catch (error) {
      if (lock) await unlink(lockPath).catch(() => {});
      if (hasCode(error, "EEXIST")) throw new RunnerError("directory_locked");
      throw new RunnerError("storage_failed");
    } finally {
      await lock?.close();
    }
    return async () => {
      try {
        await unlink(lockPath);
      } catch {
        throw new RunnerError("storage_failed");
      }
    };
  }

  async saveRun(run: Run): Promise<void> {
    try {
      await writeJsonFile(join(this.path, "run.json"), runSchema.parse(run));
    } catch (error) {
      throw safeError(error, "invalid_input");
    }
  }

  async saveEpisode(run: Run, episode: Episode, replace = false): Promise<void> {
    try {
      const validated = validateEpisodeForRun(run, episode);
      await writeJsonFile(join(this.path, "episodes", `${validated.id}.json`), validated, replace);
    } catch (error) {
      throw safeError(error, "invalid_input");
    }
  }

  async read(): Promise<{ run: Run; episodes: Episode[] }> {
    try {
      const run = runSchema.parse(await readJson(join(this.path, "run.json")));
      const episodes: Episode[] = [];
      for (const name of (await readdir(join(this.path, "episodes"))).sort()) {
        if (!name.endsWith(".json")) continue;
        const episode = validateEpisodeForRun(
          run,
          await readJson(join(this.path, "episodes", name)),
        );
        if (name !== `${episode.id}.json`) throw new RunnerError("invalid_input");
        episodes.push(episode);
      }
      return { run, episodes: validateRunEpisodes(run, episodes) };
    } catch (error) {
      throw safeError(error, "invalid_input");
    }
  }
}

export async function saveRun(directory: string, run: Run): Promise<void> {
  const store = new RunDirectory(directory);
  const release = await store.lock();
  try {
    await store.saveRun(run);
  } finally {
    await release();
  }
}

export async function saveEpisode(directory: string, run: Run, episode: Episode): Promise<void> {
  const store = new RunDirectory(directory);
  const release = await store.lock();
  try {
    await store.saveRun(run);
    const { episodes } = await store.read();
    const existing = episodes.find(
      (entry) => entry.trialId === episode.trialId || entry.id === episode.id,
    );
    if (existing && !isDeepStrictEqual(existing, episode)) throw new RunnerError("run_conflict");
    await store.saveEpisode(run, episode);
  } finally {
    await release();
  }
}

export async function readRunDirectory(
  directory: string,
): Promise<{ run: Run; episodes: Episode[] }> {
  return new RunDirectory(directory).read();
}
