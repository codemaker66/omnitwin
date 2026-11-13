import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * When this image was built, for GET /health/version.
 *
 * The Dockerfile's last build step writes the UTC time into `.build-timestamp`
 * at the package root (/app in the image, beside dist/), so the value belongs
 * to the image itself. The BUILD_TIMESTAMP environment variable cannot be
 * trusted for this: Railway hands every service variable to the build and to
 * the running container, and the variable here was set by hand for an old
 * `railway up` deploy, so it kept reporting 24 September beside a current
 * commit. The file wins over it; the variable still answers where no file
 * exists, and "dev" answers a bare `node` run in development.
 *
 * BUILD_STAMP_FILE points the reader elsewhere; tests use it.
 */
const IMAGE_STAMP_FILE = fileURLToPath(new URL("../../.build-timestamp", import.meta.url));

// A stamp never changes while the process runs, and /health/version is public
// and unthrottled, so each file is read once.
const stamps = new Map<string, string | null>();

function stampFrom(path: string): string | null {
  const known = stamps.get(path);
  if (known !== undefined) return known;
  let stamped: string | null = null;
  try {
    const text = readFileSync(path, "utf8").trim();
    if (text.length > 0 && !Number.isNaN(Date.parse(text))) stamped = text;
  } catch {
    // No stamp file: not running from a built image.
  }
  stamps.set(path, stamped);
  return stamped;
}

export function readBuildTimestamp(env: NodeJS.ProcessEnv = process.env): string {
  return stampFrom(env["BUILD_STAMP_FILE"] ?? IMAGE_STAMP_FILE) ?? env["BUILD_TIMESTAMP"] ?? "dev";
}
