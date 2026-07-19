import { z } from "zod";
import { ActionSchema, JsonValueSchema } from "./action.js";

// ---------------------------------------------------------------------------
// Action-log ingestion contract — G4 Slice 3 (03 §2).
//
// The web client flushes its append-only log to the API in batches. The
// Action envelope's JsonValueSchema recurses via z.lazy, so ingestion runs
// these bounds BEFORE that parse: an adversarial body can never drive the
// recursive descent (depth cap, iteratively measured) nor bloat a row
// (serialized byte cap). Fastify's bodyLimit gates raw request size
// upstream; these are the semantic per-action/per-batch caps.
// ---------------------------------------------------------------------------

export const ACTION_LOG_MAX_BATCH = 500;
/** Per action, JSON-serialized length of the whole envelope. Note the
 *  nominal batch ceiling (500 × 64 KiB) exceeds the API server's 2 MB
 *  bodyLimit — Fastify 413s first. The caps here are per-action semantic
 *  bounds; real batches (typical actions ≪ 1 KiB) sit far below both. */
export const ACTION_MAX_BYTES = 64 * 1024;
/** Nesting depth of the whole envelope (payload sits at depth 2). */
export const ACTION_MAX_DEPTH = 32;

/** Iterative nesting depth — an explicit stack, so a hostile chain returns
 *  a number instead of overflowing the call stack. Primitives are depth 1. */
export function jsonDepth(value: unknown): number {
  let deepest = 0;
  const stack: { readonly node: unknown; readonly depth: number }[] = [{ node: value, depth: 1 }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    if (item.depth > deepest) deepest = item.depth;
    if (item.node === null || typeof item.node !== "object") continue;
    const children = Array.isArray(item.node) ? item.node : Object.values(item.node);
    for (const child of children) stack.push({ node: child, depth: item.depth + 1 });
  }
  return deepest;
}

/** Bounds first, envelope parse second — order is the whole point. Depth is
 *  measured before serialization so JSON.stringify's own recursion never
 *  sees a pathological chain either. Exported: AI proposals (slice 4)
 *  bound their ghost actions with the same discipline as ingestion. */
export const BoundedActionSchema = z.preprocess((input, ctx) => {
  const depth = jsonDepth(input);
  if (depth > ACTION_MAX_DEPTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `action nesting depth ${String(depth)} exceeds ${String(ACTION_MAX_DEPTH)}`,
    });
    return z.NEVER;
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch {
    serialized = undefined;
  }
  if (serialized === undefined || serialized.length > ACTION_MAX_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `action exceeds ${String(ACTION_MAX_BYTES)} serialized bytes`,
    });
    return z.NEVER;
  }
  return input;
}, ActionSchema);

export const ActionLogBatchSchema = z
  .object({
    batchId: z.string().uuid(),
    /** The configuration revision the client had when it flushed — anchors
     *  the audit trail to the save history without claiming causality. */
    revision: z.number().int().nonnegative(),
    actions: z
      .array(BoundedActionSchema)
      .min(1)
      .max(ACTION_LOG_MAX_BATCH)
      // Cross-batch retries dedup server-side by action id; duplicates
      // WITHIN one batch would leave the accepted/duplicates accounting to
      // Postgres's intra-statement conflict semantics. Forbidden outright.
      .superRefine((actions, ctx) => {
        const seen = new Set<string>();
        for (const [index, action] of actions.entries()) {
          if (seen.has(action.id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate action id in batch: ${action.id}`,
              path: [index, "id"],
            });
          }
          seen.add(action.id);
        }
      }),
  })
  .strict();
export type ActionLogBatch = z.infer<typeof ActionLogBatchSchema>;

/** Depth-capped JsonValue for READ paths (audit pages, replay tooling):
 *  the same guard order as ingestion — the iterative depth measure runs
 *  before JsonValueSchema's recursive descent, so a pathological blob is
 *  rejected instead of overflowing the parser's call stack. */
export const BoundedJsonValueSchema = z.preprocess((input, ctx) => {
  const depth = jsonDepth(input);
  if (depth > ACTION_MAX_DEPTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `nesting depth ${String(depth)} exceeds ${String(ACTION_MAX_DEPTH)}`,
    });
    return z.NEVER;
  }
  return input;
}, JsonValueSchema);
