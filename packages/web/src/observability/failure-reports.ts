// ---------------------------------------------------------------------------
// The 3D views' and the planner's failures, as Sentry warnings (F-07)
//
// Production could not see a renderer that failed to start, a lost graphics
// device, a view that stopped, a GPU error the view drew through, the planner
// canvas falling back to 2D, or a save that failed: each went to the console
// alone (planner-qol's CR F-07, 26 Oct 2026). Each kind is reported once per
// page, as a warning with tags only. The event scrubber (sentry.ts) drops
// `extra`, and a tag carries nothing a person typed: the failure's kind, the
// view (planner or walk), the graphics backend, an HTTP status, and a short
// technical detail (a GPU error's text, never a server's message).
// ---------------------------------------------------------------------------

import { captureWarning } from "./sentry.js";

export type FailureKind =
  | "renderer-failed"
  | "device-lost"
  | "view-stopped"
  | "gpu-error"
  | "planner-canvas-fallback"
  | "save-failed"
  /** A pipeline precompile that held the frames to its limit (lib/native-precompile.ts): the view drew on without it. */
  | "precompile-timeout";

export type FailureTags = Readonly<Record<string, string | number | undefined>>;

/** Sentry keeps a tag's value to 200 characters. */
const TAG_LIMIT = 200;

const reported = new Set<FailureKind>();

/** Reports a failure of `kind` once per page; later ones of the same kind add nothing. */
export function reportFailure(kind: FailureKind, tags: FailureTags = {}): void {
  if (reported.has(kind)) return;
  reported.add(kind);
  const clean: Record<string, string> = { failure: kind };
  for (const [name, value] of Object.entries(tags)) {
    if (value !== undefined) clean[name] = String(value).slice(0, TAG_LIMIT);
  }
  void captureWarning(`Venviewer failure: ${kind}`, clean).catch(() => undefined);
}

/** Tests: forget what this page has reported. */
export function resetFailureReportsForTests(): void {
  reported.clear();
}
