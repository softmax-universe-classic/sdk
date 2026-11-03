import { z } from "zod";

export function checkParticipantIds(
  participants: { id: string }[],
  context: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  for (const [index, participant] of participants.entries()) {
    if (ids.has(participant.id)) {
      context.addIssue({
        code: "custom",
        path: ["participants", index, "id"],
        message: "Participant IDs must be unique within a trial.",
      });
    }
    ids.add(participant.id);
  }
}
