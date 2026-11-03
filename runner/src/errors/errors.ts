import { type RunnerErrorCode, messages } from "./constants.js";

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
