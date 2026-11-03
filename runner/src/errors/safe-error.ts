import { PolicyError } from "@softmax-universe/protocol";
import { type RunnerErrorCode } from "./constants.js";
import { RunnerError } from "./errors.js";

export function safeError(error: unknown, fallback: RunnerErrorCode): RunnerError {
  if (error instanceof RunnerError) return error;
  if (error instanceof PolicyError) return new RunnerError(error.code, error.httpStatus);
  return new RunnerError(fallback);
}
