import { z } from "zod";
import { checkParticipantIds } from "./check-participant-ids.js";
import { MAX_MODEL_CALLS, MAX_DECISIONS } from "./constants.js";

export const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);

export const jsonSchema = z.json();

export type Json = z.infer<typeof jsonSchema>;

export const gameSchema = z.strictObject({
  id: idSchema,
  version: z.string().min(1).max(200),
});

export const participantSchema = z.strictObject({
  id: idSchema,
  label: z.string().min(1).max(200),
  kind: z.enum(["human", "bot"]),
  policy: z.string().min(1).max(200),
  model: z.string().min(1).max(200).optional(),
});

export const trialSchema = z
  .strictObject({
    id: idSchema,
    seed: z.number().int().nonnegative(),
    participants: z.array(participantSchema).min(1).max(32),
  })
  .superRefine((trial, context) => checkParticipantIds(trial.participants, context));

export const runSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    id: idSchema,
    name: z.string().min(1).max(200),
    createdAt: z.iso.datetime(),
    kind: z.enum(["play", "benchmark"]),
    game: gameSchema,
    configuration: z.record(z.string(), jsonSchema),
    trials: z.array(trialSchema).min(1).max(1000),
  })
  .superRefine((run, context) => {
    const trialIds = new Set<string>();
    for (const [index, trial] of run.trials.entries()) {
      if (trialIds.has(trial.id)) {
        context.addIssue({
          code: "custom",
          path: ["trials", index, "id"],
          message: "Trial IDs must be unique within a run.",
        });
      }
      trialIds.add(trial.id);
    }
  });

export const modelCallSchema = z.strictObject({
  id: z.string().min(1).max(200),
  provider: z.string().min(1).max(100),
  requestedModel: z.string().min(1).max(200).nullable(),
  model: z.string().min(1).max(200).nullable(),
  input: z.string().max(200_000).nullable(),
  output: z.string().max(200_000).nullable(),
  latencyMs: z.number().nonnegative().nullable(),
  status: z.enum(["pending", "completed", "failed", "unknown"]),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  error: z.string().min(1).max(200).optional(),
});

export const toolCallSchema = z.strictObject({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  input: jsonSchema,
  output: jsonSchema,
  latencyMs: z.number().nonnegative().nullable(),
  status: z.enum(["pending", "completed", "failed", "unknown"]),
  error: z.string().min(1).max(200).optional(),
});

export const runtimeReferenceSchema = z.strictObject({
  kind: z.literal("mechane"),
  origin: z.url(),
  workspaceId: z.string().min(1).max(200),
  mechId: z.string().min(1).max(200),
  requestId: z.string().min(1).max(200),
  turnId: z.string().min(1).max(200).nullable(),
  release: z.string().min(1).max(200).optional(),
});

export const decisionSchema = z
  .strictObject({
    index: z.number().int().nonnegative(),
    participantId: idSchema,
    observation: jsonSchema,
    attemptedAction: jsonSchema,
    acceptedAction: jsonSchema,
    nextObservation: jsonSchema,
    status: z.enum(["accepted", "rejected", "error", "pending"]),
    modelCalls: z.array(modelCallSchema).max(MAX_MODEL_CALLS),
    toolCalls: z.array(toolCallSchema).max(1000),
    reservedModelCalls: z.number().int().nonnegative().max(MAX_MODEL_CALLS),
    runtime: runtimeReferenceSchema.optional(),
    error: z.string().max(2000).optional(),
  })
  .superRefine((decision, context) => {
    for (const field of ["modelCalls", "toolCalls"] as const) {
      const ids = new Set<string>();
      for (const [index, call] of decision[field].entries()) {
        if (ids.has(call.id)) {
          context.addIssue({
            code: "custom",
            path: [field, index, "id"],
            message: "Call IDs must be unique within a decision.",
          });
        }
        ids.add(call.id);
      }
    }
    if (decision.modelCalls.length + decision.reservedModelCalls > MAX_MODEL_CALLS) {
      context.addIssue({
        code: "custom",
        path: ["reservedModelCalls"],
        message: "Observed and reserved calls exceed the decision limit.",
      });
    }
    if (decision.status !== "accepted" && decision.acceptedAction !== null) {
      context.addIssue({
        code: "custom",
        path: ["acceptedAction"],
        message: "Only an accepted decision can record an accepted action.",
      });
    }
    if (decision.status === "pending" && decision.nextObservation !== null) {
      context.addIssue({
        code: "custom",
        path: ["nextObservation"],
        message: "A pending decision has no resulting observation yet.",
      });
    }
  });

