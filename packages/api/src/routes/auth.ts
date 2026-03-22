import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hash, verify } from "argon2";
import { eq, and, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { users, refreshTokens } from "../db/schema.js";
import type { Database } from "../db/client.js";
import type { JwtUser } from "../middleware/auth.js";

// ---------------------------------------------------------------------------
// Zod schemas for request validation
// ---------------------------------------------------------------------------

const RegisterBodySchema = z.object({
  email: z.string().trim().min(1).max(255).email(),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  name: z.string().trim().min(1).max(200),
  role: z.enum(["client", "staff", "hallkeeper", "admin"]).default("client"),
  venueId: z.string().uuid().nullable().optional(),
});

const LoginBodySchema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(1),
});

const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

/** User response shape — never includes passwordHash. */
interface UserResponse {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: string;
  readonly venueId: string | null;
  readonly createdAt: string;
}

/** Auth response shape — user + tokens. */
interface AuthResponse {
  readonly user: UserResponse;
  readonly accessToken: string;
  readonly refreshToken: string;
}

// ---------------------------------------------------------------------------
// Token constants
// ---------------------------------------------------------------------------

/** Access token lifetime. */
const ACCESS_TOKEN_EXPIRY = "15m";

/** Refresh token lifetime in days. */
const REFRESH_TOKEN_DAYS = 7;

// ---------------------------------------------------------------------------
// Helper: generate token pair
// ---------------------------------------------------------------------------

async function generateTokenPair(
  server: FastifyInstance,
  db: Database,
  jwtUser: JwtUser,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = server.jwt.sign(
    { id: jwtUser.id, email: jwtUser.email, role: jwtUser.role, venueId: jwtUser.venueId },
    { expiresIn: ACCESS_TOKEN_EXPIRY },
  );

  const refreshToken = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokens).values({
    userId: jwtUser.id,
    token: refreshToken,
    expiresAt,
  });

  return { accessToken, refreshToken };
}

/** Format a DB user row for the response (strips passwordHash). */
function formatUser(row: {
  id: string;
  email: string;
  name: string;
  role: string;
  venueId: string | null;
  createdAt: Date;
}): UserResponse {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    venueId: row.venueId,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Plugin — registers auth routes under /auth prefix
// ---------------------------------------------------------------------------

export async function authRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // --- POST /auth/register ---

  server.post("/register", async (request, reply) => {
    const parsed = RegisterBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.issues,
      });
    }

    const { email, password, name, role, venueId } = parsed.data;

    // Check duplicate email
    const existing = await db.select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return reply.status(409).send({
        error: "Email already registered",
        code: "EMAIL_EXISTS",
      });
    }

    const passwordHash = await hash(password);

    const [newUser] = await db.insert(users).values({
      email,
      passwordHash,
      name,
      role,
      venueId: venueId ?? null,
    }).returning();

    if (newUser === undefined) {
      return reply.status(500).send({
        error: "Failed to create user",
        code: "INTERNAL_ERROR",
      });
    }

    const tokens = await generateTokenPair(server, db, {
      id: newUser.id,
      email: newUser.email,
      role: newUser.role,
      venueId: newUser.venueId,
    });

    const response: AuthResponse = {
      user: formatUser(newUser),
      ...tokens,
    };

    return reply.status(201).send(response);
  });

  // --- POST /auth/login ---

  server.post("/login", async (request, reply) => {
    const parsed = LoginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.issues,
      });
    }

    const { email, password } = parsed.data;

    const [user] = await db.select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (user === undefined) {
      return reply.status(401).send({
        error: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      });
    }

    const valid = await verify(user.passwordHash, password);
    if (!valid) {
      return reply.status(401).send({
        error: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      });
    }

    const tokens = await generateTokenPair(server, db, {
      id: user.id,
      email: user.email,
      role: user.role,
      venueId: user.venueId,
    });

    const response: AuthResponse = {
      user: formatUser(user),
      ...tokens,
    };

    return reply.status(200).send(response);
  });

  // --- POST /auth/refresh ---

  server.post("/refresh", async (request, reply) => {
    const parsed = RefreshBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.issues,
      });
    }

    const { refreshToken } = parsed.data;

    // Find the token, ensure it's not revoked and not expired
    const [tokenRow] = await db.select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.token, refreshToken),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .limit(1);

    if (tokenRow === undefined) {
      return reply.status(401).send({
        error: "Invalid refresh token",
        code: "INVALID_REFRESH_TOKEN",
      });
    }

    if (tokenRow.expiresAt < new Date()) {
      return reply.status(401).send({
        error: "Refresh token expired",
        code: "REFRESH_TOKEN_EXPIRED",
      });
    }

    // Revoke the old token (one-time use)
    await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, tokenRow.id));

    // Look up the user
    const [user] = await db.select()
      .from(users)
      .where(eq(users.id, tokenRow.userId))
      .limit(1);

    if (user === undefined) {
      return reply.status(401).send({
        error: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    const tokens = await generateTokenPair(server, db, {
      id: user.id,
      email: user.email,
      role: user.role,
      venueId: user.venueId,
    });

    const response: AuthResponse = {
      user: formatUser(user),
      ...tokens,
    };

    return reply.status(200).send(response);
  });
}
