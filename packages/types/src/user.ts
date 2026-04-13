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

