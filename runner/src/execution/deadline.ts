import { RunnerError } from "../errors/index.js";
import type { RunnerErrorCode } from "../errors/index.js";

export function deadline(parent: AbortSignal, timeoutMs: number, code: RunnerErrorCode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new RunnerError(code)), timeoutMs);
  return {
    signal: AbortSignal.any([parent, controller.signal]),
    dispose: () => clearTimeout(timer),
  };
}
