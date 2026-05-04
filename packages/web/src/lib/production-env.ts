import { loadEnv } from "vite";

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
}
