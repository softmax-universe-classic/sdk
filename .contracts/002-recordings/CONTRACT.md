---
name: universe-recordings
message: Preserve complete decisions and distinguish missing evidence from valid results.
---

## Rules

Version recordings with the public schema. Validate untrusted documents at the SDK, upload, and persisted-data entry
boundaries. Keep episode, trial, participant, game version, and decision ordering consistent with the run definition.

Record the actual observation, attempted action, accepted action, and resulting observation. A rejected or failed
decision cannot claim an accepted action. Preserve model evidence available to the integration without inventing it.

Distinguish termination, evaluation truncation, failure, cancellation, and interruption. Missing trials remain visible.
Do not score missing or failed episodes as ordinary completed play. Label truncated coverage separately.

Record each model and tool call under its own stable ID. Preserve requested and observed model identities separately.
Unknown responses, usage, and costs remain unknown. Retain unused dispatch reservations when a remote outcome has not
been accounted for; summaries must not turn those reservations into zero cost. Policy definitions and revisions belong
in the run configuration; runtime references connect a decision to its remote turn without replacing its evidence.

Derive comparisons and exports from accepted recordings. Save finished local work before attempting upload.

## Checks

Run SDK and runner tests. Interrupt a representative episode and inspect the saved outcome. Independently read an
export and compare its scores to the inspector. Review the game observation for player-specific visibility.
