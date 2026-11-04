import type { FoundationClientOptions } from "@softmax-foundation/client";

export type ModelPolicyOptions = FoundationClientOptions & {
  model: string;
  maxInputChars?: number;
};
