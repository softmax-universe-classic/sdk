import type { Participant } from "../schema/index.js";

export function participantKey(participant: Participant): string {
  return JSON.stringify([participant.kind, participant.policy, participant.model ?? null]);
}
