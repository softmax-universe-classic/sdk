import { RunnerError } from "../../src/index.js";

export function isCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof RunnerError && error.code === code;
}
