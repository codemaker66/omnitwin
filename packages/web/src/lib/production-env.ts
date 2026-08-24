export interface SentrySourceMapUploadConfig {
  readonly authToken: string;
  readonly org: string;
  readonly project: string;
  readonly release?: string;
}

const WEB_CLERK_PUBLISHABLE_KEY_ENV_NAMES = [
  "VITE_CLERK_PUBLISHABLE_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
] as const;

type WebDeploymentTier = "production" | "staging";

const DEFAULT_WEB_DEPLOYMENT_TIER: WebDeploymentTier = "production";
const PRODUCTION_API_ORIGIN = "https://api.venviewer.com";
const GRAND_HALL_STAGING_BRANCH = "codex/grand-hall-exact-runtime";
const RAILWAY_STAGING_HOST_SUFFIX = ".up.railway.app";
const CLERK_DEVELOPMENT_HOST_SUFFIX = ".clerk.accounts.dev";
const LOCAL_BUILD_CONTEXT = "reviewed-local-only";
const VERCEL_GIT_SHA = /^[a-f0-9]{40}$/u;
const CLEAN_API_ORIGIN_ERROR =
  "Web builds require VITE_API_URL to be a canonical HTTPS origin without credentials, path, query, fragment, surrounding whitespace, or trailing slash.";

function trimmedEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

export function resolveWebClerkPublishableKey(
  env: Record<string, string | undefined>,
): string | undefined {
  const deploymentTier = trimmedEnv(env["VITE_DEPLOYMENT_TIER"]) === "staging"
    ? "staging"
    : DEFAULT_WEB_DEPLOYMENT_TIER;
  const requiredPrefix = deploymentTier === "staging" ? "pk_test_" : "pk_live_";
  const candidates = WEB_CLERK_PUBLISHABLE_KEY_ENV_NAMES
    .map((name) => trimmedEnv(env[name]))
    .filter((value): value is string => value !== undefined);

  return candidates.find((value) => value.startsWith(requiredPrefix)) ?? candidates[0];
}

function productionDeploymentTier(
  env: Record<string, string | undefined>,
): WebDeploymentTier {
  const deploymentTier = trimmedEnv(env["VITE_DEPLOYMENT_TIER"])
    ?? DEFAULT_WEB_DEPLOYMENT_TIER;

  if (deploymentTier !== "production" && deploymentTier !== "staging") {
    throw new Error(
      'VITE_DEPLOYMENT_TIER must be either "production" or "staging" for production web builds.',
    );
  }

  return deploymentTier;
}

function cleanBuildApiOrigin(
  env: Record<string, string | undefined>,
  variableName = "VITE_API_URL",
): URL {
  const rawApiOrigin = env[variableName];
  const apiOrigin = trimmedEnv(rawApiOrigin);
  if (apiOrigin === undefined) {
    throw new Error(`${variableName} is required for web builds.`);
  }

  let parsedApiOrigin: URL;
  try {
    parsedApiOrigin = new URL(apiOrigin);
  } catch {
    throw new Error(CLEAN_API_ORIGIN_ERROR);
  }

  if (
    rawApiOrigin !== apiOrigin ||
    parsedApiOrigin.protocol !== "https:" ||
    parsedApiOrigin.username !== "" ||
    parsedApiOrigin.password !== "" ||
    parsedApiOrigin.pathname !== "/" ||
    parsedApiOrigin.search !== "" ||
    parsedApiOrigin.hash !== "" ||
    apiOrigin !== parsedApiOrigin.origin
  ) {
    throw new Error(CLEAN_API_ORIGIN_ERROR);
  }
  return parsedApiOrigin;
}

