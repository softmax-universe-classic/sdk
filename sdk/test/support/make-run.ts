import { runSchema } from "@softmax-universe/protocol";
import type { Run } from "@softmax-universe/protocol";
import { startedAt } from "./constants.js";

export function makeRun(trialCount = 1): Run {
  return runSchema.parse({
    schemaVersion: 2,
    id: "run-1",
    name: "Policy comparison",
    createdAt: startedAt,
    kind: "benchmark",
    game: { id: "example", version: "1" },
    configuration: {},
    trials: Array.from({ length: trialCount }, (_, index) => ({
      id: `trial-${index}`,
      seed: index,
      participants: [
        { id: "black", label: "Black", kind: "bot", policy: "model", model: "requested-model" },
        { id: "white", label: "White", kind: "bot", policy: "baseline" },
      ],
    })),
  });
}
