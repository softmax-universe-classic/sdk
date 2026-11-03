const messages = {
  invalid_input: "The runner configuration or recording is invalid.",
  run_conflict: "This directory already contains different run or episode evidence.",
  directory_locked:
    "This run directory is locked. Inspect its .execution-lock file before removing a stale lock.",
  storage_failed: "Local recording storage failed. Existing files were preserved.",
  missing_policy: "A trial participant has no matching policy configuration.",
  policy_failed: "The policy failed. No action was accepted.",
  game_failed: "The game failed while processing the episode.",
  invalid_game_result: "The game returned an invalid turn or result.",
  action_rejected: "The game rejected the submitted action.",
  provider_configuration: "The model provider configuration is invalid.",
  provider_aborted: "The model request was interrupted; its external outcome may be unknown.",
  provider_failed: "The model request failed; its external outcome may be unknown.",
  provider_http_error: "The model provider returned an unsuccessful HTTP status.",
  provider_invalid_response: "The model provider returned an invalid response.",
  provider_invalid_output: "The model did not return a valid legal-action index.",
  provider_response_too_large: "The model provider response exceeded the byte limit.",
  provider_input_too_large: "The model request exceeded the input limit.",
  decision_timeout: "The decision deadline was reached.",
  episode_timeout: "The episode deadline was reached.",
  run_timeout: "The run deadline was reached.",
  model_call_limit: "The run model-call limit was reached.",
  decision_limit: "The episode decision limit was reached.",
  cancelled: "The run was cancelled.",
  interrupted: "The process was interrupted. The active episode remains incomplete.",
  cleanup_failed:
    "A game or policy session did not close successfully within the cleanup deadline.",
  transport_failed: "The Universe request failed. Local recording files were preserved.",
  invalid_command: "Invalid command. Run universe --help for usage.",
} as const;

export type RunnerErrorCode = keyof typeof messages;

export class RunnerError extends Error {
  readonly code: RunnerErrorCode;
  readonly httpStatus?: number;

  constructor(code: RunnerErrorCode, httpStatus?: number) {
    const validStatus =
      code === "provider_http_error" &&
      typeof httpStatus === "number" &&
      Number.isInteger(httpStatus) &&
      httpStatus >= 100 &&
      httpStatus <= 599;
    super(validStatus ? `The model provider returned HTTP ${httpStatus}.` : messages[code]);
    this.name = "RunnerError";
    this.code = code;
    if (validStatus) this.httpStatus = httpStatus;
  }
}

export function safeError(error: unknown, fallback: RunnerErrorCode): RunnerError {
  return error instanceof RunnerError ? error : new RunnerError(fallback);
}
