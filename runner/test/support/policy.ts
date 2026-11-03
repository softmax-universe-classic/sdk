import type { Policy, PolicySession } from "@softmax-universe/protocol";

export function policy(decide: PolicySession["decide"], model?: string): Policy {
  const definition: Policy["definition"] = {
    kind: model ? "custom" : "baseline",
    revision: "fixture-v1",
    configuration: {},
  };
  if (model) definition.model = model;
  return { definition, open: () => ({ decide }) };
}
