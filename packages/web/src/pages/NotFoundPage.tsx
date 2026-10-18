import { useEffect, type ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  FRESH_CONTACT_PHONE_DISPLAY,
  FRESH_CONTACT_PHONE_HREF,
} from "./fresh/fresh-copy.js";
import "./fresh/fresh.css";
import "./NotFoundPage.css";

// ---------------------------------------------------------------------------
// The page that isn't there (T-616).
//
// Until now the `*` route was `<Navigate to="/" replace />`: every wrong URL
// silently became the homepage. That reads as a bug rather than an answer,
// and it is least kind to someone holding a link a person at the venue sent
// them: they need to learn that the LINK is wrong, not their event.
//
// The page cannot tell a mistyped address from an old link, so its words
// cover both plainly (17 October 2026; the heading used to assume an expired
// link). It says what happened, offers the two things a visitor can actually
// do (ask about a date, go to the front door), and prints the hall's telephone
// number — the one contact that works whatever happened to the link.
//
// It renders on the Fresh paper like the front door's sheet, pinned to its
// light theme as `/` is, so it introduces no register of its own.
// ---------------------------------------------------------------------------

// Exported so the edge's own 404 page (public/404.html, served by Vercel for
// any address outside the route allowlist) is held to the same words.
export const NOT_FOUND_TITLE = "There is no page at this address";
export const NOT_FOUND_BODY =
  "The address may have been mistyped, or the link may be an old one that has since been replaced. If someone at Trades Hall sent it to you, they can send you a fresh one.";
export const NOT_FOUND_HOME = "Go to the front door";
export const NOT_FOUND_ENQUIRE = "Ask about a date";
export const NOT_FOUND_CALL_LABEL = "Or call the hall";
export const NOT_FOUND_META_TITLE = "Page not found — Trades Hall of Glasgow";

export function NotFoundPage(): ReactElement {
  useEffect(() => {
    document.title = NOT_FOUND_META_TITLE;
    // An address outside vercel.json's route allowlist never reaches the app:
    // Vercel answers it with a real 404 and public/404.html. This page still
    // meets a wrong link inside a real route's shape (and every address in
    // development), served with a 200, so it tells search engines itself
    // that there is nothing here to index. It leaves with the page.
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex";
    document.head.appendChild(robots);
    return () => { robots.remove(); };
  }, []);

  return (
    <div className="fr-root nf-root" data-theme="light">
      <main className="nf-panel" data-testid="not-found">
        <div className="fr-arch" aria-hidden />
        <h1 className="nf-title">{NOT_FOUND_TITLE}</h1>
        <p className="nf-body">{NOT_FOUND_BODY}</p>
        <div className="nf-actions">
          <Link className="fr-cta" to="/#enquire">{NOT_FOUND_ENQUIRE}</Link>
          <Link className="fr-cta-quiet" to="/">{NOT_FOUND_HOME}</Link>
        </div>
        <p className="nf-call">
          {NOT_FOUND_CALL_LABEL}{" "}
          <a href={FRESH_CONTACT_PHONE_HREF}>{FRESH_CONTACT_PHONE_DISPLAY}</a>
        </p>
      </main>
    </div>
  );
}

export default NotFoundPage;