function assertBuildProviderBoundary(
  deploymentTier: WebDeploymentTier,
  env: Record<string, string | undefined>,
): void {
  const vercel = trimmedEnv(env["VERCEL"]);
  const vercelEnvironment = trimmedEnv(env["VERCEL_ENV"]);
  const isVercelBuild = vercel !== undefined || vercelEnvironment !== undefined;
  if (!isVercelBuild) {
    if (env["VENVIEWER_WEB_LOCAL_BUILD_CONTEXT"] !== LOCAL_BUILD_CONTEXT) {
      throw new Error(
        `Non-Vercel web builds require VENVIEWER_WEB_LOCAL_BUILD_CONTEXT=${LOCAL_BUILD_CONTEXT}.`,
      );
    }
    return;
  }

  if (vercel !== "1") {
    throw new Error("Vercel web builds require VERCEL=1 system context.");
  }
  const requiredVercelEnvironment = deploymentTier === "staging" ? "preview" : "production";
  if (vercelEnvironment !== requiredVercelEnvironment) {
    throw new Error(
      `${deploymentTier} web builds require VERCEL_ENV=${requiredVercelEnvironment}.`,
    );
  }
  const targetEnvironment = trimmedEnv(env["VERCEL_TARGET_ENV"]);
  if (targetEnvironment !== requiredVercelEnvironment) {
    throw new Error("VERCEL_TARGET_ENV does not match the declared web deployment tier.");
  }
  const vercelGitRef = trimmedEnv(env["VERCEL_GIT_COMMIT_REF"]);
  const deployedGitSha = env["VERCEL_GIT_COMMIT_SHA"] ?? "";
  if (vercelGitRef === undefined || !VERCEL_GIT_SHA.test(deployedGitSha)) {
    throw new Error(
      "Vercel web builds require nonempty Git branch metadata and an exact 40-character Git commit SHA.",
    );
  }
  if (
    deploymentTier === "production" &&
    vercelGitRef === GRAND_HALL_STAGING_BRANCH
  ) {
    throw new Error(
      `Production-tier Vercel builds must not use the dedicated staging branch ${GRAND_HALL_STAGING_BRANCH}.`,
    );
  }
  if (deploymentTier === "staging") {
    if (vercelGitRef !== GRAND_HALL_STAGING_BRANCH) {
      throw new Error(
        `Grand Hall staging builds require VERCEL_GIT_COMMIT_REF=${GRAND_HALL_STAGING_BRANCH}.`,
      );
    }
    const reviewedGitSha = env["VENVIEWER_STAGING_REVIEWED_GIT_SHA"] ?? "";
    if (!VERCEL_GIT_SHA.test(reviewedGitSha) || reviewedGitSha !== deployedGitSha) {
      throw new Error(
        "Grand Hall staging builds require VENVIEWER_STAGING_REVIEWED_GIT_SHA to exactly match VERCEL_GIT_COMMIT_SHA.",
      );
    }
  }
}

function assertTierApiOrigin(
  deploymentTier: WebDeploymentTier,
  env: Record<string, string | undefined>,
): void {
  const apiUrl = cleanBuildApiOrigin(env);
  if (deploymentTier === "production") {
    if (apiUrl.origin !== PRODUCTION_API_ORIGIN) {
      throw new Error(`Production-tier web builds require VITE_API_URL=${PRODUCTION_API_ORIGIN}.`);
    }
    return;
  }

  const expectedStagingApiUrl = cleanBuildApiOrigin(
    env,
    "VENVIEWER_STAGING_EXPECTED_API_ORIGIN",
  );
  if (
    apiUrl.origin !== expectedStagingApiUrl.origin ||
    apiUrl.hostname === RAILWAY_STAGING_HOST_SUFFIX.slice(1) ||
    !apiUrl.hostname.endsWith(RAILWAY_STAGING_HOST_SUFFIX) ||
    apiUrl.port !== "" ||
    apiUrl.origin === PRODUCTION_API_ORIGIN
  ) {
    throw new Error(
      "Grand Hall staging requires VITE_API_URL to equal VENVIEWER_STAGING_EXPECTED_API_ORIGIN and use the dedicated Railway HTTPS domain.",
    );
  }
}

function decodeClerkFrontendApi(publishableKey: string, requiredPrefix: string): string | null {
  if (!publishableKey.startsWith(requiredPrefix)) return null;
  const encoded = publishableKey.slice(requiredPrefix.length);
  if (encoded.length === 0 || !/^[A-Za-z0-9_-]+={0,2}$/u.test(encoded)) return null;
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    if (!decoded.endsWith("$") || decoded.includes("\u0000")) return null;
    const frontendApi = decoded.slice(0, -1);
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u
      .test(frontendApi)
      ? frontendApi
      : null;
  } catch {
    return null;
  }
}

function assertStagingClerkBinding(
  deploymentTier: WebDeploymentTier,
  env: Record<string, string | undefined>,
  clerkKey: string,
): void {
  if (deploymentTier !== "staging") return;
  const expectedFrontendApi = trimmedEnv(
    env["VENVIEWER_STAGING_EXPECTED_CLERK_FRONTEND_API"],
  );
  const decodedFrontendApi = decodeClerkFrontendApi(clerkKey, "pk_test_");
  if (
    expectedFrontendApi === undefined ||
    env["VENVIEWER_STAGING_EXPECTED_CLERK_FRONTEND_API"] !== expectedFrontendApi ||
    !expectedFrontendApi.endsWith(CLERK_DEVELOPMENT_HOST_SUFFIX) ||
    decodedFrontendApi !== expectedFrontendApi
  ) {
    throw new Error(
      "Grand Hall staging requires its pk_test_ key to encode the independently recorded isolated Clerk development Frontend API.",
    );
  }
}

