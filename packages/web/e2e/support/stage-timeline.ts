import { monitorEventLoopDelay } from "node:perf_hooks";
import { errors, type Page, type TestInfo } from "@playwright/test";

// ---------------------------------------------------------------------------
// The planner stage's milestones, timed inside the page (CARD A2).
//
// A time taken on the runner's clock also counts the runner: its scheduling,
// its wait for the document's `load` event, and the interval between polls.
// CI once read a first paint of 166 500 ms where every other first-attempt
// run (196 of them) read 8 612-10 456 ms, with the whole stall inside
// `page.goto` (11 Nov 2026, run 43025891563). These marks are taken by the
// page itself, when the DOM first shows each state, on the clock the
// navigation started.
//
// Times are milliseconds since this tab's FIRST navigation began: its first
// document's performance.timeOrigin is kept in sessionStorage, so a reload
// (the dev server's dependency optimiser can reload a page mid-boot) cannot
// restart the clock and hide the time already spent.
//
// The page's clock still counts a stalled Playwright worker: every request
// the page makes passes through the worker's route handlers. The page clock
// therefore does not say where that 166 s went, and its cause is unresolved.
// So the worker's own event-loop delay is recorded too (watchWorkerEventLoop),
// and printed with the page's evidence: a page that waited on a stalled worker
// shows a long worker delay, and a page that stalled by itself does not.
// ---------------------------------------------------------------------------

export type StageMilestone = "firstPaint" | "developing" | "settled";

/** What the page recorded. Milestones are null until they happen. */
export interface StageTimeline {
  /** How many documents this tab has loaded: 1 unless the page navigated or reloaded. */
  readonly documents: number;
  /** This document's PerformanceNavigationTiming type ("navigate", "reload", ...). */
  readonly navigationType: string;
  /**
   * First paint: a canvas inside the stage (the last `.cockpit-stage`, as the
   * specs read it) is laid out and not hidden, and the stage's
   * `data-resolve-phase` is `ink` or `developing`.
   */
  readonly firstPaint: number | null;
  /** The stage first reads `developing`. */
  readonly developing: number | null;
  /** The stage reads `resolved` and the last resolve caption has `data-visible="false"`. */
  readonly settled: number | null;
}

interface StageRecorder extends StageTimeline {
  /** Milliseconds since the tab's first navigation began, now. */
  readonly elapsed: () => number;
}

declare global {
  interface Window {
    __stageTimeline?: StageRecorder;
  }
}

/** Installs the recorder in every document the page loads. Call before `page.goto`. */
export async function recordStageTimeline(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const startKey = "e2e:stage-timeline:start";
    const documentsKey = "e2e:stage-timeline:documents";
    let start = performance.timeOrigin;
    let documents = 1;
    try {
      const stored = window.sessionStorage.getItem(startKey);
      if (stored === null) window.sessionStorage.setItem(startKey, String(start));
      else start = Number(stored);
      documents = Number(window.sessionStorage.getItem(documentsKey) ?? "0") + 1;
      window.sessionStorage.setItem(documentsKey, String(documents));
    } catch {
      // Storage refused: this document's own navigation start is the best clock left.
    }
    // The planner requests about a thousand modules in development; keep every timing entry.
    performance.setResourceTimingBufferSize(5_000);
    const navigation = performance.getEntriesByType("navigation")[0];
    const elapsed = (): number => performance.timeOrigin + performance.now() - start;
    const recorder = {
      documents,
      navigationType: navigation instanceof PerformanceNavigationTiming ? navigation.type : "unknown",
      firstPaint: null as number | null,
      developing: null as number | null,
      settled: null as number | null,
      elapsed,
    };
    window.__stageTimeline = recorder;
    const check = (): void => {
      const stages = document.querySelectorAll(".cockpit-stage");
      const stage = stages[stages.length - 1];
      if (stage === undefined) return;
      const phase = stage.getAttribute("data-resolve-phase");
      if (recorder.firstPaint === null && (phase === "ink" || phase === "developing")) {
        const canvas = stage.querySelector("canvas");
        const box = canvas?.getBoundingClientRect();
        if (canvas !== null && box !== undefined && box.width > 0 && box.height > 0
          && window.getComputedStyle(canvas).visibility !== "hidden") {
          recorder.firstPaint = elapsed();
          performance.mark("card-a2:first-paint");
        }
      }
      if (recorder.developing === null && phase === "developing") {
        recorder.developing = elapsed();
        performance.mark("card-a2:developing");
      }
      if (recorder.settled === null && phase === "resolved") {
        const captions = document.querySelectorAll('[data-testid="room-resolve-caption"]');
        if (captions[captions.length - 1]?.getAttribute("data-visible") === "false") {
          recorder.settled = elapsed();
          performance.mark("card-a2:settled");
        }
      }
    };
    // Mutations catch each state as the DOM takes it; frames catch layout-only changes (a canvas
    // sized by style), which no mutation reports. Both stop once the stage has settled.
    const observer = new MutationObserver(() => {
      check();
      if (recorder.settled !== null) observer.disconnect();
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true });
    const frame = (): void => {
      check();
      if (recorder.settled === null) window.requestAnimationFrame(frame);
      else observer.disconnect();
    };
    window.requestAnimationFrame(frame);
  });
}

