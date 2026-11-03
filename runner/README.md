# Universe runner

`@softmax-universe/runner` executes local games, saves their evidence, and transfers saved recordings to an explicitly
configured Universe API. It requires Node 24.14.1 or later. Games own their rules, legal actions, observations, and scores.

```sh
pnpm add https://github.com/softmax-universe/sdk/releases/download/sdk-v0.3.0-alpha.1/softmax-universe-runner-0.3.0-alpha.1.tgz
```

[Public releases](https://github.com/softmax-universe/sdk/releases) contain immutable package archives and their
checked source. The package name used in imports remains `@softmax-universe/runner`.

## Run a game

An integration supplies a `Run`, a `createGame(trial, signal)` function, and policies keyed by each participant's
`policy` value. This abbreviated example shows their composition:

```ts
import { runBenchmark } from "@softmax-universe/runner";
import { createModelPolicy } from "@softmax-universe/model-policy";

const result = await runBenchmark({
  run,
  createGame,
  directory: "./.local/runs/comparison-1",
  policies: {
    baseline: {
      definition: { kind: "baseline", revision: "first-legal-v1", configuration: {} },
      open: () => ({ decide: ({ legalActions }) => ({ action: legalActions[0] }) }),
    },
    model: createModelPolicy({
      apiKey: process.env.OPENROUTER_API_KEY!,
      model: "your-explicit-model-id",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
    }),
  },
  limits: {
    maxDecisionsPerEpisode: 64,
    maxModelCalls: 128,
    maxModelCallsPerDecision: 1,
    maxOutputTokens: 64,
    decisionTimeoutMs: 20_000,
    episodeTimeoutMs: 300_000,
    runTimeoutMs: 600_000,
  },
});
```

The [protocol's GameSession and Policy types](../protocol/src/policy.ts) define game and policy integration.
[BenchmarkOptions](src/benchmark/types.ts) defines runner composition. A game session
returns the current participant, observation, and legal actions from `getTurn`. Its `apply` method returns the actual
acceptance decision, accepted action, and next observation. `getOutcome` returns scores only when the game has ended.
Async methods must honor their `AbortSignal`; `close` must release resources promptly.

Each policy declares its kind, revision, configuration, and optional requested model. The participant's `model` must
match that definition. The runner opens one policy session per participant per episode and closes it after play.
A session can keep conversation state across decisions in that episode. Its `decide` method returns an action.
A deterministic baseline can derive choices from the declared trial seed.

The runner executes trials sequentially. It snapshots policy definitions and enforced limits in
`run.configuration.policies` and `run.configuration.runnerLimits`, without changing the caller's object. Conflicting
existing values are rejected. Changing a saved run's configuration requires a new run and directory.

## Paid work

The runner reserves a decision's whole model-call allowance before starting it. The allowance is the smaller of
`maxModelCallsPerDecision` and the run's remaining budget. Model calls use stable IDs; recording another snapshot for
the same ID updates its evidence without charging the budget twice.

Custom policies await `recordModelCall` before dispatch and whenever evidence changes. The first snapshot consumes
one reserved slot. A policy calls `settleModelCalls` only after it can prove that every issued dispatch has been
accounted for and no more work can start. Settlement releases unused slots. A timeout or uncertain remote result
keeps unused reservations, including across later invocations. Rejected reservations must prevent dispatch.

The supplied `createModelPolicy` uses `@softmax-foundation/models` for provider transport. Universe owns the game
prompt and validates the returned JSON `actionIndex` against the legal actions. Invalid output ends the episode
without repair; the game remains responsible for accepting the selected action. Provider requests have explicit
input/output bounds, honor cancellation, and do not silently retry.

For agent policies, the optional `@softmax-universe/mechane` package connects a session to Mechane's bounded-turn API.
Each decision carries an explicit deadline, dispatch cap, and per-dispatch output-token cap. It records every available
model/tool call and the remote request/turn reference. Mechane enforces the submitted limits even if the runner
connection disappears. See that package's README for configuration.

Recordings preserve requested inputs, actual returned models, response text, tool activity, latency, and returned
usage. Unavailable values remain unknown. Credentials belong in environment variables, outside observations, policy
configuration, and recordings. Error messages use fixed codes and exclude raw provider errors and headers.

## Saved evidence

Each directory contains `run.json` and `episodes/<episode-id>.json`. New benchmark episodes get a UUID that remains
unchanged across checkpoints and later reads. Writes use a synced temporary file and atomic rename; completed
documents cannot be replaced with different content. Decisions are checkpointed before policy execution, before
applying an action, and after the game answers. Each finished episode is saved before the next trial starts.

Every existing episode is skipped on a later invocation, including failed, cancelled, and incomplete episodes. To
repeat work deliberately, create a new run and directory. The returned `modelCalls` budget count includes observed
calls and unresolved reservations; it can exceed the number of requests known to have reached the provider.

SIGINT and SIGTERM abort execution, preserve the active episode as `incomplete`, and reject with
`RunnerError.code === 'interrupted'`. An explicit abort signal saves `cancelled`. Decision timeouts save `failed`;
episode/run deadlines and evaluation caps save `truncated`, with `scores: null` when the game has no terminal scores.
Provider or policy failures do not trigger retries. Run cancellation and run timeout reject after checkpointing.

A `.execution-lock` file prevents concurrent execution or writes to the same directory. A hard kill can leave that
lock behind. Inspect its PID and saved evidence, confirm the owning process has exited, then remove only that lock.
The next invocation still skips the existing episode. SIGKILL cannot save evidence that had not reached a checkpoint.

`saveRun(directory, run)` and `saveEpisode(directory, run, episode)` also persist completed human recordings. Both are
immutable and idempotent. `readRunDirectory(directory)` validates local documents through the protocol. Keep recording
directories private; files are created with owner-only permissions.

## Upload and export

The CLI reads credentials from the environment variable named by `--key-env`. Endpoints and projects are always explicit.
These commands transfer existing data and never execute a game or call a model:

```sh
universe upload ./.local/runs/comparison-1 \
  --endpoint http://127.0.0.1:8787 --project demo --key-env UNIVERSE_UPLOAD_TOKEN

universe dataset export comparison-1 --out ./comparison-1.json \
  --endpoint http://127.0.0.1:8787 --project demo --key-env UNIVERSE_READ_TOKEN
```

Upload holds the directory's execution lock while sending the run and its episodes, so an active benchmark cannot
publish a changing checkpoint. Interrupted recordings can be uploaded once execution has stopped. Local files remain
intact if delivery fails. Repeating an identical upload is safe. Export writes a new file and refuses to replace
different content. Transfers have a 60-second overall timeout;
the `uploadDirectory` and `exportDataset` APIs also accept `signal` and `timeoutMs`. Read permission is required for export.
Downloading private recordings does not grant redistribution or training rights.

## Development

From the repository root, run `pnpm --filter @softmax-universe/runner build` and
`pnpm --filter @softmax-universe/runner test`. Tests use a local HTTP server and subprocesses; no provider key is needed.
Live model checks require explicit models and call/token/deadline bounds and run separately from CI.
