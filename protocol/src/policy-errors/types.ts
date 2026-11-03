export type PolicyErrorCode =
  | "invalid_input"
  | "model_call_limit"
  | "provider_configuration"
  | "provider_aborted"
  | "provider_failed"
  | "provider_http_error"
  | "provider_invalid_response"
  | "provider_invalid_output"
  | "provider_response_too_large"
  | "provider_input_too_large";
