import type { FastifyReply, FastifyRequest } from "fastify";
import { eq, and, isNull } from "drizzle-orm";
import {
  isPlannerEditable,
  type ConfigurationReviewStatus,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { configurations } from "../db/schema.js";

// ---------------------------------------------------------------------------
// require-editable-config — preHandler that blocks mutations to
// configurations whose review lifecycle is not "editable by planner".
//
// The review workflow (see packages/api/src/routes/configuration-reviews.ts)
// depends on the invariant that a `submitted` / `under_review` / `approved`
// configuration DOES NOT DIVERGE from its snapshot until the planner
// explicitly re-submits. Editing the live config behind the snapshot's
// back would make the hallkeeper's sheet silently stale — the entire
// approval contract would be meaningless.
//
// Admins can always bypass (audit-logged at the route layer when that
// path lands in Phase 5). Everyone else gets a 409 CONFIG_LOCKED with
// the current review status embedded so the client can render a
// "withdraw to edit" UX.
// ---------------------------------------------------------------------------

interface RequireEditableConfigOptions {
  /**
   * Name of the URL parameter that carries the configuration id. Use
   * "id" for `/configurations/:id` and "configId" for
   * `/configurations/:configId/objects/...` style routes.
   */
  readonly paramName: string;
}

// UUID v4 shape — matches what `z.string().uuid()` accepts in the route
// handlers. Used to short-circuit the DB lookup when the URL segment is
// obviously not a UUID (e.g. "abc"), so Postgres doesn't throw its own
// invalid-input-syntax error that bubbles up as a 500. The route's own
// Zod parsing then returns a clean 400.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build a Fastify preHandler that gates mutations on a configuration's
 * review status. When the configuration is NOT planner-editable and
 * the acting user isn't admin, the preHandler sends a 409 and returns
 * — the route handler never runs.
 *
 * If the configuration can't be resolved (param missing / row not
 * found / soft-deleted), the preHandler is a no-op and leaves it to
 * the route handler to return its own 400/404. This keeps the
 * middleware strictly additive: it never invents errors the routes
 * don't already surface.
 */
export function requireEditableConfig(
  db: Database,
  options: RequireEditableConfigOptions,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const { paramName } = options;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const params = request.params as Record<string, string | undefined>;
    const id = params[paramName];
    if (id === undefined) return;
    // Let the route's own UUID validator return 400 for malformed ids.
    // Passing a non-UUID into the DB query would cause a pg-side
    // invalid_input_syntax error that Fastify surfaces as a 500.
    if (!UUID_REGEX.test(id)) return;

    // Fail-open on DB errors — with audit logging. Rationale:
    //
    // A true fail-closed here would return 503 before the route's own
    // Zod body-validation runs, breaking any test or client that sends
    // a malformed request expecting a 400. Moving body validation
    // ahead of this middleware is a larger refactor (convert every
    // consuming route's preHandler into an explicit post-validation
    // helper call).
    //
    // The practical risk is bounded: this middleware protects
    // `/configurations/:id` and `/placed-objects/*` writes. A DB
    // error here almost always means the route's own writes also
    // fail, so the lock is still enforced by infra-level failure.
    // What the silent swallow hid was the *signal* — ops couldn't
    // alarm on "lock layer degraded" or audit a pattern of bypass
    // attempts. Logging at ERROR level restores that visibility.
    //
    // True fail-closed stays on the deferred list until the route
    // preHandler refactor lands.
    let row: { reviewStatus: string } | undefined;
    try {
      const rows = await db.select({
        reviewStatus: configurations.reviewStatus,
      })
        .from(configurations)
        .where(and(eq(configurations.id, id), isNull(configurations.deletedAt)))
        .limit(1);
      row = rows[0];
    } catch (err) {
      request.log.error(
        { err, configId: id, userId: request.user.id },
        "require-editable-config: DB lookup failed; failing open so the route's own handling runs",
      );
      return;
    }

    if (row === undefined) return;

    const status = row.reviewStatus as ConfigurationReviewStatus;

    // Admins always bypass the lock — emergency-fix path. The route
    // layer is responsible for audit-logging admin overrides (Phase 5).
    if (request.user.role === "admin") return;

    if (isPlannerEditable(status)) return;

    return reply.status(409).send({
      error: `Configuration is locked for editing in state '${status}'. Withdraw the submission to edit, or request an admin override.`,
      code: "CONFIG_LOCKED",
      reviewStatus: status,
    });
  };
}

// ---------------------------------------------------------------------------
// `checkConfigEditable` — post-validation helper form of the same gate
//
// Use case: the preHandler factory above fires BEFORE the route's own
// Zod body validation. A DB-error fail-closed there (true 503) would
// short-circuit requests that SHOULD have received a 400 from Zod,
// breaking the "validate the shape first" contract callers rely on.
//
// This helper is designed to be called AFTER body + param validation
// — right before the mutation — so:
//   - Malformed body  → the route's Zod returns 400 as before.
//   - DB error here   → returns 503 CONFIG_LOCK_UNAVAILABLE (true
//                       fail-closed: we REFUSE to proceed when the
//                       lock state is unknown).
//   - Config locked   → returns 409 CONFIG_LOCKED.
//   - Admin / editable → returns { ok: true }; route proceeds.
//
// Routes migrate from preHandler to this helper one at a time. Both
// forms can coexist: routes that still use the preHandler continue to
// fail open on DB errors (documented risk), while migrated routes get
// fail-closed semantics.
// ---------------------------------------------------------------------------

export type EditableConfigGate =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: 409 | 503;
      readonly error: string;
      readonly code: "CONFIG_LOCKED" | "CONFIG_LOCK_UNAVAILABLE";
      readonly reviewStatus?: ConfigurationReviewStatus;
    };

/**
 * Verify a configuration is in a planner-editable state (or the
 * acting user is admin). Returns a discriminated result instead of
 * sending a reply — the caller maps it to HTTP.
 *
 * On DB error we return 503 `CONFIG_LOCK_UNAVAILABLE` rather than
 * swallowing — this is the fail-closed posture that preHandler form
 * cannot take without breaking Zod body-validation ordering.
 *
 * `configId` is expected to be a valid UUID — the caller has already
 * run Zod validation.
 */
export async function checkConfigEditable(
  db: Database,
  configId: string,
  userRole: string,
): Promise<EditableConfigGate> {
  // Admin always bypasses — cheap short-circuit before DB work. The
  // route layer is responsible for audit-logging admin overrides.
  if (userRole === "admin") return { ok: true };

  let row: { reviewStatus: string } | undefined;
  try {
    const rows = await db.select({
      reviewStatus: configurations.reviewStatus,
    })
      .from(configurations)
      .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
      .limit(1);
    row = rows[0];
  } catch {
    return {
      ok: false,
      status: 503,
      error: "Configuration lock service temporarily unavailable — try again shortly.",
      code: "CONFIG_LOCK_UNAVAILABLE",
    };
  }

  // Unknown config — let the route's own 404 handling take over. The
  // gate has no opinion here: a row that doesn't exist can't be
  // "locked", and the mutation will fail cleanly at its own step.
  if (row === undefined) return { ok: true };

  const status = row.reviewStatus as ConfigurationReviewStatus;
  if (isPlannerEditable(status)) return { ok: true };

  return {
    ok: false,
    status: 409,
    error: `Configuration is locked for editing in state '${status}'. Withdraw the submission to edit, or request an admin override.`,
    code: "CONFIG_LOCKED",
    reviewStatus: status,
  };
}
