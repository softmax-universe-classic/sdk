export class UniverseApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`Universe request failed (${code}).`);
    this.name = "UniverseApiError";
    this.status = status;
    this.code = code;
  }
}
