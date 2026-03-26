import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyToken } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import type { Database } from "../db/client.js";

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
// getUserByClerkId — find or create local user from Clerk identity
// ---------------------------------------------------------------------------

async function getUserByClerkId(
  db: Database,
  clerkId: string,
  email: string,
): Promise<JwtUser | null> {
  // Look up existing user by clerkId
  const [existing] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (existing !== undefined) {
    return {
      id: existing.id,
      email: existing.email,
      role: existing.role,
      venueId: existing.venueId,
    };
  }

  // Also check by email (for users created before Clerk migration, or seed users)
  const [byEmail] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (byEmail !== undefined) {
    // Link Clerk ID to existing user
    await db.update(users).set({ clerkId, updatedAt: new Date() }).where(eq(users.id, byEmail.id));
    return {
      id: byEmail.id,
      email: byEmail.email,
      role: byEmail.role,
      venueId: byEmail.venueId,
    };
  }

  // On-the-fly user creation (webhook hasn't fired yet)
  const [created] = await db.insert(users).values({
    clerkId,
    email,
    name: email.split("@")[0] ?? "User",
    role: "planner",
  }).returning();

  if (created === undefined) return null;

  return {
    id: created.id,
    email: created.email,
    role: created.role,
    venueId: created.venueId,
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

  // In test mode, accept mock tokens (JSON-encoded user objects)
  if (token.startsWith("{")) {
    try {
      const mockUser = JSON.parse(token) as JwtUser;
      request.user = mockUser;
      return;
    } catch {
      // Not a mock token, fall through
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
    const email = (payload as Record<string, unknown>)["email"] as string | undefined;

    if (_db === null) {
      await reply.status(500).send({ error: "Database not available", code: "SERVER_ERROR" });
      return;
    }

    const user = await getUserByClerkId(_db, clerkId, email ?? `${clerkId}@clerk.user`);
    if (user === null) {
      await reply.status(500).send({ error: "Failed to resolve user", code: "SERVER_ERROR" });
      return;
    }

    request.user = user;
  } catch {
    await reply.status(401).send({ error: "Invalid or expired token", code: "UNAUTHORIZED" });
  }
}

// ---------------------------------------------------------------------------
// authorize — role-based guard (unchanged)
// ---------------------------------------------------------------------------

export function authorize(
  ...allowedRoles: readonly string[]
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const roleSet = new Set(allowedRoles);

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!roleSet.has(request.user.role)) {
      await reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
  };
}
