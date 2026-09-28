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
        // An answer that outlived this notice, or its account (signed out or
        // replaced meanwhile), is not written back into the session.
        if (!mounted.current || askedFor === null || useAuthStore.getState().user?.id !== askedFor || user.id !== askedFor) return;
        // A venue in the account opens the view in place of this notice.
        useAuthStore.getState().setUser(user);
        setCheck(user.venueId === null ? "still" : "idle");
      })
      .catch(() => { if (mounted.current) setCheck("failed"); });
  };

  const checking = check === "checking";
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
          {check === "still" && <p className="vnc__status" role="status">Not connected yet.</p>}
          {check === "failed" && <p className="vnc__status" role="status">That check did not finish. Try again in a moment.</p>}
        </div>
      </section>
    </div>
  );
}
