import { z } from "zod";
import { VenueIdSchema } from "./venue.js";

// ---------------------------------------------------------------------------
// User ID — UUID v4
// ---------------------------------------------------------------------------

export const UserIdSchema = z.string().uuid();

export type UserId = z.infer<typeof UserIdSchema>;

// ---------------------------------------------------------------------------
// User Role — the five user types in OMNITWIN
//
// "planner" is the default role for users created via Clerk auth.
// "client" is a legacy alias — both have identical permissions.
// ---------------------------------------------------------------------------

export const USER_ROLES = ["client", "planner", "staff", "hallkeeper", "admin"] as const;

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
// User — the full persisted entity (matches DB columns)
//
// Includes Clerk-specific fields (clerkId) and profile fields
// (displayName, phone, organizationName) that the previous schema omitted.
// ---------------------------------------------------------------------------

export const UserSchema = z.object({
  id: UserIdSchema,
  clerkId: z.string().nullable(),
  email: EmailSchema,
  name: z.string().trim().min(1).max(200),
  displayName: z.string().nullable(),
  phone: z.string().nullable(),
  organizationName: z.string().nullable(),
  role: UserRoleSchema,
  venueId: VenueIdSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type User = z.infer<typeof UserSchema>;

// ---------------------------------------------------------------------------
// CreateUser — fields needed to create a new user (via webhook or admin)
// ---------------------------------------------------------------------------

export const CreateUserSchema = z.object({
  clerkId: z.string().min(1).optional(),
  email: EmailSchema,
  name: z.string().trim().min(1).max(200),
  displayName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  organizationName: z.string().nullable().optional(),
  role: UserRoleSchema,
  venueId: VenueIdSchema.nullable(),
});

export type CreateUser = z.infer<typeof CreateUserSchema>;

// ---------------------------------------------------------------------------
// Legacy auth schemas — DEPRECATED
//
// These model the old pre-Clerk password+JWT auth flow that no longer exists.
// Kept for backward compatibility with existing tests but should not be used
// in new code. The running system uses Clerk session tokens exclusively.
// ---------------------------------------------------------------------------

/** @deprecated Pre-Clerk auth. Use Clerk session tokens instead. */
export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(8),
});

/** @deprecated Pre-Clerk auth. */
// eslint-disable-next-line @typescript-eslint/no-deprecated
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** @deprecated Pre-Clerk auth. Use Clerk SignUp component instead. */
export const RegisterRequestSchema = z.object({
  email: EmailSchema,
  name: z.string().trim().min(1).max(200),
  password: z.string().min(8).max(128),
});

/** @deprecated Pre-Clerk auth. */
// eslint-disable-next-line @typescript-eslint/no-deprecated
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

/** @deprecated Pre-Clerk auth. Use Clerk session tokens instead. */
export const AuthTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.string().datetime(),
});

/** @deprecated Pre-Clerk auth. */
// eslint-disable-next-line @typescript-eslint/no-deprecated
export type AuthTokens = z.infer<typeof AuthTokensSchema>;
