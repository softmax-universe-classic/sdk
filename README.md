# Softmax Universe SDK

Integrate a game, record decisions, run local policies, and inspect results in Universe.

- [SDK](sdk/README.md): versioned recordings, browser-safe client, recorder, and comparison.
- [Runner](runner/README.md): durable local execution, bounded model calls, upload, and export.
- [Mechane](integrations/mechane/README.md): bounded agent policies with model and tool evidence.
- [Contracts](.contracts/index.md): the guarantees maintained by these packages.

Use Node 24.14.1 and pnpm 10.33.2, or install the pinned tools with Mise.

```sh
pnpm install --frozen-lockfile
pnpm check
```

This source bundle is exported from Universe Factory. Change canonical source there and export again; do not
maintain a second implementation. All packages build and test without private repositories or credentials.
Live model calls require explicit configuration and are outside the default checks.
