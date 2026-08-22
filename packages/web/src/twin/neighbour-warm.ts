// -----------------------------------------------------------------------------
// neighbour-warm — the pre-residency QUEUE POLICY, extracted from TwinViewer's
// NeighborWarmer so both the cap and the deadline gate are testable with no
// browser, no rAF and no GPU.
//
// WHY THIS EXISTS. The warmer used to walk the RAW nav-graph adjacency and
// fire `warmEquirectBase` for every neighbour inside one `requestIdleCallback`.
// Three facts made that expensive. A 4096-wide equirect is 2:1, so the base
// tier is a 4096x2048 RGBA texture (~33.5 MB) and the warm callback pushes it
// to the GPU with a SYNCHRONOUS `renderer.initTexture`. The adjacency is
// unbounded — measured on the shipped Trades Hall bundle (149 nodes, 349
// edges) every node has at least four neighbours and the busiest has eight.
// And `requestIdleCallback` defers only the START of the loop: the uploads
// themselves run in promise continuations, long after the idle window closed,
// with no deadline left to check.
//
// MEASURED, on this worktree's dev server in headless Chromium (ANGLE/GL
// software path), six arrivals of degree 4-8, main-thread stalls sampled by a
// 4 ms interval:
//   warmer ON  — mean 318 ms of >50 ms stall per arrival, worst single block
//                309 ms at the degree-8 node (scan_086); every stall attributed
//                by long-animation-frame to useEquirectTexture.ts.
//   warmer OFF — zero stalls over 50 ms across the same six arrivals.
// Those blocks are one task each, not N: the continuations all drained in a
// single microtask checkpoint, so eight uploads landed back to back.
//
// AFTER this module, same harness, same machine, same six arrivals: mean 20 ms
// of >50 ms stall per arrival, worst single block 59 ms, and 0 ms at the
// degree-8 node. Sampling again at a 20 ms threshold — fine enough to resolve
// one upload — separates the cap from the slicing: budget 3 gives 3.8-4.7
// upload-sized blocks and 181-229 ms of total stall per arrival, while the same
// build with the budget temporarily raised to 8 gives 18.8 blocks and 940 ms.
// All of it on a software-GL path; real-GPU upload cost is NOT verified here.
//
// THE POLICY.
//
// Ordering is nearest-first by EUCLIDEAN distance from the node underfoot.
// Nav-graph distance cannot rank these at all — every candidate is exactly one
// edge away, so nav distance is 1 for all of them; the only nav quantity that
// discriminates is the edge length, which for a straight hop IS the Euclidean
// separation. Nearest-first also matches what the travel picker already
// prefers: `pickTravelTarget` scores `align + 0.15 / dist`, a deliberate
// nearness bonus so "travel takes the *next* step, not a leap". The nearest
// neighbours are therefore the likeliest next hop, and they are the ones worth
// spending the budget on.
//
// The cap is a hard per-arrival budget. At 33.5 MB a base, warming a degree-8
// node uncapped commits ~268 MB of GPU residency and ~300 ms of upload on one
// arrival; NEIGHBOUR_WARM_BUDGET holds that to ~101 MB and, because the runner
// spends one upload per idle slice, no single block is longer than one upload.
//
// WHAT IS PRESERVED. `isEquirectBaseWarm` keys off registry residency, so
// every id the queue ACQUIRES still lets a hop start on the sharp base instead
// of holding at the 512 preview. Release handles are collected as they are
// acquired and freed on dispose, including an acquire that lands after the
// queue was disposed.
// -----------------------------------------------------------------------------

/**
 * How many neighbour bases one arrival may pre-warm.
 *
 * Three. The shipped Trades Hall nav graph has a median degree of 4 and a
 * maximum of 8, so three covers the median node's nearest three of four while
 * holding neighbour residency to 3 x 33.5 MB ~= 101 MB instead of up to
 * ~268 MB, and per-arrival upload work to three slices instead of eight in one
 * task. It is a judgement call bounded by those two measured quantities, not a
 * measured optimum.
 */
export const NEIGHBOUR_WARM_BUDGET = 3;

/**
 * Idle time an upload must have left before the runner dares start one.
 *
 * A 4096x2048 upload measured ~38 ms on the software-GL path used for the
 * numbers above (309 ms / 8 uploads at scan_086), and browsers hand out idle
 * slices of up to 50 ms. There is no honest threshold that guarantees the
 * upload finishes inside the slice on unknown hardware, so this is the smaller
 * question the gate can actually answer: is this slice a genuine idle window,
 * or the ragged tail of one? 12 ms — under a 60 Hz frame budget — refuses the
 * tail and waits for the next real window.
 */
export const NEIGHBOUR_WARM_SLICE_MS = 12;

/**
 * Idle-callback timeout. A page that never idles would otherwise never
 * pre-warm, and every hop would fall back to the 512 preview; this bounds the
 * starvation at one upload per second rather than admitting a run of them.
 * Must stay well above NEIGHBOUR_WARM_SLICE_MS or the escape becomes the rule.
 */
