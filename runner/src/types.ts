import type { ExecutionOptions, ExecutionResult } from "./benchmark/index.js";

export type BenchmarkOptions = Omit<ExecutionOptions, "store" | "signal"> & {
  directory: string;
  signal?: AbortSignal;
};

export interface BenchmarkResult extends ExecutionResult {
  directory: string;
}
