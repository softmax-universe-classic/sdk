import { z } from "zod";

const identifier = z.string().min(1).max(200);
export const recordIdSchema = z.uuid();
const timestamp = z.iso.datetime();
const tokens = z.number().int().nonnegative();

export const mechSchema = z.object({
  id: recordIdSchema,
  revision: z.number().int().positive(),
});

const dispatchSchema = z.object({
  id: recordIdSchema,
  model: identifier,
  status: z.enum(["reserved", "refused", "settled"]),
  decided_at: timestamp,
  settled_at: timestamp.optional(),
  basis: z.enum(["usage", "reservation"]).optional(),
  input_tokens: tokens.optional(),
  output_tokens: tokens.optional(),
  cache_read_tokens: tokens.optional(),
  cache_write_tokens: tokens.optional(),
});

export const boundedTurnSchema = z.object({
  request_id: z.uuid(),
  status: z.enum(["queued", "running", "answered", "unanswered"]),
  received_at: timestamp,
  deadline_at: timestamp,
  max_model_dispatches: z.number().int().min(1).max(100),
  max_output_tokens: z.number().int().positive(),
  dispatched_count: z.number().int().min(0).max(100),
  turn_id: recordIdSchema.optional(),
  ended_at: timestamp.optional(),
  reply: z.string().max(200_000).optional(),
  reason: z.string().optional(),
  evidence_complete: z.boolean(),
  dispatches: z.array(dispatchSchema).max(200),
  dispatch_evidence: z
    .array(
      z.object({
        id: recordIdSchema,
        model: identifier,
        status: z.enum(["running", "completed", "failed", "unknown"]),
        request: z.json(),
        response: z.json().optional(),
        started_at: timestamp,
        ended_at: timestamp.optional(),
      }),
    )
    .max(100),
  tool_calls: z
    .array(
      z.object({
        id: identifier,
        name: identifier,
        input: z.json(),
        output: z.json().optional(),
        status: z.enum(["completed", "failed", "unknown"]),
        started_at: timestamp.optional(),
        ended_at: timestamp.optional(),
      }),
    )
    .max(1000),
  unknowns: z.array(z.string()),
});

export type BoundedTurn = z.infer<typeof boundedTurnSchema>;
