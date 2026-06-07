import { loadEnv } from "vite";

export interface SentrySourceMapUploadConfig {
  readonly authToken: string;
  readonly org: string;
  readonly project: string;
  readonly release?: string;
}

function trimmedEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
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

  const clerkKey = env["VITE_CLERK_PUBLISHABLE_KEY"]?.trim();
  if (clerkKey === undefined || clerkKey.length === 0) {
    throw new Error(
      "VITE_CLERK_PUBLISHABLE_KEY is required for production web builds. " +
        "Set it in Vercel or in the local build environment.",
    );
  }

  getSentrySourceMapUploadConfig(env);
}
