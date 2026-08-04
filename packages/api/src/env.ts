import { z } from "zod";
import { createPublicKey } from "node:crypto";

// ---------------------------------------------------------------------------
// Zod-validated environment variables — fail fast on startup if missing
//
// Production-required variables (including Clerk credentials and the private
// reviewed-runtime storage connection)
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
  // Reviewed runtime profiles — private, API-mediated storage only. These
  // credentials must be scoped to this one private bucket. Deliberately no
  // public URL exists: anonymous bytes are released only through API gates.
  RUNTIME_PROFILE_R2_ACCOUNT_ID: z.string().min(1).optional(),
  RUNTIME_PROFILE_R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  RUNTIME_PROFILE_R2_PRIVATE_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u).optional(),
  // Reconstruction Foundry — candidates MUST remain in a private bucket;
  // verified releases are copied to a distinct, immutable public bucket.
  FOUNDRY_R2_ACCOUNT_ID: z.string().min(1).optional(),
  FOUNDRY_R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  FOUNDRY_R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  FOUNDRY_R2_CANDIDATE_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u).optional(),
  FOUNDRY_R2_RELEASE_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u).optional(),
  FOUNDRY_R2_PUBLIC_URL: z.string().url().optional(),
  // JSON object mapping a stable key id to an Ed25519 SPKI public key encoded
  // as base64 DER. The API verifies DSSE; it never holds a signing private key.
  FOUNDRY_ED25519_PUBLIC_KEYS_JSON: z.string().min(1).optional(),
  // Frontend URL for email links (defaults to localhost)
  FRONTEND_URL: z.string().url().optional(),
  // Canonical public API origin used to construct anonymous reviewed-profile
  // member URLs. Never derive public content URLs from Host/forwarded headers.
  PUBLIC_API_ORIGIN: z.string().url().optional(),
  // Sentry — error tracking. DSN is optional (disabled if unset); the
  // SDK import itself is lazy so dev/test environments without Sentry
  // configured don't pay the cold-start cost.
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  // AI assistant — disabled unless explicitly enabled and fully configured.
  // Product code talks to an adapter abstraction; these vars configure the
  // optional HTTP adapter and are never returned to clients.
  AI_ASSISTANT_ENABLED: z.enum(["true", "false"]).default("false"),
  AI_ASSISTANT_PROVIDER: z.string().min(1).max(80).optional(),
  AI_ASSISTANT_MODEL: z.string().min(1).max(120).optional(),
  AI_ASSISTANT_BASE_URL: z.string().url().optional(),
  AI_ASSISTANT_API_KEY: z.string().min(1).optional(),
  // Local/operator-only capture ledgers produced by tools/capture-factory.
  // When absent the protected status route returns an explicit unavailable
  // state; production does not assume a developer workstation path.
  CAPTURE_INTAKE_INSPECTION_PATH: z.string().min(1).optional(),
  CAPTURE_INTAKE_STAGE_MANIFEST_PATH: z.string().min(1).optional(),
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
    if (env.PUBLIC_API_ORIGIN === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PUBLIC_API_ORIGIN"],
        message: "PUBLIC_API_ORIGIN is required in production (public runtime URLs must not trust request Host headers)",
      });
    }
    for (const field of [
      "RUNTIME_PROFILE_R2_ACCOUNT_ID",
      "RUNTIME_PROFILE_R2_ACCESS_KEY_ID",
      "RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY",
      "RUNTIME_PROFILE_R2_PRIVATE_BUCKET",
    ] as const) {
      if (env[field] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required in production (reviewed runtime bytes require dedicated private storage)`,
        });
      }
    }
  }

  if (env.PUBLIC_API_ORIGIN !== undefined) {
    const url = new URL(env.PUBLIC_API_ORIGIN);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PUBLIC_API_ORIGIN"],
        message: "PUBLIC_API_ORIGIN must be a clean HTTPS origin without credentials, path, query, or fragment",
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

  const runtimeProfileR2Fields = [
    env.RUNTIME_PROFILE_R2_ACCOUNT_ID,
    env.RUNTIME_PROFILE_R2_ACCESS_KEY_ID,
    env.RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY,
    env.RUNTIME_PROFILE_R2_PRIVATE_BUCKET,
  ];
  const runtimeProfileR2Set = runtimeProfileR2Fields.filter((field) => field !== undefined).length;
  if (runtimeProfileR2Set > 0 && runtimeProfileR2Set < runtimeProfileR2Fields.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["RUNTIME_PROFILE_R2_PRIVATE_BUCKET"],
      message: "Runtime-profile R2 configuration is incomplete — set RUNTIME_PROFILE_R2_ACCOUNT_ID, RUNTIME_PROFILE_R2_ACCESS_KEY_ID, RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY, and RUNTIME_PROFILE_R2_PRIVATE_BUCKET together or none",
    });
  }

  if (
    env.RUNTIME_PROFILE_R2_PRIVATE_BUCKET !== undefined &&
    [
      env.R2_BUCKET_NAME,
      env.FOUNDRY_R2_CANDIDATE_BUCKET,
      env.FOUNDRY_R2_RELEASE_BUCKET,
    ].includes(env.RUNTIME_PROFILE_R2_PRIVATE_BUCKET)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["RUNTIME_PROFILE_R2_PRIVATE_BUCKET"],
      message: "Reviewed runtime profiles require a dedicated private bucket distinct from the legacy upload and Foundry buckets",
    });
  }

  const foundryFields = [
    env.FOUNDRY_R2_ACCOUNT_ID,
    env.FOUNDRY_R2_ACCESS_KEY_ID,
    env.FOUNDRY_R2_SECRET_ACCESS_KEY,
    env.FOUNDRY_R2_CANDIDATE_BUCKET,
    env.FOUNDRY_R2_RELEASE_BUCKET,
    env.FOUNDRY_R2_PUBLIC_URL,
  ];
  const foundrySet = foundryFields.filter((field) => field !== undefined).length;
  if (foundrySet > 0 && foundrySet < foundryFields.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["FOUNDRY_R2_CANDIDATE_BUCKET"],
      message: "Foundry R2 configuration is incomplete — set the three FOUNDRY_R2 credential fields, candidate/release buckets, and public URL together or none",
    });
  }
  if (
    env.FOUNDRY_R2_CANDIDATE_BUCKET !== undefined &&
    (
      env.FOUNDRY_R2_CANDIDATE_BUCKET === env.FOUNDRY_R2_RELEASE_BUCKET ||
      env.FOUNDRY_R2_CANDIDATE_BUCKET === env.R2_BUCKET_NAME
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["FOUNDRY_R2_CANDIDATE_BUCKET"],
      message: "Foundry candidates require a dedicated private bucket distinct from every public release bucket",
    });
  }
  if (
    env.FOUNDRY_R2_RELEASE_BUCKET !== undefined &&
    env.FOUNDRY_R2_RELEASE_BUCKET === env.R2_BUCKET_NAME
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["FOUNDRY_R2_RELEASE_BUCKET"],
      message: "Foundry releases require a dedicated immutable public bucket distinct from the legacy upload bucket",
    });
  }
  if (env.FOUNDRY_R2_PUBLIC_URL !== undefined) {
    const url = new URL(env.FOUNDRY_R2_PUBLIC_URL);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FOUNDRY_R2_PUBLIC_URL"],
        message: "FOUNDRY_R2_PUBLIC_URL must be a clean HTTPS base URL without credentials, query, or fragment",
      });
    }
  }
  if (env.FOUNDRY_ED25519_PUBLIC_KEYS_JSON !== undefined) {
    try {
      const parsed: unknown = JSON.parse(env.FOUNDRY_ED25519_PUBLIC_KEYS_JSON);
      const keys = z.record(
        z.string().min(1).max(160),
        z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/u, "must be base64-encoded SPKI DER"),
      ).safeParse(parsed);
      if (!keys.success || Object.keys(keys.data).length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["FOUNDRY_ED25519_PUBLIC_KEYS_JSON"],
          message: "FOUNDRY_ED25519_PUBLIC_KEYS_JSON must be a non-empty JSON object mapping key ids to base64 SPKI public keys",
        });
      } else {
        for (const [keyId, encoded] of Object.entries(keys.data)) {
          try {
            const der = Buffer.from(encoded, "base64");
            if (der.toString("base64") !== encoded) throw new Error("non-canonical base64");
            const publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
            if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("not Ed25519");
            const canonicalDer = Buffer.from(publicKey.export({ format: "der", type: "spki" }));
            if (!canonicalDer.equals(der)) throw new Error("non-canonical SPKI DER");
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["FOUNDRY_ED25519_PUBLIC_KEYS_JSON", keyId],
              message: "Foundry verification keys must be canonical base64 Ed25519 SPKI DER public keys",
            });
          }
        }
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FOUNDRY_ED25519_PUBLIC_KEYS_JSON"],
        message: "FOUNDRY_ED25519_PUBLIC_KEYS_JSON must contain valid JSON",
      });
    }
  }

  if (env.AI_ASSISTANT_ENABLED === "true") {
    const missingAiFields: string[] = [];
    if (env.AI_ASSISTANT_PROVIDER === undefined) missingAiFields.push("AI_ASSISTANT_PROVIDER");
    if (env.AI_ASSISTANT_MODEL === undefined) missingAiFields.push("AI_ASSISTANT_MODEL");
    if (env.AI_ASSISTANT_BASE_URL === undefined) missingAiFields.push("AI_ASSISTANT_BASE_URL");
    if (env.AI_ASSISTANT_API_KEY === undefined) missingAiFields.push("AI_ASSISTANT_API_KEY");
    if (missingAiFields.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AI_ASSISTANT_ENABLED"],
        message: `AI assistant is enabled but missing required provider configuration: ${missingAiFields.join(", ")}`,
      });
    }
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
