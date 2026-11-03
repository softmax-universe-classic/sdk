# Mechane policy context

The adapter uses Mechane's bounded-turn API rather than importing its private client package.
The HTTP boundary lets an independent game use a locally hosted or Foundation-hosted Mechane deployment.
The game and Universe runner stay unchanged when that endpoint changes.

One mech retains context throughout one participant's episode. A new episode starts fresh so one trial
cannot inherit another trial's strategy. Archival preserves the remote history for investigation.

Polling reads a stable request resource. It does not submit a second turn. The runner reserves the entire
per-decision allowance before submission because the caller can disconnect before observing a dispatch.
Only terminal accounting can release that unused allowance; missing observations are not evidence of
zero spend. `src/evidence.ts` implements that translation into the SDK's neutral call records.
