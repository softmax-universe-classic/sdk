import { RunnerError } from "../errors/index.js";
import { type TransferOptions } from "./types.js";

export function transferSignal(options: TransferOptions): AbortSignal {
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new RunnerError("invalid_input");
  }
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (options.signal) signals.push(options.signal);
  return AbortSignal.any(signals);
}
