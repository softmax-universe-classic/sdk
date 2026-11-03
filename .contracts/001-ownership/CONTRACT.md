---
name: universe-ownership
message: Keep public packages independent and game decisions with the game.
---

## Rules

The `sdk` package owns wire schemas, recording values, HTTP transport, and shared result interpretation. It must work
without Node built-ins, private packages, or repository-relative runtime imports.

The `runner` package owns Node persistence, policy execution, and its CLI. `platform` owns product persistence and
authorization. `client` renders the product API. Import another package through its declared exports.

Foundation's public `models` package owns provider transport and model request evidence. Universe's model policy owns
the game prompt and legal-action selection. `integrations/mechane` adapts the published bounded-turn HTTP protocol;
Mechane owns durable agent execution. Do not copy provider transports or Mechane's execution engine into Universe.

Foundation owns accounts, login sessions, OAuth clients, and token verification. Universe owns projects and their
access grants. Reference an account by its verified issuer and subject; do not query Identity's database. Keep the
public SDK and local recording usable without a running Foundation service or private package dependencies.

An integrated game validates actions and determines outcomes. Keep game rules in its independent repository or pinned
dependency. The runner submits actions and records the game's actual answer. Do not silently repair rejected actions.

## Checks

Run `pnpm build` and `pnpm type-check` from the root. Install packed SDK and runner artifacts in the external game.
Review package dependencies and the path from policy action to game result.