export const NEIGHBOUR_WARM_TIMEOUT_MS = 1000;

/** One neighbour, with its position in the viewer's world frame (metres). */
export interface WarmCandidate {
  readonly id: string;
  readonly position: readonly [number, number, number];
}

/** The parts of `IdleDeadline` this module needs — so tests can hand one in. */
export interface IdleDeadlineLike {
  readonly didTimeout: boolean;
  readonly timeRemaining: () => number;
}

/** A texture held in the shared registry, plus the handle that frees the ref. */
export interface WarmAcquisition<T> {
  readonly texture: T;
  readonly release: () => void;
}

export interface NeighbourWarmQueueOptions<T> {
  /** Already planned and capped — see {@link planNeighbourWarm}. */
  readonly ids: readonly string[];
  /** Decode + registry-acquire one base. Resolves null when the load failed. */
  readonly acquire: (id: string) => Promise<WarmAcquisition<T> | null>;
  /** The SYNCHRONOUS GPU upload. Only ever called from a slice that passed
   *  {@link canUploadInSlice} — this is the call the defect was about. */
  readonly upload: (texture: T) => void;
  readonly requestSlice: (run: (deadline: IdleDeadlineLike) => void) => number;
  readonly cancelSlice: (handle: number) => void;
}

/**
 * Which neighbours to pre-warm, nearest-first, capped at `budget`.
 *
 * Candidates with a non-finite pose are dropped (they would poison the sort
 * with NaN); duplicate ids are collapsed; exact distance ties fall back to id
 * order so the queue is stable across re-renders of the same arrival.
 */
export function planNeighbourWarm(
  origin: readonly [number, number, number],
  candidates: readonly WarmCandidate[],
  budget: number = NEIGHBOUR_WARM_BUDGET,
): readonly string[] {
  if (budget <= 0) {
    return [];
  }
  const seen = new Set<string>();
  const ranked: { id: string; distance: number }[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) {
      continue;
    }
    const dx = candidate.position[0] - origin[0];
    const dy = candidate.position[1] - origin[1];
    const dz = candidate.position[2] - origin[2];
    const distance = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(distance)) {
      continue;
    }
    seen.add(candidate.id);
    ranked.push({ id: candidate.id, distance });
  }
  ranked.sort((a, b) =>
    a.distance === b.distance ? a.id.localeCompare(b.id) : a.distance - b.distance,
  );
  return ranked.slice(0, Math.floor(budget)).map((entry) => entry.id);
}

/**
 * May this idle slice afford one ~33.5 MB synchronous upload?
 *
 * A timed-out slice is admitted deliberately: without that escape a page that
 * never idles would never pre-warm at all, and the hop would fall back to the
 * 512 preview forever. The escape costs at most one upload per timeout period,
 * never a run of them.
 */
export function canUploadInSlice(deadline: IdleDeadlineLike): boolean {
  return deadline.didTimeout || deadline.timeRemaining() >= NEIGHBOUR_WARM_SLICE_MS;
}

/**
 * Drive the warm queue: one unit of work per idle slice, always yielding
 * between them. A slice either starts ONE acquire (cheap — the fetch and
 * decode are off the main thread) or performs ONE upload (expensive, and only
 * after {@link canUploadInSlice} says the window is real). Acquires are
 * strictly sequential, so at most one decoded pano is held in RAM awaiting
 * upload rather than the whole neighbour set at once.
 *
 * Returns the dispose handle: it cancels the pending slice and releases every
 * registry ref taken, including one still in flight.
 */
export function runNeighbourWarmQueue<T>(
  options: NeighbourWarmQueueOptions<T>,
): () => void {
  const { ids, acquire, upload, requestSlice, cancelSlice } = options;
  const releases: (() => void)[] = [];
  let disposed = false;
  let handle: number | null = null;
  let index = 0;
  let pending: T | null = null;

  const schedule = (): void => {
    if (disposed || handle !== null) {
      return;
    }
    handle = requestSlice(slice);
  };

  function slice(deadline: IdleDeadlineLike): void {
    handle = null;
    if (disposed) {
      return;
    }
    if (pending !== null) {
      // THE upload. Never more than one per slice, and never without a
      // deadline that can pay for it.
      if (!canUploadInSlice(deadline)) {
        schedule();
        return;
      }
      const texture = pending;
      pending = null;
      upload(texture);
      schedule();
      return;
    }
    const id = ids[index];
    if (id === undefined) {
      return; // drained
    }
    index += 1;
    void acquire(id).then((acquisition) => {
      if (acquisition === null) {
        schedule();
        return;
      }
      if (disposed) {
        acquisition.release();
        return;
      }
      releases.push(acquisition.release);
      pending = acquisition.texture;
      schedule();
    });
  }

  schedule();

  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    if (handle !== null) {
      cancelSlice(handle);
      handle = null;
    }
    pending = null;
    for (const release of releases) {
      release();
    }
    releases.length = 0;
  };
}
