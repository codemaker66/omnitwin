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
// So this says what happened, offers the two things a visitor can actually do
// (ask about a date, go to the front door), and prints the hall's telephone
// number — the one contact that works whatever happened to the link.
//
// It renders on the Fresh paper like the front door's sheet, pinned to its
// light theme as `/` is, so it introduces no register of its own.
// ---------------------------------------------------------------------------

const NOT_FOUND_TITLE = "That link has expired or moved";
const NOT_FOUND_BODY =
  "The page you asked for isn't here. If somebody at Trades Hall sent you this link, it may have been replaced since — they can send you a fresh one.";
const NOT_FOUND_HOME = "Go to the front door";
const NOT_FOUND_ENQUIRE = "Ask about a date";
const NOT_FOUND_CALL_LABEL = "Or call the hall";
const NOT_FOUND_META_TITLE = "Page not found — Trades Hall of Glasgow";

export function NotFoundPage(): ReactElement {
  useEffect(() => {
    document.title = NOT_FOUND_META_TITLE;
    // Every address is served the app with a 200 (vercel.json rewrites them
    // all to index.html), so this page tells search engines itself that
    // there is nothing here to index. It leaves with the page.
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
