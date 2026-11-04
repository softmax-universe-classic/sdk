# Model policy

`createModelPolicy` adapts the hosted Foundation Models API to the Universe policy interface. Configure its
`endpoint`, grant `token`, and requested `model` explicitly. The policy owns the game prompt and validates the
returned legal-action index. The runner supplies the budget, deadline, cancellation, and evidence callbacks.

The policy persists one UUID and the exact request before calling the public `@softmax-foundation/client`.
The client submits once and polls that ID. A disconnect stops waiting without cancelling hosted execution.
Unknown execution keeps the runner's allowance reserved. Saved calls can be inspected with `models.getCall(id)`;
re-running a saved trial never submits another paid call. Recordings keep the submitted `request` and Foundation's
returned provider `input` separately, without the bearer token.