/**
 * How long past a milestone's own window the runner waits for the page to say
 * so. Only a page that stopped running (or never installed the recorder) is
 * still silent then, and it fails there, with its evidence, rather than at the
 * test's timeout with none.
 */
export const RUNNER_BACKSTOP_MS = 60_000;

/** The page gave no answer in the time the runner allowed it. */
class PageSilent extends Error {}

/**
 * `work`, or a PageSilent rejection once `ms` have passed on the runner's clock
 * without it. Playwright's own timeouts do not always fire while the page's
 * main thread is wedged (a page stuck in a loop held waitForFunction past its
 * 75 s timeout until the test's own 240 s timeout closed the page).
 */
async function answerWithin<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new PageSilent(`the page did not answer within ${String(ms)} ms`)); }, ms);
  });
  // A late answer, or a late failure, is not this case's.
  work.catch(() => undefined);
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Waits for `milestone` on the page's own clock: the time it was recorded, or
 * null once `withinMs` have passed since the navigation began without it. The
 * runner's clock only backstops a page that stops answering: null also after
 * `withinMs` + RUNNER_BACKSTOP_MS on the runner's clock, with a line saying so.
 */
export async function stageMilestone(page: Page, milestone: StageMilestone, withinMs: number): Promise<number | null> {
  const backstopMs = withinMs + RUNNER_BACKSTOP_MS;
  const recorded = async (): Promise<number | null> => {
    const handle = await page.waitForFunction(([key, limit]) => {
      const recorder = window.__stageTimeline;
      if (recorder === undefined) return false;
      const at = recorder[key];
      if (at !== null) return { at };
      return recorder.elapsed() > limit ? { at: null } : false;
    }, [milestone, withinMs] as const, { timeout: backstopMs, polling: 100 });
    const value: unknown = await handle.jsonValue();
    await handle.dispose();
    if (typeof value !== "object" || value === null || !("at" in value)) throw new Error("The stage timeline returned no time");
    return typeof value.at === "number" ? value.at : null;
  };
  try {
    return await answerWithin(recorded(), backstopMs);
  } catch (error) {
    if (!(error instanceof PageSilent) && !(error instanceof errors.TimeoutError)) throw error;
    // eslint-disable-next-line no-console -- deliberate: CARD-A2 failure evidence in the runner output
    console.log(`[CARD-A2] no ${milestone} from the page within ${String(backstopMs)} ms on the runner's clock: the page stopped answering, or its stage recorder never installed`);
    return null;
  }
}

/** The recorder's state now, without its clock. */
export async function readStageTimeline(page: Page): Promise<StageTimeline | null> {
  return page.evaluate(() => {
    const recorder = window.__stageTimeline;
    if (recorder === undefined) return null;
    return {
      documents: recorder.documents, navigationType: recorder.navigationType,
      firstPaint: recorder.firstPaint, developing: recorder.developing, settled: recorder.settled,
    };
  });
}

/**
 * The Playwright worker's own event-loop delay while it was watched, ms. Each
 * sample is the time between two of the monitor's ticks, so an idle loop reads
 * about one tick (more on Windows' coarse timers: 25-33 ms here at 20 ms ticks),
 * and a loop blocked for N ms reads about N (1 000 ms measured as 1 016).
 */
export interface WorkerLoopDelay {
  /** The longest the worker's loop ran late: a stalled worker shows here. */
  readonly maxMs: number;
  readonly p99Ms: number;
  readonly meanMs: number;
  /** Delays sampled (one per resolution tick while the loop ran). */
  readonly samples: number;
  /** How long it was watched, ms. */
  readonly watchedMs: number;
}

export interface WorkerLoopWatch {
  /** The delays so far. */
  readonly read: () => WorkerLoopDelay;
  /** Stops watching; the delays over the whole watch. */
  readonly stop: () => WorkerLoopDelay;
}

/** The worker's loop is sampled this often, ms (Node's default is 10). */
const LOOP_RESOLUTION_MS = 20;

