import type { Run } from "@softmax-universe/protocol";

export function runDefinition(model = false, trials = 1): Run {
  return {
    schemaVersion: 2,
    id: "test-run",
    name: "Runner integration",
    createdAt: "2026-01-01T00:00:00.000Z",
    kind: "benchmark",
    game: { id: "test-game", version: "1" },
    configuration: {},
    trials: Array.from({ length: trials }, (_, index) => ({
      id: `trial-${index}`,
      seed: index,
      participants: model
        ? [
            {
              id: "player",
              label: "Model",
              kind: "bot",
              policy: "model",
              model: "requested-model",
            },
          ]
        : [{ id: "player", label: "Baseline", kind: "bot", policy: "baseline" }],
    })),
  };
}
