import { RUN_FILE, EPISODES_FOLDER, EXECUTION_LOCK_FILE } from "./constants.js";
import { mkdir, open, readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runSchema, validateEpisodeForRun, validateRunEpisodes } from "@softmax-universe/protocol";
import type { Episode, Run } from "@softmax-universe/protocol";
import { RunnerError, safeError } from "../errors/index.js";
import { writeJsonFile, readJson, hasCode } from "../files/index.js";

export class RunDirectory {
  readonly path: string;

  constructor(directory: string) {
    this.path = resolve(directory);
  }

  async acquireWriter(): Promise<() => Promise<void>> {
    const lockPath = join(this.path, EXECUTION_LOCK_FILE);
    let lock;
    try {
      await mkdir(join(this.path, EPISODES_FOLDER), { recursive: true, mode: 0o700 });
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
      await writeJsonFile(join(this.path, RUN_FILE), runSchema.parse(run));
    } catch (error) {
      throw safeError(error, "invalid_input");
    }
  }

  async saveEpisode(run: Run, episode: Episode, replace = false): Promise<void> {
    try {
      const validated = validateEpisodeForRun(run, episode);
      await writeJsonFile(
        join(this.path, EPISODES_FOLDER, `${validated.id}.json`),
        validated,
        replace,
      );
    } catch (error) {
      throw safeError(error, "invalid_input");
    }
  }

  async readRecording(): Promise<{ run: Run; episodes: Episode[] }> {
    try {
      const run = runSchema.parse(await readJson(join(this.path, RUN_FILE)));
      const episodes: Episode[] = [];
      for (const name of (await readdir(join(this.path, EPISODES_FOLDER))).sort()) {
        if (!name.endsWith(".json")) continue;
        const episode = validateEpisodeForRun(
          run,
          await readJson(join(this.path, EPISODES_FOLDER, name)),
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
