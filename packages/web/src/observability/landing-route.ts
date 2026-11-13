// ---------------------------------------------------------------------------
// The route a page load landed on, and every move from it, recorded from boot
// (goal 07's field web vitals). The reporter loads a moment later as its own
// chunk; a redirect or a quick tap in between would otherwise label the
// landing page's vitals with the page the visitor moved to. Kept apart from
// the reporter so the entry module can start it without loading the reporter.
// ---------------------------------------------------------------------------

/** What is read of the app's router: the matched routes, and each change of
 *  them (React Router's data router has this shape). */
export interface AppRoutes {
  readonly state: { readonly matches: readonly { readonly route: { readonly path?: string } }[]; readonly historyAction: string };
  readonly subscribe: (listener: (state: AppRoutes["state"]) => void) => () => void;
}

export interface LandingRouteChange {
  /** The matched routes' paths, outermost first. */
  readonly paths: readonly (string | undefined)[];
  /** The move replaced the address (a redirect) rather than adding one. */
  readonly replace: boolean;
  /** The visitor had touched, clicked or typed before the move. */
  readonly interacted: boolean;
}

export interface LandingRoute {
  /** The matched routes' paths when the page loaded, outermost first. */
  readonly paths: readonly (string | undefined)[];
  /** Replays every move so far, then reports each as it happens. */
  readonly follow: (listener: (change: LandingRouteChange) => void) => void;
  /** Stops recording and following. */
  readonly stop: () => void;
}

function matchedPaths(state: AppRoutes["state"]): (string | undefined)[] {
  return state.matches.map((match) => match.route.path);
}

export function recordLandingRoute(routes: AppRoutes, target: EventTarget = window): LandingRoute {
  const paths = matchedPaths(routes.state);
  const moves: LandingRouteChange[] = [];
  let listener: ((change: LandingRouteChange) => void) | null = null;
  let interacted = false;
  let last = paths.join("\n");
  const noteInteraction = (): void => { interacted = true; };
  target.addEventListener("pointerdown", noteInteraction, { capture: true });
  target.addEventListener("keydown", noteInteraction, { capture: true });
  const unsubscribe = routes.subscribe((state) => {
    const next = matchedPaths(state);
    // The router also reports loading and revalidation; only a change of the
    // matched routes is a move.
    const key = next.join("\n");
    if (key === last) return;
    last = key;
    const change = { paths: next, replace: state.historyAction === "REPLACE", interacted };
    if (listener === null) moves.push(change);
    else listener(change);
  });
  return {
    paths,
    follow: (next) => {
      listener = next;
      for (const move of moves.splice(0)) {
        // A replayed move can end the following (the visitor left).
        if (listener !== next) return;
        next(move);
      }
    },
    stop: () => {
      listener = null;
      moves.length = 0;
      unsubscribe();
      target.removeEventListener("pointerdown", noteInteraction, { capture: true });
      target.removeEventListener("keydown", noteInteraction, { capture: true });
    },
  };
}
