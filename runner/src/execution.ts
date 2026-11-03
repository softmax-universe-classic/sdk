import { RunnerError, safeError } from "./errors.js";
import type { RunnerErrorCode } from "./errors.js";
import type { MaybePromise } from "./types.js";

export function deadline(parent: AbortSignal, timeoutMs: number, code: RunnerErrorCode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new RunnerError(code)), timeoutMs);
  return {
    signal: AbortSignal.any([parent, controller.signal]),
    dispose: () => clearTimeout(timer),
  };
}

export function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw safeError(signal.reason, "cancelled");
}

export async function abortable<T>(
  operation: () => MaybePromise<T>,
  signal: AbortSignal,
): Promise<T> {
  checkSignal(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(safeError(signal.reason, "cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        checkSignal(signal);
        return operation();
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