function assertTierSentryEnvironment(
  deploymentTier: WebDeploymentTier,
  env: Record<string, string | undefined>,
): void {
  const sentryEnvironment = trimmedEnv(env["VITE_SENTRY_ENVIRONMENT"]);
  if (
    sentryEnvironment !== undefined &&
    (env["VITE_SENTRY_ENVIRONMENT"] !== sentryEnvironment ||
      sentryEnvironment !== deploymentTier)
  ) {
    throw new Error(
      `VITE_SENTRY_ENVIRONMENT must be ${deploymentTier} when supplied for this web tier.`,
    );
  }
}

const GRAND_HALL_STAGING_FORBIDDEN_TELEMETRY_ENV = [
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
  "SENTRY_RELEASE",
  "VITE_SENTRY_DSN",
  "VITE_SENTRY_ENVIRONMENT",
  "VITE_SENTRY_RELEASE",
  "VITE_SENTRY_TRACES_SAMPLE_RATE",
  "VITE_POSTHOG_KEY",
  "VITE_POSTHOG_HOST",
] as const;

function assertStagingTelemetryIsolation(
  deploymentTier: WebDeploymentTier,
  env: Record<string, string | undefined>,
): void {
  if (deploymentTier !== "staging") return;
  const configured = GRAND_HALL_STAGING_FORBIDDEN_TELEMETRY_ENV.filter(
    (key) => env[key] !== undefined,
  );
  if (configured.length > 0) {
    throw new Error(
      "Grand Hall staging forbids every Sentry/source-map/PostHog variable so Preview builds and QA cannot write to production telemetry.",
    );
  }
}

export function getSentrySourceMapUploadConfig(
  env: Record<string, string | undefined>,
): SentrySourceMapUploadConfig | null {
  const authToken = trimmedEnv(env["SENTRY_AUTH_TOKEN"]);
  const org = trimmedEnv(env["SENTRY_ORG"]);
  const project = trimmedEnv(env["SENTRY_PROJECT"]);
  const providedCount = [authToken, org, project].filter((value) => value !== undefined).length;

  if (providedCount === 0) return null;

  if (authToken === undefined || org === undefined || project === undefined) {
    throw new Error(
      "Sentry source-map upload requires SENTRY_AUTH_TOKEN, SENTRY_ORG, and " +
        "SENTRY_PROJECT when any upload variable is set.",
    );
  }

  return {
    authToken,
    org,
    project,
    release: trimmedEnv(env["VITE_SENTRY_RELEASE"]) ?? trimmedEnv(env["SENTRY_RELEASE"]),
  };
}

export function assertRequiredProductionEnv(
  _mode: string,
  env: Record<string, string | undefined>,
  command: "build" | "serve" = "build",
): void {
  if (command !== "build") return;

  const deploymentTier = productionDeploymentTier(env);
  assertBuildProviderBoundary(deploymentTier, env);
  assertTierApiOrigin(deploymentTier, env);
  assertTierSentryEnvironment(deploymentTier, env);
  assertStagingTelemetryIsolation(deploymentTier, env);

  const clerkKey = resolveWebClerkPublishableKey(env);
  if (clerkKey === undefined || clerkKey.length === 0) {
    throw new Error(
      "A Clerk publishable key is required for production web builds. " +
        `Set VITE_CLERK_PUBLISHABLE_KEY=${deploymentTier === "staging" ? "pk_test_" : "pk_live_"}... in Vercel. ` +
        "CLERK_PUBLISHABLE_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY are accepted as public-key aliases.",
    );
  }

  const requiredClerkPrefix = deploymentTier === "staging" ? "pk_test_" : "pk_live_";
  const clerkKeySuffix = clerkKey.startsWith(requiredClerkPrefix)
    ? clerkKey.slice(requiredClerkPrefix.length)
    : "";
  if (
    clerkKeySuffix.length < 20 ||
    !/^[A-Za-z0-9_-]+={0,2}$/u.test(clerkKeySuffix)
  ) {
    throw new Error(
      deploymentTier === "staging"
        ? "Staging-tier web builds require a non-placeholder isolated Clerk test publishable key (pk_test_...)."
        : "Production-tier web builds require a non-placeholder live Clerk publishable key (pk_live_...). Do not ship Clerk development mode to venviewer.com.",
    );
  }

  assertStagingClerkBinding(deploymentTier, env, clerkKey);

  getSentrySourceMapUploadConfig(env);
}
