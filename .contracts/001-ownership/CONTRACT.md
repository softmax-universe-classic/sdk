---
name: universe-ownership
message: Keep public packages independent and game decisions with the game.
---

## Rules

The `protocol` package owns wire schemas, validation, result summaries, and game/policy interfaces. It has no I/O.
The `sdk` package owns recording and HTTP transport. Both work without Node built-ins, private packages, or
repository-relative runtime imports.

The `runner` package owns Node persistence, policy execution, and its CLI. `platform` owns product persistence and
authorization. `client` renders the product API. Import another package through its declared exports.

Foundation's hosted Models API owns provider transport and model request evidence. Its public `client` package owns
authenticated submission and polling. Universe's `integrations/model-policy` package owns
the game prompt and legal-action selection. `integrations/mechane` adapts the canonical published Mechane client and its bounded-turn protocol;
Mechane owns durable agent execution. Do not copy provider transports or Mechane's execution engine into Universe.

Foundation owns accounts, login sessions, OAuth clients, and token verification. Universe owns projects and their
access grants. Reference an account by its verified issuer and subject; do not query Identity's database. Keep the
public SDK and local recording usable without a running Foundation service or private package dependencies.

An integrated game validates actions and determines outcomes. Keep game rules in its independent repository or pinned
dependency. The runner submits actions and records the game's actual answer. Do not silently repair rejected actions.

## Checks

Run `pnpm build` and `pnpm type-check` from the root. Install packed SDK and runner artifacts in the external game.
Run `pnpm architecture:check` for the declared package graph, source direction, entry points, file roles, and stores.
Review the path from policy action to game result.
