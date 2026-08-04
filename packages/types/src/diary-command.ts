import { z } from "zod";
import {
  BookingSchema,
  CreateBookingSchema,
  TransitionBookingSchema,
  UpdateBookingSchema,
} from "./booking.js";

// ---------------------------------------------------------------------------
// Diary command envelopes (T-537; Canon §9).
//
// "Mutations = commands validated in a Neon transaction (exclusion
// constraint = final arbiter) → commit → broadcast." The envelope is the
// shared wire contract between the Board and /ws/diary:
//
//   client → { type: "diary.command", command: DiaryCommand }
//   server → { type: "diary.ack",     ...DiaryCommandAck }
//
// The commandId is client-minted (uuid) and is the idempotency identity:
// the server records every completed command in the diary_commands ledger
// inside the SAME transaction as its mutation, so a resend after a dropped
// socket replays the recorded outcome instead of re-executing (`replay:
// true` on the ack). Payloads reuse the exact REST schemas — the command
// channel is a transport, never a second validation dialect.
// ---------------------------------------------------------------------------

export const DiaryCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("booking.create"),
    commandId: z.string().uuid(),
    payload: CreateBookingSchema,
  }),
  z.object({
    kind: z.literal("booking.update"),
    commandId: z.string().uuid(),
    bookingId: z.string().uuid(),
    payload: UpdateBookingSchema,
  }),
  z.object({
    kind: z.literal("booking.transition"),
    commandId: z.string().uuid(),
    bookingId: z.string().uuid(),
    payload: TransitionBookingSchema,
  }),
]);
export type DiaryCommand = z.infer<typeof DiaryCommandSchema>;
export type DiaryCommandKind = DiaryCommand["kind"];

/** The ladder-promotion ping that rides a transition ack (Canon §3). */
export const DiaryAckResequenceSchema = z
  .object({
    changes: z.array(
      z.object({
        id: z.string().uuid(),
        fromRank: z.number().int().nullable(),
        toRank: z.number().int(),
      }),
    ),
    promotedToFirst: z.array(
      z.object({
        id: z.string().uuid(),
        title: z.string(),
        ownerUserId: z.string().uuid().nullable(),
      }),
    ),
  })
  .nullable();

export const DiaryCommandAckSchema = z.object({
  type: z.literal("diary.ack"),
  commandId: z.string().uuid(),
  outcome: z.enum(["applied", "rejected"]),
  /** True when this ack restates a previously recorded outcome (resend). */
  replay: z.boolean(),
  /** The REST status the same mutation would have returned — one dialect. */
  status: z.number().int(),
  /** Present on applied outcomes (fresh state on replays). */
  booking: BookingSchema.optional(),
  resequence: DiaryAckResequenceSchema.optional(),
  /** Present on rejected outcomes — the REST error vocabulary verbatim. */
  code: z.string().optional(),
  error: z.string().optional(),
  details: z.unknown().optional(),
});
export type DiaryCommandAck = z.infer<typeof DiaryCommandAckSchema>;
