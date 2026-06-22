import { loadEnv } from "vite";

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

function trimmedEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

export function resolveWebClerkPublishableKey(
  env: Record<string, string | undefined>,
): string | undefined {
  const candidates = WEB_CLERK_PUBLISHABLE_KEY_ENV_NAMES
    .map((name) => trimmedEnv(env[name]))
    .filter((value): value is string => value !== undefined);

  return candidates.find((value) => value.startsWith("pk_live_")) ?? candidates[0];
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
  mode: string,
  env: Record<string, string | undefined> = loadEnv(mode, process.cwd(), ""),
): void {
  if (mode !== "production") return;

  const clerkKey = resolveWebClerkPublishableKey(env);
  if (clerkKey === undefined || clerkKey.length === 0) {
    throw new Error(
      "A Clerk publishable key is required for production web builds. " +
        "Set VITE_CLERK_PUBLISHABLE_KEY=pk_live_... in Vercel. " +
        "CLERK_PUBLISHABLE_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY are accepted as public-key aliases.",
    );
  }
  if (!clerkKey.startsWith("pk_live_")) {
    throw new Error(
      "Production web builds require a live Clerk publishable key (pk_live_...). " +
        "Do not ship Clerk development mode to venviewer.com.",
    );
  }

  getSentrySourceMapUploadConfig(env);
}
