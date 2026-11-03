import { type PolicyErrorCode } from "./types.js";

export class PolicyError extends Error {
  constructor(
    readonly code: PolicyErrorCode,
    readonly httpStatus?: number,
  ) {
    super(code);
    this.name = "PolicyError";
  }
}
