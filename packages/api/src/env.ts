import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod-validated environment variables — fail fast on startup if missing
//
// Production-required variables (CLERK_SECRET_KEY, CLERK_WEBHOOK_SECRET)
// are .optional() at the schema level so dev/test environments without
// Clerk configured can still boot. The cross-field check below enforces
// them ONLY when NODE_ENV === "production". This is the "fail fast in
// prod, permissive in dev" pattern.
// ---------------------------------------------------------------------------

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(3001),
  // Clerk — auth provider
  CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  CLERK_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Optional auth domain policy. Empty by default: invitation/pre-provisioned
  // users remain the primary access path.
  VENVIEWER_APPROVED_AUTH_DOMAINS: z.string().min(1).optional(),
  VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE: z.enum(["client", "planner", "staff", "hallkeeper", "admin"]).default("planner"),
  VENVIEWER_APPROVED_AUTH_DOMAIN_VENUE_ID: z.string().uuid().optional(),
  // Email — Resend (optional — logs to console if not set)
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).default("VenViewer <notifications@venviewer.com>"),
  // CORS — comma-separated allowed origins (defaults to localhost for dev)
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:5174"),
  // R2/S3 — optional (uploads disabled if not set)
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET_NAME: z.string().min(1).optional(),
  R2_PUBLIC_URL: z.string().url().optional(),
  // Frontend URL for email links (defaults to localhost)
  FRONTEND_URL: z.string().url().optional(),
  // Sentry — error tracking. DSN is optional (disabled if unset); the
  // SDK import itself is lazy so dev/test environments without Sentry
  // configured don't pay the cold-start cost.
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  // Prometheus scrape token. When unset, /metrics returns 404 — the
  // endpoint is not even discoverable. Production deployments set
  // this + configure the scraper's Authorization header. Minimum 16
  // chars so a weak token that slips through review is caught here.
  METRICS_TOKEN: z.string().min(16).optional(),
}).superRefine((env, ctx) => {
  // Punch list #5: in production, CLERK_WEBHOOK_SECRET MUST be set so
  // the webhook route can verify signatures. The route itself also fails
  // closed without the secret, but production should catch that at startup.
  if (env.NODE_ENV === "production") {
    if (process.env["VITEST"] !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NODE_ENV"],
        message: "VITEST must not be set in production (test auth bypasses must stay disabled)",
      });
    }
    if (env.CLERK_WEBHOOK_SECRET === undefined || env.CLERK_WEBHOOK_SECRET === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CLERK_WEBHOOK_SECRET"],
        message: "CLERK_WEBHOOK_SECRET is required in production (webhook signature verification cannot be skipped)",
      });
    }
    if (env.CLERK_SECRET_KEY === undefined || env.CLERK_SECRET_KEY === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CLERK_SECRET_KEY"],
        message: "CLERK_SECRET_KEY is required in production (auth tokens cannot be verified without it)",
      });
    }
    if (env.FRONTEND_URL === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FRONTEND_URL"],
        message: "FRONTEND_URL is required in production (email links will point to localhost without it)",
      });
    }
  }

  // R2 credential cohesion: if any R2 config is set, all required fields must be set.
  // R2_PUBLIC_URL is included because missing it causes upload failures at request time
  // rather than at startup — see F29 in audit findings.
  const r2Fields = [env.R2_ACCOUNT_ID, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY, env.R2_BUCKET_NAME, env.R2_PUBLIC_URL];
  const r2Set = r2Fields.filter((f) => f !== undefined).length;
  if (r2Set > 0 && r2Set < 5) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["R2_ACCOUNT_ID"],
      message: "R2 configuration is incomplete — set all of R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL or none",
    });
  }
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
