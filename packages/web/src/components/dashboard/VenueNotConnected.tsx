import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { getCurrentAuthUser } from "../../api/auth.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { ActivityIndicator } from "../shared/Activity.js";
import "./VenueNotConnected.css";

type Check = "idle" | "checking" | "still" | "failed";

export interface VenueNotConnectedProps {
  /** The view's own name, as the navigation shows it. */
  readonly title: string;
  /** What that means for this view: "there are no proposals to show". */
  readonly consequence: string;
}

/**
 * What a venue view shows an account that works at a venue but is not
 * connected to one yet (`awaitsVenue`, lib/role-capabilities.ts). No venue
 * read is made, as each would be refused, so nothing is shown as failing.
 * Only a Venviewer platform administrator can connect it, so it names the
 * person's Venviewer contact rather than their venue's admins. A connection
 * made meanwhile does not reach an open page, so it can be checked again in
 * place: once connected, the view opens instead of this.
 */
export function VenueNotConnected({ title, consequence }: VenueNotConnectedProps): ReactElement {
  const titleId = useId();
  const [check, setCheck] = useState<Check>("idle");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const checkAgain = (): void => {
    if (check === "checking") return;
    const askedFor = useAuthStore.getState().user?.id ?? null;
    setCheck("checking");
    getCurrentAuthUser()
      .then((user) => {
        if (!mounted.current) return;
        // An answer for an account signed out or replaced meanwhile is not
        // written back into the session; the button is simply offered again.
        if (askedFor === null || useAuthStore.getState().user?.id !== askedFor || user.id !== askedFor) {
          setCheck("idle");
          return;
        }
        useAuthStore.getState().setUser(user);
        if (user.venueId === null) {
          setCheck("still");
          return;
        }
        // Connected: the view opens in place of this notice, which leaves with
        // the button that had focus. The workspace takes it, as on any change
        // of view, so a keyboard or screen-reader user starts in the view.
        setCheck("idle");
        requestAnimationFrame(() => { document.getElementById("dashboard-main")?.focus({ preventScroll: true }); });
      })
      .catch(() => { if (mounted.current) setCheck("failed"); });
  };

  const checking = check === "checking";
  const said = check === "still" ? "Not connected yet."
    : check === "failed" ? "That check did not finish. Try again in a moment." : "";
  return (
    <div className="vnc" data-register="ivory" data-testid="venue-not-connected">
      <section className="vnc__sheet" aria-labelledby={titleId}>
        <h1 id={titleId} className="vnc__title">{title}</h1>
        <p className="vnc__lede">Your account is not connected to a venue yet, so {consequence}.</p>
        <p className="vnc__next">Your Venviewer contact can connect it.</p>
        <div className="vnc__actions">
          <button type="button" className="vnc__button" disabled={checking} aria-busy={checking} onClick={checkAgain}>
            {checking && <ActivityIndicator size={18} />}
            {checking ? "Checking…" : "Check again"}
          </button>
          {/* One live region, present from the start, whose words change:
              announced reliably, where one inserted with its words may not be. */}
          <p className="vnc__status" role="status">{said}</p>
        </div>
      </section>
    </div>
  );
}
