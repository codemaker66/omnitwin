import type { ErrorInfo } from "react";
import type { ErrorEvent, Event } from "@sentry/react";

type SentryReactModule = typeof import("@sentry/react");

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
  sentryModulePromise ??= import("@sentry/react");
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

  return scrubbed;
}

export function scrubSentryErrorEvent(event: ErrorEvent): ErrorEvent {
  return { ...scrubSentryEvent(event), type: undefined };
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

/**
 * Which catcher reported the error. It becomes the `boundary`
 * Sentry tag, so an operator can tell "the whole app fell over"
 * (AppErrorBoundary — the visitor is looking at Something went wrong) apart
 * from "a decorative subtree fell over and the page carried on"
 * (ArrivalErrorBoundary — the homepage hero flight died and the static
 * photograph took over, which no visitor will ever report because nothing
 * looks broken) — and both apart from "the hero's animation loop threw"
 * (ArrivalFrameLoop — arrival-frame-guard.ts, a throw out of a
 * requestAnimationFrame callback that NO error boundary can catch, contained
 * by hand). The first two are React boundaries; the third is not, and merging
 * it into ArrivalErrorBoundary's issue would hide a different remedy behind a
 * familiar name. Same event severity, very different remedies.
 */
export type BoundaryName = "AppErrorBoundary" | "ArrivalErrorBoundary" | "ArrivalFrameLoop";

export async function captureBoundaryError(
  error: Error,
  info: ErrorInfo,
  boundary: BoundaryName = "AppErrorBoundary",
): Promise<void> {
  if (readBrowserSentryConfig(import.meta.env) === null || disabledAfterError) return;

  await initBrowserSentry();
  if (!initialized) return;

  const Sentry = await loadSentryModule();
  const componentStack = (info.componentStack ?? "").trim().slice(0, 4_000);

  Sentry.withScope((scope) => {
    scope.setTag("boundary", boundary);
    if (componentStack.length > 0) {
      scope.setContext("react", { componentStack });
    }
    Sentry.captureException(error);
  });
}
