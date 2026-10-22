import type { ErrorInfo } from "react";
import type { Breadcrumb, ErrorEvent, Event } from "@sentry/react";
import { redactHealthFreeText } from "@omnitwin/types";

type SentryReactModule = typeof import("./sentry-sdk.js");

export interface BrowserSentryEnv {
  readonly MODE?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_RELEASE?: string;
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
}

export interface BrowserSentryConfig {
  readonly dsn: string;
  readonly environment: string;
  readonly release?: string;
  readonly tracesSampleRate: number;
}

let sentryModulePromise: Promise<SentryReactModule> | null = null;
let initPromise: Promise<void> | null = null;
let initialized = false;
let disabledAfterError = false;

function trimmedEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

export function parseSentrySampleRate(value: string | undefined): number {
  const trimmed = trimmedEnv(value);
  if (trimmed === undefined) return 0;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return 0;
  return parsed;
}

export function readBrowserSentryConfig(env: BrowserSentryEnv): BrowserSentryConfig | null {
  const dsn = trimmedEnv(env.VITE_SENTRY_DSN);
  if (dsn === undefined) return null;

  return {
    dsn,
    environment: trimmedEnv(env.VITE_SENTRY_ENVIRONMENT) ?? trimmedEnv(env.MODE) ?? "production",
    release: trimmedEnv(env.VITE_SENTRY_RELEASE),
    tracesSampleRate: parseSentrySampleRate(env.VITE_SENTRY_TRACES_SAMPLE_RATE),
  };
}

function loadSentryModule(): Promise<SentryReactModule> {
  sentryModulePromise ??= import("./sentry-sdk.js");
  return sentryModulePromise;
}

function safeEventUrl(url: string | undefined): string | undefined {
  const trimmed = trimmedEnv(url);
  if (trimmed === undefined) return undefined;

  try {
    const parsed = new URL(trimmed, "https://venviewer.local");
    const pathOnly = parsed.pathname;
    if (parsed.origin === "https://venviewer.local" && trimmed.startsWith("/")) {
      return pathOnly;
    }
    return `${parsed.origin}${pathOnly}`;
  } catch {
    return undefined;
  }
}

export function scrubSentryEvent(event: Event): Event {
  const scrubbed: Event = { ...event };

  if (event.request !== undefined) {
    const safeRequest: NonNullable<Event["request"]> = {};
    const url = safeEventUrl(event.request.url);
    if (url !== undefined) safeRequest.url = url;
    if (event.request.method !== undefined) safeRequest.method = event.request.method;
    scrubbed.request = Object.keys(safeRequest).length > 0 ? safeRequest : undefined;
  }

  delete scrubbed.user;
  delete scrubbed.extra;

  // A guest's allergy note typed into the planner can surface in an error
  // message or a breadcrumb; it never leaves the browser (fix-first item 18).
  // The event is plain data, so the scrubbed copy keeps its shape.
  return redactHealthFreeText(scrubbed) as Event;
}

export function scrubSentryErrorEvent(event: ErrorEvent): ErrorEvent {
  return { ...scrubSentryEvent(event), type: undefined };
}

/** What replaces a query string, as the API's `withoutQuery` writes it, so a
 *  reader can tell one existed. */
export const REDACTED_QUERY_MARKER = "?[redacted]";
/** What replaces a fragment that had no query before it. */
export const REDACTED_FRAGMENT_MARKER = "#[redacted]";

/**
 * Cut a url's query and fragment and leave a marker in their place. Works for
 * relative and absolute urls; a url with neither is returned unchanged. The
 * search routes carry a client's name, email or phone in `?q=`, and a
 * fragment can carry a sign-in token.
 */
export function withoutQuery(url: string): string {
  const queryStart = url.indexOf("?");
  const fragmentStart = url.indexOf("#");
  if (queryStart !== -1 && (fragmentStart === -1 || queryStart < fragmentStart)) {
    return `${url.slice(0, queryStart)}${REDACTED_QUERY_MARKER}`;
  }
  if (fragmentStart !== -1) return `${url.slice(0, fragmentStart)}${REDACTED_FRAGMENT_MARKER}`;
  return url;
}

/** The breadcrumb data keys that hold a url: fetch and xhr write `url`,
 *  navigation writes `from` and `to`. */
const BREADCRUMB_URL_KEYS: readonly string[] = ["url", "from", "to"];

/**
 * `beforeBreadcrumb`: the browser SDK's fetch and xhr breadcrumbs keep the
 * whole request url in `data.url`, and navigation breadcrumbs the page urls
 * in `data.from` and `data.to`. Each loses its query and fragment.
 */
export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const data: Record<string, unknown> | undefined = breadcrumb.data;
  if (data === undefined) return breadcrumb;
  const scrubbed: Record<string, unknown> = { ...data };
  for (const key of BREADCRUMB_URL_KEYS) {
    const value = scrubbed[key];
    if (typeof value === "string") scrubbed[key] = withoutQuery(value);
  }
  return { ...breadcrumb, data: scrubbed };
}

async function startBrowserSentry(config: BrowserSentryConfig): Promise<void> {
  const Sentry = await loadSentryModule();
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: config.tracesSampleRate,
    sendDefaultPii: false,
    beforeSend: scrubSentryErrorEvent,
    beforeBreadcrumb: scrubSentryBreadcrumb,
  });
  initialized = true;
}

export async function initBrowserSentry(env: BrowserSentryEnv = import.meta.env): Promise<void> {
  const config = readBrowserSentryConfig(env);
  if (config === null || disabledAfterError) return;

  initPromise ??= startBrowserSentry(config).catch(() => {
    disabledAfterError = true;
    initialized = false;
  });
  await initPromise;
}

export async function captureBoundaryError(error: Error, info: ErrorInfo): Promise<void> {
  if (readBrowserSentryConfig(import.meta.env) === null || disabledAfterError) return;

  await initBrowserSentry();
  if (!initialized) return;

  const Sentry = await loadSentryModule();
  const componentStack = (info.componentStack ?? "").trim().slice(0, 4_000);

  Sentry.withScope((scope) => {
    scope.setTag("boundary", "AppErrorBoundary");
    if (componentStack.length > 0) {
      scope.setContext("react", { componentStack });
    }
    Sentry.captureException(error);
  });
}
