import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod-validated environment variables — fail fast on startup if missing
// ---------------------------------------------------------------------------

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(3001),
  // Clerk — auth provider
  CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  CLERK_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Email — Resend (optional — logs to console if not set)
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).default("OMNITWIN <notifications@omnitwin.com>"),
  // CORS — comma-separated allowed origins (defaults to localhost for dev)
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:5174"),
  // R2/S3 — optional (uploads disabled if not set)
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET_NAME: z.string().min(1).optional(),
  R2_PUBLIC_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Validates environment variables and returns a typed object.
 * Throws with a descriptive error if any required variable is missing.
 */
export function validateEnv(raw: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${errors}`);
  }
  return result.data;
}

/** The EnvSchema exported for testing. */
export { EnvSchema };
