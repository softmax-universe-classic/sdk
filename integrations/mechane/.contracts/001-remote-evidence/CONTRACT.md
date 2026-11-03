---
name: universe-mechane-evidence
message: Account for remote dispatches before releasing the runner's reservation.
---

## Rules

Record the request ID before submitting a bounded turn. Send the runner's dispatch limit, token limit,
and deadline to Mechane. Create a fresh mech per participant and episode, then archive it on close.

Persist each distinct dispatch by its remote ID, including dispatches with missing provider payloads.
Release unused reservations only when a terminal response accounts for every issued dispatch.
Retain the reservation when the remote outcome is uncertain. Never retry submissions automatically.

Keep credentials out of configuration and evidence. Preserve actual provider payloads available through
the authorized API. Keep Mechane's estimated accounting charge separate from provider dollar costs.

## Checks

Run `pnpm --filter @softmax-universe/mechane test` for complete and lost-response recording paths.
Review `src/evidence.ts` when changing dispatch accounting. Exercise the real deployment with an
explicit bounded run when changing the wire protocol or lifecycle.