/** Starts timing the Playwright worker's own event loop (perf_hooks.monitorEventLoopDelay). */
export function watchWorkerEventLoop(): WorkerLoopWatch {
  const histogram = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  const startedAt = performance.now();
  histogram.enable();
  const ms = (nanoseconds: number): number => Math.round(nanoseconds / 1e5) / 10;
  const read = (): WorkerLoopDelay => {
    const samples = histogram.count;
    return {
      maxMs: samples === 0 ? 0 : ms(histogram.max),
      p99Ms: samples === 0 ? 0 : ms(histogram.percentile(99)),
      meanMs: samples === 0 ? 0 : ms(histogram.mean),
      samples,
      watchedMs: Math.round(performance.now() - startedAt),
    };
  };
  return {
    read,
    stop: () => {
      histogram.disable();
      return read();
    },
  };
}

/** One line of a worker's loop delay, for the job log. */
export function describeWorkerLoop(delay: WorkerLoopDelay): string {
  return `worker loop delay max ${String(delay.maxMs)}ms p99 ${String(delay.p99Ms)}ms mean ${String(delay.meanMs)}ms (${String(delay.samples)} ${String(LOOP_RESOLUTION_MS)} ms ticks over ${String(delay.watchedMs)}ms)`;
}

/** How long the evidence waits for the page to answer: a page that stopped running must not hide why. */
const PAGE_ANSWER_MS = 10_000;

/**
 * Attaches the stage timeline, the navigation's timing, the ten slowest
 * requests and the worker's own loop delay, and prints one line of them: a
 * full re-run deletes the failing attempt's artifacts, and the job log is
 * what survives. It never throws: a page that crashed or stopped answering is
 * reported as such, and the case's own assertion still says what failed.
 */
export async function attachStageEvidence(page: Page, testInfo: TestInfo, label: string, workerLoop?: WorkerLoopWatch): Promise<void> {
  const loop = workerLoop?.read() ?? null;
  const answer = await answerWithin(page.evaluate(() => {
    const round = (value: number): number => Math.round(value);
    const recorder = window.__stageTimeline;
    const navigation = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource")
      .filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming);
    const slowest = [...resources].sort((a, b) => b.duration - a.duration).slice(0, 10).map((entry) => ({
      name: entry.name.replace(window.location.origin, ""), startTime: round(entry.startTime), duration: round(entry.duration),
      responseStart: round(entry.responseStart), transferSize: entry.transferSize,
    }));
    return {
      timeline: recorder === undefined ? null : {
        documents: recorder.documents, navigationType: recorder.navigationType,
        firstPaint: recorder.firstPaint === null ? null : round(recorder.firstPaint),
        developing: recorder.developing === null ? null : round(recorder.developing),
        settled: recorder.settled === null ? null : round(recorder.settled),
      },
      navigation: navigation instanceof PerformanceNavigationTiming ? {
        type: navigation.type, responseStart: round(navigation.responseStart),
        domContentLoadedEventEnd: round(navigation.domContentLoadedEventEnd), loadEventEnd: round(navigation.loadEventEnd),
      } : null,
      resources: resources.length,
      slowest,
    };
  }), PAGE_ANSWER_MS).then(
    (evidence) => ({ evidence, unavailable: null }),
    (error: unknown) => ({ evidence: null, unavailable: (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "" }),
  );
  try {
    await testInfo.attach(`${label}.timing.json`, {
      body: JSON.stringify({ ...(answer.evidence ?? { unavailable: answer.unavailable }), workerEventLoop: loop }, null, 2),
      contentType: "application/json",
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- deliberate: CARD-A2 timing evidence in the runner output
    console.log(`[CARD-A2 ${label}] could not attach the evidence: ${error instanceof Error ? error.message : String(error)}`);
  }
  const worker = loop === null ? "" : `; ${describeWorkerLoop(loop)}`;
  const evidence = answer.evidence;
  if (evidence === null) {
    // eslint-disable-next-line no-console -- deliberate: CARD-A2 timing evidence in the runner output
    console.log(`[CARD-A2 ${label}] page unavailable (${answer.unavailable})${worker}`);
    return;
  }
  const slow = evidence.slowest.slice(0, 3).map((entry) => `${entry.name.slice(-60)} ${String(entry.duration)}ms@${String(entry.startTime)}`).join(", ");
  // eslint-disable-next-line no-console -- deliberate: CARD-A2 timing evidence in the runner output
  console.log(`[CARD-A2 ${label}] page ${JSON.stringify(evidence.timeline)} nav ${JSON.stringify(evidence.navigation)} resources ${String(evidence.resources)}; slowest: ${slow}${worker}`);
}
