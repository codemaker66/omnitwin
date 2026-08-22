import type { FastifyInstance } from "fastify";
import { QuizRunSchema, type QuizRun } from "@omnitwin/types";
import { quizRuns } from "../db/schema.js";
import type { Database } from "../db/client.js";

/** Where a run goes. One method, so a test can hand the route a list. */
export interface QuizRunStore {
  record(run: QuizRun): Promise<void>;
}

export function drizzleQuizRunStore(db: Database): QuizRunStore {
  return {
    async record(run) {
      await db.insert(quizRuns).values({
        quiz: run.quiz,
        answers: run.answers,
        deliberation: run.deliberation,
        result: run.result,
        runnerUp: run.runnerUp,
        margin: run.margin,
        hung: run.hung,
        durationMs: run.durationMs,
        viewport: run.viewport,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// POST /public/quiz-runs — one completed pass through the craft quiz.
//
// The web page sends this with a keepalive fetch at the reveal, as text/plain
// (a CORS "simple" request, so it needs no preflight to survive a closing
// tab), so the route must be cheap, unauthenticated, and impossible to abuse
// into anything: the schema admits no free text and no identifiers, the row
// stores none, and the source address is seen only by the rate limiter — it
// is never written to the database, and this route logs no access line, so it
// is not written to the log stream either. A failure here is invisible to the
// visitor by design; the send is fire-and-forget and the page has moved on.
// ---------------------------------------------------------------------------

export async function publicQuizRunRoutes(
  server: FastifyInstance,
  opts: { store: QuizRunStore },
): Promise<void> {
  const { store } = opts;

  server.post("/quiz-runs", {
    // A valid run is ~400 bytes; anything larger is not a run. Rejected before
    // it is parsed, so the free requests an address gets cannot each be a
    // two-megabyte JSON.parse.
    bodyLimit: 4096,
    // No per-request access line: it would carry remoteAddress, for the one
    // route whose promise is that the address is not kept. Errors still log.
    logLevel: "warn",
    // Per source address. Sized for a room: an open day on the venue's guest
    // Wi-Fi is one NAT address and a few hundred people, and a limit that
    // dropped the thirty-first of them would bias the sample against exactly
    // the in-venue visitors it exists to measure. The row is ~200 bytes and
    // admits no free text, so the cost of abuse is storage.
    config: { rateLimit: { max: 300, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    // text/plain arrives as a string (a keepalive send, or a beacon); accept
    // it as JSON either way.
    const raw = typeof request.body === "string" ? safeParseJson(request.body) : request.body;
    const parsed = QuizRunSchema.safeParse(raw);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    await store.record(parsed.data);
    return reply.status(202).send({ accepted: true });
  });
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
