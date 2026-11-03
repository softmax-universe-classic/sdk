import { catalog } from "@mechane/client/protocol";

export type RuntimeOperation =
  | "createMech"
  | "updateMech"
  | "submitBoundedTurn"
  | "showBoundedTurn"
  | "cancelBoundedTurn";

export type OperationAnswer<N extends RuntimeOperation> = (typeof catalog)[N]["output"]["Encoded"];
