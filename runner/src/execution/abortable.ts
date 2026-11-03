import { safeError } from "../errors/index.js";
import type { MaybePromise } from "@softmax-universe/protocol";
import { checkSignal } from "./check-signal.js";

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
