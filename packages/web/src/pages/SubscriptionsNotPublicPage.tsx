import { useEffect, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { ActivityIndicator } from "../components/shared/Activity.js";
import { authRouteWithReturnTo } from "../lib/auth-return.js";
import { hasLikelyClerkSession } from "../lib/clerk-session-hint.js";
import { useAuthStore } from "../stores/auth-store.js";
import "./SubscriptionsNotPublicPage.css";

// ---------------------------------------------------------------------------
// /pricing for everyone but a Venviewer admin (fix-first item 19, 16 October
// 2026).
//
// The subscription page stays admin-only until billing exists (Blake, 26
// September 2026). It used to send every visitor to "Welcome back", a sign-in
// wall for a page they could never open: a dead end that told an AI assistant
// or a venue looking at Venviewer nothing true. Now a visitor reads the plain
// fact — subscriptions are not public yet — and a way to talk to a named
// person. The founder's address is the one /platform already publishes.
//
// A visitor with no sign-in cookie gets the answer at once, without loading
// the sign-in code; only a likely signed-in browser waits for the check.
// ---------------------------------------------------------------------------

export const SUBSCRIPTIONS_TITLE = "Venviewer subscriptions are not yet public";
export const SUBSCRIPTIONS_META_TITLE = "Venviewer subscriptions — not yet public";
export const SUBSCRIPTIONS_CONTACT_EMAIL = "blake@venviewer.com";
const SUBSCRIPTIONS_CONTACT_HREF =
  `mailto:${SUBSCRIPTIONS_CONTACT_EMAIL}?subject=${encodeURIComponent("Venviewer for our venue")}`;

export function SubscriptionsNotPublicPage({ signedIn }: { readonly signedIn: boolean }): ReactElement {
  useEffect(() => {
    const previous = document.title;
    document.title = SUBSCRIPTIONS_META_TITLE;
    return () => { document.title = previous; };
  }, []);

  return (
    <main className="vv-route-state vv-subscriptions" aria-labelledby="vv-subscriptions-title">
      <section className="vv-state-panel">
        <p className="vv-state-kicker">Venviewer</p>
        <h1 id="vv-subscriptions-title">{SUBSCRIPTIONS_TITLE}</h1>
        <p>
          There is no price list to show yet, and nothing can be bought here. If you look after a venue and
          would like to talk about Venviewer for your rooms, write to Blake, who runs Venviewer.
        </p>
        <div className="vv-state-actions">
          <a className="vv-button primary" href={SUBSCRIPTIONS_CONTACT_HREF}>Email {SUBSCRIPTIONS_CONTACT_EMAIL}</a>
          <a className="vv-button" href="/platform">About Venviewer</a>
        </div>
        <p className="vv-subscriptions__aside">
          Planning an event at Trades Hall of Glasgow? <Link to="/">See the rooms and ask about a date</Link>.
        </p>
        {!signedIn && (
          <p className="vv-subscriptions__aside">
            Venviewer administrators can <Link to={authRouteWithReturnTo("/login", "/pricing")}>sign in</Link> to
            see the draft pricing.
          </p>
        )}
      </section>
    </main>
  );
}

/**
 * Who sees what at /pricing: a Venviewer admin sees the draft subscription
 * page; everyone else, signed in or not, sees the plain notice. The admin page
 * arrives as an element so its code loads only when an admin is shown it.
 */
export function PricingRoute({ admin }: { readonly admin: ReactElement }): ReactElement {
  const isLoading = useAuthStore((state) => state.isLoading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const role = useAuthStore((state) => state.user?.role ?? null);
  const hasUser = useAuthStore((state) => state.user !== null);

  if (!isAuthenticated && !hasUser && !hasLikelyClerkSession()) {
    return <SubscriptionsNotPublicPage signedIn={false} />;
  }
  if (isLoading) {
    return (
      <main className="vv-route-state" aria-label="Checking who is signed in">
        <section className="vv-state-panel" role="status" aria-live="polite">
          <ActivityIndicator size={48} />
          <h1>Checking who is signed in…</h1>
        </section>
      </main>
    );
  }
  if (isAuthenticated && role === "admin") return admin;
  return <SubscriptionsNotPublicPage signedIn={isAuthenticated} />;
}

export default PricingRoute;
