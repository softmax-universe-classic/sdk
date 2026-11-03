import { readFile, stat } from "node:fs/promises";
import { RunnerError, safeError } from "../errors/index.js";
import { maxFileBytes } from "./constants.js";

export async function readJson(path: string): Promise<unknown> {
  const size = (await stat(path)).size;
  if (size > maxFileBytes) throw new RunnerError("invalid_input");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw safeError(error, "invalid_input");
  }
}
