import type { GameSession } from "@softmax-universe/protocol";

export function game(decisions = 1): GameSession {
  let accepted = 0;
  return {
    getTurn: () => ({
      participantId: "player",
      observation: { accepted },
      legalActions: ["advance"],
    }),
    apply: (action) => {
      const valid = action === "advance";
      if (valid) accepted += 1;
      return { accepted: valid, action: valid ? action : null, nextObservation: { accepted } };
    },
    getOutcome: () => (accepted >= decisions ? { scores: { player: 1 } } : null),
  };
}
