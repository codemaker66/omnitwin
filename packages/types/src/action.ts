import { z } from "zod";

// ---------------------------------------------------------------------------
// The Action envelope — G4 (03 §1 principle 1).
//
// Every mutation in the product serializes to this one shape:
//   Action { id, actor, intent, payload, inverse, provenance, ts }
// It is the contract for undo provenance, the append-only audit log, session
// replay, and — later — the copilot's tool API and sync. Payload/inverse are
// intent-specific but must always be JSON values (serializable by
// construction); a CRDT layer can adopt the envelope without changes.
// ---------------------------------------------------------------------------

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;

/** Who performed the mutation. `ref` identifies the concrete user/agent. */
export const ACTION_ACTOR_KINDS = ["operator", "ai", "system"] as const;
export type ActionActorKind = (typeof ACTION_ACTOR_KINDS)[number];

export const ActionActorSchema = z
  .object({
    kind: z.enum(ACTION_ACTOR_KINDS),
    ref: z.string().trim().min(1).max(255).optional(),
  })
  .strict();
export type ActionActor = z.infer<typeof ActionActorSchema>;

/** Namespaced lowercase verb, e.g. `object.place`, `history.undo`. */
export const ACTION_INTENT_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/;

/** Where the mutation came from (surface/tool), distinct from who did it. */
export const ActionProvenanceSchema = z
  .object({
    surface: z.string().trim().min(1).max(64),
    tool: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
export type ActionProvenance = z.infer<typeof ActionProvenanceSchema>;

/** JSON value — payloads are serializable by construction. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

export const ActionSchema = z
  .object({
    id: z.string().uuid(),
    actor: ActionActorSchema,
    intent: z
      .string()
      .regex(ACTION_INTENT_PATTERN, "intent must be a namespaced lowercase verb, e.g. object.place"),
    payload: JsonValueSchema,
    /** Intent-specific inverse; null only for log-management records
     *  (e.g. `log.summarized`) that do not represent a document mutation. */
    inverse: JsonValueSchema.nullable(),
    provenance: ActionProvenanceSchema,
    ts: z.string().regex(ISO_DATE_TIME, "ts must be an ISO datetime."),
  })
  .strict();
export type Action = z.infer<typeof ActionSchema>;
