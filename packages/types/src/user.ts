import { z } from "zod";
import { VenueIdSchema } from "./venue.js";

// ---------------------------------------------------------------------------
// User ID — UUID v4
// ---------------------------------------------------------------------------

export const UserIdSchema = z.string().uuid();

export type UserId = z.infer<typeof UserIdSchema>;

// ---------------------------------------------------------------------------
// User Role — the four user types in OMNITWIN
// ---------------------------------------------------------------------------

export const USER_ROLES = ["client", "staff", "hallkeeper", "admin"] as const;

export const UserRoleSchema = z.enum(USER_ROLES);

export type UserRole = z.infer<typeof UserRoleSchema>;

// ---------------------------------------------------------------------------
// Email — reusable email schema
// ---------------------------------------------------------------------------

export const EmailSchema = z
  .string()
  .trim()
  .min(1, "Email must not be empty")
  .max(320, "Email must be at most 320 characters")
  .email("Email must be a valid email address");

// ---------------------------------------------------------------------------
// User — the full persisted entity
// ---------------------------------------------------------------------------

export const UserSchema = z.object({
  id: UserIdSchema,
  email: EmailSchema,
  name: z.string().trim().min(1, "Name must not be empty").max(200, "Name must be at most 200 characters"),
  role: UserRoleSchema,
  venueIds: z.array(VenueIdSchema),
  createdAt: z.string().datetime({ message: "createdAt must be an ISO 8601 datetime string" }),
  updatedAt: z.string().datetime({ message: "updatedAt must be an ISO 8601 datetime string" }),
});

export type User = z.infer<typeof UserSchema>;

// ---------------------------------------------------------------------------
// CreateUser — fields needed to create a new user
// ---------------------------------------------------------------------------

export const CreateUserSchema = z.object({
  email: EmailSchema,
  name: z.string().trim().min(1, "Name must not be empty").max(200, "Name must be at most 200 characters"),
  role: UserRoleSchema,
  venueIds: z.array(VenueIdSchema),
});

export type CreateUser = z.infer<typeof CreateUserSchema>;

// ---------------------------------------------------------------------------
// Login / Register request schemas
// ---------------------------------------------------------------------------

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters`),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RegisterRequestSchema = z.object({
  email: EmailSchema,
  name: z.string().trim().min(1, "Name must not be empty").max(200, "Name must be at most 200 characters"),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters`)
    .max(MAX_PASSWORD_LENGTH, `Password must be at most ${String(MAX_PASSWORD_LENGTH)} characters`),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

// ---------------------------------------------------------------------------
// Auth Tokens — JWT access + refresh token pair
// ---------------------------------------------------------------------------

export const AuthTokensSchema = z.object({
  accessToken: z.string().min(1, "Access token must not be empty"),
  refreshToken: z.string().min(1, "Refresh token must not be empty"),
  expiresAt: z.string().datetime({ message: "expiresAt must be an ISO 8601 datetime string" }),
});

export type AuthTokens = z.infer<typeof AuthTokensSchema>;
