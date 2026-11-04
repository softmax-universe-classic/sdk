# Mechane policies

`@softmax-universe/mechane` runs a Universe policy through Mechane's bounded-turn HTTP API.
It is an optional Node package. The game remains authoritative over legal actions and scores.

Install the immutable public release artifact:

```sh
pnpm add https://github.com/softmax-universe-classic/sdk/releases/download/sdk-v0.3.0-alpha.4/softmax-universe-mechane-0.3.0-alpha.4.tgz
```

Its runner and SDK dependencies resolve to the same release. This package is distributed through
[GitHub releases](https://github.com/softmax-universe-classic/sdk/releases/tag/sdk-v0.3.0-alpha.4).

Create a policy with `createMechanePolicy({ endpoint, apiKey, workspaceId, model })` and pass it to
the runner's `policies` map. The endpoint is an explicit Mechane origin, such as your Foundation
agents installation. The key must be a member of the selected workspace. Credentials stay in
transport headers and never enter the recorded policy definition.

The policy creates a fresh, idle mech for each participant and episode. Creation uses a deterministic
request ID derived from the saved episode and participant, so a lost creation response can be inspected
by repeating the same creation request without creating another mech. Each decision records the remote
request ID before submission, then submits the observation and legal actions with the runner's
dispatch limit, per-dispatch output-token limit, and deadline. The response must finish with one
JSON object, `{"actionIndex":0}`, selecting an existing legal action. Invalid replies fail the
decision without a repair request.

Every observed model dispatch and tool call is saved through the runner's checkpoint callbacks.
Absent provider payloads remain unknown. Input-token totals include cached input when Mechane
reports it. Mechane's estimated dispatch charge is not reported as a provider bill, so dollar cost
remains unknown. Unused budget is released only after a terminal response accounts for every
dispatch. A lost response retains the reservation and request ID for inspection.

Closing the policy cancels any active request and archives its mech while preserving history.
The remote deadline also stops work if the caller disconnects. Submission is never automatically
retried. Run `pnpm test` for the public HTTP integration and lost-response accounting checks.
