import { executeBenchmark } from "./benchmark/index.js";
import { RunnerError } from "./errors/index.js";
import { RunDirectory } from "./storage/index.js";
import type { BenchmarkOptions, BenchmarkResult } from "./types.js";

export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkResult> {
  const store = new RunDirectory(options.directory);
  const interrupt = new AbortController();
  const cancel = new AbortController();
  const onInterrupt = () => interrupt.abort(new RunnerError("interrupted"));
  const onCancel = () => cancel.abort(new RunnerError("cancelled"));
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  options.signal?.addEventListener("abort", onCancel, { once: true });
  if (options.signal?.aborted) onCancel();
  try {
    const result = await executeBenchmark({
      run: options.run,
      createGame: options.createGame,
      policies: options.policies,
      limits: options.limits,
      store,
      signal: AbortSignal.any([interrupt.signal, cancel.signal]),
    });
    return { ...result, directory: store.path };
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onInterrupt);
    options.signal?.removeEventListener("abort", onCancel);
  }
}
