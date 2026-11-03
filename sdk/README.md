# Universe SDK

Record game decisions and upload saved work. This package works in browsers and Node and depends on the
[Universe protocol](../protocol/README.md) for recording validation. The game remains responsible for legal actions and outcomes.

```sh
pnpm add https://github.com/softmax-universe/sdk/releases/download/sdk-v0.3.0-alpha.1/softmax-universe-sdk-0.3.0-alpha.1.tgz
```

[Public releases](https://github.com/softmax-universe/sdk/releases) contain immutable package archives and their
checked source. The package name used in imports remains `@softmax-universe/sdk`.

## Recording

Define a version 2 `Run` with its game version, trial seeds, and participants before play. A participant ID identifies
a seat within a trial; its policy and optional model identify who plays that seat. Every trial has a unique ID.

```ts
import { createRecorder } from "@softmax-universe/sdk";
import { runSchema } from "@softmax-universe/protocol";

const run = runSchema.parse({
  schemaVersion: 2,
  id: "demo-run",
  name: "Human play",
  createdAt: new Date().toISOString(),
  kind: "play",
  game: { id: "reversi", version: "3.0.0" },
  configuration: {},
  trials: [
    {
      id: "game-1",
      seed: 0,
      participants: [
        { id: "black", label: "You", kind: "human", policy: "human" },
        { id: "white", label: "Baseline", kind: "bot", policy: "baseline" },
      ],
    },
  ],
});

const recorder = createRecorder({ run, trialId: "game-1", episodeId: "episode-1" });
const checkpoint = recorder.snapshot();
```

After asking the game to apply an action, call `recordDecision` with its actual observation, attempted action,
accepted action, resulting observation, and status. The recorder assigns decision indices. Rejected or failed actions
must use `acceptedAction: null`. The SDK does not repair actions or infer game results.

`snapshot()` returns a detached episode value. Save it with your application's persistence, or use
`@softmax-universe/runner` for local execution and files. `finish(outcome)` validates the final outcome and closes the
recorder. Terminated scores must include every participant. Truncation can use `scores: null` when the game has no
score for the unfinished position. Failure and cancellation remain distinct outcomes.

For in-flight checkpoints, record a `pending` decision and use `replacePendingDecision` when more evidence arrives.
Pending `acceptedAction` and `nextObservation` stay `null`. `attemptedAction` can be `null` until the policy responds.
Each decision records `modelCalls`, `toolCalls`, and `reservedModelCalls`. The recorder supplies empty call arrays and
zero reservations when omitted, so human play needs no model-specific fields. A call keeps a stable ID while its
status changes from pending to completed, failed, or unknown. Actual model, output, and latency can be `null` when
unavailable. `requestedModel` preserves the requested model independently of the model returned by the provider.

An unsettled remote policy can retain unused `reservedModelCalls` after timeout or interruption. These reservations
represent dispatches that may still have occurred, not measured usage. Optional `runtime` records identify the Mechane
request and turn. Policy definitions belong in `run.configuration.policies`; the runner writes these snapshots.

Only the final decision in an incomplete episode can remain pending. Convert it to an actual accepted, rejected, or
error decision before finishing the episode.

The exported TypeScript types describe all fields. `runSchema`, `episodeSchema`, `validateEpisodeForRun`, and
`validateRunEpisodes` validate untrusted documents. They reject duplicate IDs, undeclared participants, mismatched
games or seeds, decision gaps, inconsistent timestamps, and duplicate trial results.

## Upload and read

Configure the API endpoint and project explicitly. There is no default hosted endpoint or automatic retry.

```ts
import { createClient } from "@softmax-universe/sdk";

const client = createClient({
  baseUrl: "http://localhost:4317",
  projectId: "my-project",
  token: process.env.UNIVERSE_UPLOAD_TOKEN,
});

const finished = recorder.finish({ kind: "cancelled", reason: "Demo stopped before play" });
await client.putRun(run);
await client.putEpisode(run.id, finished);
const { episodes } = await client.getRun(run.id);
const downloaded = await client.exportRun(run.id);
```

This snippet continues the recording example. Save local work before upload. Uploads are immutable: retry the same
document after a transport failure; do not upload a checkpoint under an ID you intend to replace later.

For a browser inspector, omit `token` and use `baseUrl: window.location.origin` after creating a read-only session.
Fetch uses same-origin cookies. Keep write and provider credentials on the server. Redirects are rejected so the
configured endpoint remains the credential boundary.

`listRuns` returns runs, `getRun` returns `{run, episodes}`, `getEpisode` returns an episode, and `exportRun` returns a
validated `{schemaVersion, exportedAt, run, episodes}` document. Every method accepts a final `{signal}` option.
`UniverseApiError` exposes `status` and `code`; its message excludes raw server bodies. Network and abort errors use
status `0` with `NETWORK_ERROR` and `ABORTED` respectively.

## Protocol and development

Schemas, validators, game/policy interfaces, and result summaries belong to
[`@softmax-universe/protocol`](../protocol/README.md). Import these directly from that package. The SDK exports
`createRecorder` and `createClient`; it does not forward the protocol's API.

Run `pnpm build`, `pnpm type-check`, and `pnpm test` from the repository root. A packed SDK contains compiled
JavaScript, declarations, this README, and the MIT license. Recordings remain private data; downloading them does
not grant publication, redistribution, or training rights.
