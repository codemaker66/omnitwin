import type { FastifyRequest, FastifyReply } from "fastify";

// ---------------------------------------------------------------------------
// JWT payload type — augments @fastify/jwt's FastifyJWT interface
// ---------------------------------------------------------------------------

/** The shape stored in the JWT payload and available on request.user. */
export interface JwtUser {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly venueId: string | null;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}

// ---------------------------------------------------------------------------
// authenticate — verifies Bearer token, attaches user to request
// ---------------------------------------------------------------------------

/**
 * Fastify preHandler hook that verifies the JWT Bearer token.
 * On success, request.user is typed as JwtUser.
 * On failure, returns 401 with { error, code }.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    await reply.status(401).send({
      error: "Authentication required",
      code: "UNAUTHORIZED",
    });
  }
}

// ---------------------------------------------------------------------------
// authorize — role-based guard
// ---------------------------------------------------------------------------

/**
 * Returns a preHandler hook that checks the authenticated user's role.
 * Must be used AFTER authenticate in the preHandler chain.
 *
 * Usage: `preHandler: [authenticate, authorize("admin", "staff")]`
 */
export function authorize(
  ...allowedRoles: readonly string[]
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const roleSet = new Set(allowedRoles);

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!roleSet.has(request.user.role)) {
      await reply.status(403).send({
        error: "Insufficient permissions",
        code: "FORBIDDEN",
      });
    }
  };
}
