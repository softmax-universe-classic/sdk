# Universe protocol

Runtime-neutral recording schemas, validation, summaries, and game/policy interfaces. The SDK, runner, policy adapters, and platform consume this package through its public entry point. It performs no networking or filesystem operations.

## Comparison

```ts
import { summarizeRun } from "@softmax-universe/protocol";

const rows = summarizeRun(downloaded.run, downloaded.episodes);
```

Rows group participant appearances by kind, policy, and configured model. Each row includes participant labels,
planned and played counts, all outcome counts, missing coverage, decisions, and model usage. A policy playing
both seats contributes two appearances per trial. `played` means a saved episode exists, including unfinished work.

Only terminated episodes contribute to `averageScore`; it is `null` without terminated evidence. Truncated, failed,
cancelled, incomplete, and missing work never become ordinary scores. A latency, token, or cost total is `null` if any
recorded model call lacks that measurement or any reserved calls remain unresolved. With no calls or reservations,
totals are zero. Every observed dispatch contributes independently. Tool calls and unresolved reservations have separate
counts. Model-call evidence preserves the provider's resolved model while comparison rows identify the configured model.

## Schemas

JSON Schema 2020-12 is available at `@softmax-universe/protocol/schemas/run.schema.json`,
`@softmax-universe/protocol/schemas/episode.schema.json`, and
`@softmax-universe/protocol/schemas/run-export.schema.json`. These describe structural validation. The protocol
validators also check participant membership, contiguous decision indices, outcome timestamps, and episode/trial matching.
The build regenerates these schemas from the same source used at runtime.
