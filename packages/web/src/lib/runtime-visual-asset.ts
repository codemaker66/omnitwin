import { FORBIDDEN_ASSET_FIXTURE_MARKERS } from "@omnitwin/types";

export const RUNTIME_SPLAT_EXTENSIONS = [
  ".ply",
  ".spz",
  ".splat",
  ".ksplat",
  ".rad",
  ".radc",
] as const;

export type RuntimeSplatExtension = (typeof RUNTIME_SPLAT_EXTENSIONS)[number];

export interface RuntimeSplatUrlResult {
  readonly ok: boolean;
  readonly url: string | null;
  readonly extension: RuntimeSplatExtension | null;
  readonly error: string | null;
}

export interface RuntimeSplatUrlSearchOptions {
  readonly allowManualUrl?: boolean;
}

const FORBIDDEN_FIXTURE_MARKERS = FORBIDDEN_ASSET_FIXTURE_MARKERS;

function extensionForPath(pathname: string): RuntimeSplatExtension | null {
  const lowerPath = pathname.toLowerCase();
  return RUNTIME_SPLAT_EXTENSIONS.find((extension) => lowerPath.endsWith(extension)) ?? null;
}

function result(
  ok: boolean,
  url: string | null,
  extension: RuntimeSplatExtension | null,
  error: string | null,
): RuntimeSplatUrlResult {
  return { ok, url, extension, error };
}

export function parseRuntimeSplatUrl(rawUrl: string | null | undefined): RuntimeSplatUrlResult {
  const trimmed = rawUrl?.trim() ?? "";
  if (trimmed.length === 0) {
    return result(false, null, null, null);
  }

  const lower = trimmed.toLowerCase();
  if (FORBIDDEN_FIXTURE_MARKERS.some((marker) => lower.includes(marker))) {
    return result(false, null, null, "Fixture-only Spark sources are not runtime assets.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed, "https://venviewer.local");
  } catch {
    return result(false, null, null, "Enter a valid http(s) URL or root-relative asset path.");
  }

  const isRootRelative = trimmed.startsWith("/");
  const isHttpUrl = /^https?:\/\//i.test(trimmed);
  if (!isRootRelative && !isHttpUrl) {
    return result(false, null, null, "Only http(s) URLs or root-relative asset paths are supported.");
  }

  const extension = extensionForPath(parsed.pathname);
  if (extension === null) {
    return result(false, null, null, "Asset URL must end in .ply, .spz, .splat, .ksplat, .rad, or .radc.");
  }

  return result(true, trimmed, extension, null);
}

export function runtimeSplatUrlFromSearchParams(
  searchParams: URLSearchParams,
  options: RuntimeSplatUrlSearchOptions = {},
): RuntimeSplatUrlResult {
  const rawUrl = searchParams.get("splatUrl");
  const trimmed = rawUrl?.trim() ?? "";
  if (trimmed.length > 0 && options.allowManualUrl === false) {
    return result(
      false,
      null,
      null,
      "Manual runtime asset URLs are disabled in this build; use a registered runtime package.",
    );
  }
  return parseRuntimeSplatUrl(rawUrl);
}
