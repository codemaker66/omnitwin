// -----------------------------------------------------------------------------
// One record per finished run, so the sorting can be calibrated on people.
//
// The fairness numbers were measured against simulated respondents. This is
// how they become real. It sends exactly what @omnitwin/types QuizRunSchema
// allows — twelve seat indices, the verdict, how close it ran, how long, and
// which class of screen — and nothing that could identify anyone. It is
// fire-and-forget: a failure changes nothing the visitor sees, and it is never
// retried. Anyone who has asked not to be tracked is not.
// -----------------------------------------------------------------------------

import { QuizRunSchema, type QuizRun, type QuizRunViewport } from "@omnitwin/types";
import { API_URL } from "../../config/env.js";

export function classifyViewport(width: number): QuizRunViewport {
  if (width < 768) return "phone";
  if (width < 1180) return "tablet";
  return "desktop";
}

/** Do Not Track and Global Privacy Control are honoured as written. */
function visitorDeclined(): boolean {
  if (navigator.doNotTrack === "1") return true;
  return "globalPrivacyControl" in navigator && navigator.globalPrivacyControl === true;
}

/**
 * Sends the run. `keepalive` lets the request outlive a tab closed on the
 * reveal, which is when most people close it. The body goes as text/plain so
 * the request is a CORS "simple" one — no preflight to lose the keepalive
 * race against a closing tab, and the same shape a sendBeacon would send —
 * and the route parses it as JSON either way.
 * Returns whether a send was attempted, for tests — never whether it landed.
 */
export function recordQuizRun(run: QuizRun): boolean {
  if (typeof fetch !== "function" || visitorDeclined()) return false;
  const parsed = QuizRunSchema.safeParse(run);
  if (!parsed.success) return false;
  try {
    void fetch(`${API_URL}/public/quiz-runs`, {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(parsed.data),
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
