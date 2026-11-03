import type { BoundedTurn as CanonicalBoundedTurn } from "@mechane/client/protocol";

export type BoundedTurn = typeof CanonicalBoundedTurn.Encoded;
