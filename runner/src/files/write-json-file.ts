import { hasCode } from "./has-code.js";
import { randomUUID } from "node:crypto";
import { open, rename, link, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { RunnerError, safeError } from "../errors/index.js";
import { maxFileBytes } from "./constants.js";
import { readJson } from "./read-json.js";

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
