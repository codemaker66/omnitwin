import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyToken } from "@clerk/backend";
import { z } from "zod";
import type { Database } from "../db/client.js";
import {
  createDrizzleUserOnboardingStore,
  readClerkEmailClaims,
  resolveUserForClerkIdentity,
  type UserOnboardingSource,
} from "../services/user-onboarding.js";

// ---------------------------------------------------------------------------
// User type — attached to request after authentication
// ---------------------------------------------------------------------------

/** The shape available on request.user after authenticate(). */
export interface JwtUser {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly venueId: string | null;
}

// Punch list #7: Zod schema for validating mock tokens in test mode.
// The previous code did `JSON.parse(token) as JwtUser` which trusted
// any JSON shape, including objects with missing or wrong-typed fields.
// Downstream code (ownership checks, venue filtering) silently broke
// when fields were missing or had wrong types.
const MockTokenSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  role: z.string().min(1),
  venueId: z.string().nullable(),
});

// Augment FastifyRequest to include user
declare module "fastify" {
  interface FastifyRequest {
    user: JwtUser;
  }
}

// ---------------------------------------------------------------------------
// Module-level DB reference — set once during server startup
// ---------------------------------------------------------------------------

let _db: Database | null = null;

/** Called once at startup to inject the database reference. */
export function setAuthDb(db: Database): void {
  _db = db;
}

// ---------------------------------------------------------------------------
// getUserByClerkId - resolve local user from Clerk identity.
//
// This is the authoritative bridge from Clerk's opaque `sub` (the JWT
// `payload.sub` claim) to our local `users.id` UUID. Both HTTP and
// WebSocket auth paths MUST go through this so ownership checks against
// `configurations.userId` compare apples to apples.
//
// New Clerk users are no longer auto-created. This bridge links an
// existing invited user row by verified email, or creates a planner only
// for an explicitly approved email domain.
// ---------------------------------------------------------------------------

export async function getUserByClerkId(
  db: Database,
  clerkId: string,
  email: string | null,
  emailVerified: boolean,
  source: UserOnboardingSource = "auth",
): Promise<JwtUser | null> {
  const resolved = await resolveUserForClerkIdentity(createDrizzleUserOnboardingStore(db), {
    clerkId,
    email,
    emailVerified,
    name: null,
    source,
  });

  if (resolved === null) return null;

  return {
    id: resolved.id,
    email: resolved.email,
    role: resolved.role,
    venueId: resolved.venueId,
  };
}

// ---------------------------------------------------------------------------
// authenticate — verifies Clerk session token, attaches user to request
// ---------------------------------------------------------------------------

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (authHeader === undefined || !authHeader.startsWith("Bearer ")) {
    await reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    return;
  }

  const token = authHeader.slice(7);

  // In test mode ONLY, accept mock tokens (JSON-encoded user objects).
  // This MUST be gated behind NODE_ENV to prevent production exploitation.
  // Punch list #7: the parsed JSON is validated via Zod so malformed mock
  // tokens (missing fields, wrong types) are rejected with 401 instead of
  // silently producing a broken request.user.
  const isTest = process.env["NODE_ENV"] === "test" || process.env["VITEST"] !== undefined;
  if (isTest && token.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(token);
      const result = MockTokenSchema.safeParse(parsed);
      if (result.success) {
        request.user = result.data;
        return;
      }
      // Shape doesn't match — fall through to Clerk verification.
      // In practice this means the token was JSON but not a valid
      // mock user, so Clerk will also reject it (401).
    } catch {
      // Not valid JSON — fall through
    }
  }

  try {
    const secretKey = process.env["CLERK_SECRET_KEY"];
    if (secretKey === undefined || secretKey === "") {
      await reply.status(500).send({ error: "Clerk not configured", code: "SERVER_ERROR" });
      return;
    }

    const payload = await verifyToken(token, {
      secretKey,
    });

    const clerkId = payload.sub;
    const emailClaims = readClerkEmailClaims(payload as Readonly<Record<string, unknown>>);

    if (_db === null) {
      await reply.status(500).send({ error: "Database not available", code: "SERVER_ERROR" });
      return;
    }

    const user = await getUserByClerkId(
      _db,
      clerkId,
      emailClaims.email,
      emailClaims.emailVerified,
      "auth",
    );
    if (user === null) {
      await reply.status(401).send({ error: "Invitation required", code: "UNAUTHORIZED" });
      return;
    }

    request.user = user;
  } catch {
    await reply.status(401).send({ error: "Invalid or expired token", code: "UNAUTHORIZED" });
  }
}

// ---------------------------------------------------------------------------
// authorize — role-based guard
//
// CRITICAL: returns the reply to halt the Fastify lifecycle so the actual
// route handler does NOT run after a 403. The previous version sent the
// 403 body but didn't return — Fastify then proceeded to invoke the
// downstream handler with `request.user` still set, silently bypassing
// the role check on every admin route.
//
// Pinned by the regression tests in __tests__/auth.test.ts that hit
// `POST /venues` (admin-only) with a planner token.
// ---------------------------------------------------------------------------

export function authorize(
  ...allowedRoles: readonly string[]
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const roleSet = new Set(allowedRoles);

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!roleSet.has(request.user.role)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
  };
}
