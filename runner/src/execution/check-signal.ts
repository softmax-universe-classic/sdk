import { safeError } from "../errors/index.js";

export function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw safeError(signal.reason, "cancelled");
}
