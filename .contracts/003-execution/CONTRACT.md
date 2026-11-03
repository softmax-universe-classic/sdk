---
name: universe-execution
message: Give one runner ownership of budgets, cancellation, and cleanup.
---

## Rules

The runner owns episode deadlines, decision limits, cancellation, paid-call limits, and cleanup of work it starts.
Bound provider requests and response sizes. Pass cancellation into provider transport. Open one policy session per
participant and episode, and close its resources on every outcome.

Persist the decision's full model-call allowance before submission. Upsert observed calls by ID and release unused
allowance only after the policy proves that its execution has ended and every dispatch is accounted for. Saved
unknown work continues to consume the run budget. A remote agent must enforce its own persisted dispatch, token, and
deadline limits after the caller disconnects. Submission retries must reattach to the same request ID.

Persist completed episodes before proceeding. Report an interrupted episode as incomplete; resume must not silently
repeat completed paid work. Upload never executes a game or calls a provider.

Expose invalid output, provider failure, and uncertain external outcomes. Avoid hidden retries at multiple layers.
Do not retry an unfavorable valid answer to improve the score.

## Checks

Run runner tests without provider credentials. Exercise cancellation and provider timeout with a controlled transport.
Perform real model checks separately with an explicit call/token budget and report the actual models used.