export const outcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("terminated"),
    scores: z.record(idSchema, z.number().finite()),
  }),
  z.strictObject({
    kind: z.literal("truncated"),
    reason: z.string().min(1).max(1000),
    scores: z.record(idSchema, z.number().finite()).nullable(),
  }),
  z.strictObject({
    kind: z.literal("failed"),
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(2000),
  }),
  z.strictObject({ kind: z.literal("cancelled"), reason: z.string().min(1).max(1000) }),
  z.strictObject({ kind: z.literal("incomplete") }),
]);

export const episodeSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    id: idSchema,
    runId: idSchema,
    trialId: idSchema,
    game: gameSchema,
    seed: z.number().int().nonnegative(),
    participants: z.array(participantSchema).min(1).max(32),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
    decisions: z.array(decisionSchema).max(MAX_DECISIONS),
    outcome: outcomeSchema,
  })
  .superRefine((episode, context) => {
    checkParticipantIds(episode.participants, context);
    const participantIds = new Set(episode.participants.map((participant) => participant.id));
    for (const [index, decision] of episode.decisions.entries()) {
      if (decision.index !== index) {
        context.addIssue({
          code: "custom",
          path: ["decisions", index, "index"],
          message: "Decision indices must be contiguous and start at zero.",
        });
      }
      if (!participantIds.has(decision.participantId)) {
        context.addIssue({
          code: "custom",
          path: ["decisions", index, "participantId"],
          message: "A decision must belong to a declared participant.",
        });
      }
      if (
        decision.status === "pending" &&
        (index !== episode.decisions.length - 1 || episode.outcome.kind !== "incomplete")
      ) {
        context.addIssue({
          code: "custom",
          path: ["decisions", index, "status"],
          message: "Only the final decision of an incomplete episode may be pending.",
        });
      }
    }

    if (episode.outcome.kind === "incomplete") {
      if (episode.endedAt !== null) {
        context.addIssue({
          code: "custom",
          path: ["endedAt"],
          message: "An incomplete episode has no end timestamp.",
        });
      }
    } else if (
      episode.endedAt === null ||
      Date.parse(episode.endedAt) < Date.parse(episode.startedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["endedAt"],
        message: "A finished episode needs an end timestamp at or after its start.",
      });
    }

    if (
      (episode.outcome.kind === "terminated" || episode.outcome.kind === "truncated") &&
      episode.outcome.scores !== null
    ) {
      const scoreIds = Object.keys(episode.outcome.scores);
      if (
        scoreIds.length !== participantIds.size ||
        scoreIds.some((id) => !participantIds.has(id))
      ) {
        context.addIssue({
          code: "custom",
          path: ["outcome", "scores"],
          message: "Scores must contain exactly the declared participant IDs.",
        });
      }
    }
  });

export type Game = z.infer<typeof gameSchema>;

export type Participant = z.infer<typeof participantSchema>;

export type Trial = z.infer<typeof trialSchema>;

export type Run = z.infer<typeof runSchema>;

export type ModelCall = z.infer<typeof modelCallSchema>;

export type ToolCall = z.infer<typeof toolCallSchema>;

export type RuntimeReference = z.infer<typeof runtimeReferenceSchema>;

export type Decision = z.infer<typeof decisionSchema>;

export type Outcome = z.infer<typeof outcomeSchema>;

export type Episode = z.infer<typeof episodeSchema>;
