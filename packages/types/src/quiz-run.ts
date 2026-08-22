import { z } from "zod";

// ---------------------------------------------------------------------------
// Quiz run — one completed pass through the Trades House craft quiz.
//
// The reason this exists: the sorting was measured fair against SIMULATED
// respondents (Gaussian temperaments). Real people are not Gaussians. A record
// of real paths and real verdicts is what turns "measured fair in simulation"
// into "measured fair", and lets the calibration tools run on humans.
//
// It carries NO personal data by construction: no user id, no IP, no user
// agent string, no free text — only the twelve seat indices, the verdict, how
// long it took, and which class of screen it was on. Nothing here can identify
// a person, and nothing here is worth stealing.
// ---------------------------------------------------------------------------

export const QUIZ_RUN_QUIZ_IDS = ["trades-house-craft"] as const;
export const QuizRunQuizIdSchema = z.enum(QUIZ_RUN_QUIZ_IDS);

/** The same SET as CRAFT_ORDER in the web model (order is immaterial; z.enum
 *  is set-based); kept as a plain list so the API can validate without
 *  importing the quiz. The web model's tests pin the two together. */
export const QUIZ_CRAFT_IDS = [
  "hammermen", "tailors", "cordiners", "maltmen", "weavers", "bakers", "skinners",
  "wrights", "coopers", "fleshers", "masons", "gardeners", "barbers", "dyers",
] as const;
export const QuizCraftIdSchema = z.enum(QUIZ_CRAFT_IDS);
export type QuizCraftId = z.infer<typeof QuizCraftIdSchema>;

export const QUIZ_RUN_VIEWPORTS = ["phone", "tablet", "desktop"] as const;
export const QuizRunViewportSchema = z.enum(QUIZ_RUN_VIEWPORTS);

export const QuizRunDeliberationSchema = z.object({
  pair: z.tuple([QuizCraftIdSchema, QuizCraftIdSchema]),
  choice: z.union([z.literal(0), z.literal(1)]),
  /** A bespoke scene for the pair (true) or one composed from world lines. */
  authored: z.boolean(),
});

/**
 * `answers` and `deliberation` are the inputs; everything after them is the
 * CLIENT'S CLAIM about what those inputs produced. The endpoint is anonymous
 * and unauthenticated, so a row is cheap to fabricate: consumers (the
 * calibration tools) recompute result/runnerUp/margin/hung from the inputs and
 * use the stored columns only as a consistency check — dropping rows where the
 * recomputation disagrees, and rows too quick to be a person.
 */
export const QuizRunSchema = z.object({
  quiz: QuizRunQuizIdSchema,
  /** The seat taken at each of the twelve scenes, 0–3, in order. */
  answers: z.array(z.number().int().min(0).max(3)).length(12),
  deliberation: QuizRunDeliberationSchema.nullable(),
  result: QuizCraftIdSchema,
  runnerUp: QuizCraftIdSchema,
  /** Winner minus runner-up on the blended score, so calibration can see how close it ran. */
  margin: z.number().min(-4).max(4),
  hung: z.boolean(),
  /** From BEGIN to the reveal. Capped so a tab left open overnight is not a data point. */
  durationMs: z.number().int().min(0).max(6 * 60 * 60 * 1000),
  viewport: QuizRunViewportSchema,
});

export type QuizRun = z.infer<typeof QuizRunSchema>;
export type QuizRunDeliberation = z.infer<typeof QuizRunDeliberationSchema>;
export type QuizRunViewport = z.infer<typeof QuizRunViewportSchema>;
