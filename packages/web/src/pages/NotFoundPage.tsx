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
// silently became the homepage. That reads as a bug rather than an answer —
// worst on the two cases it most often catches, an expired proposal link and a
// spent supplier token, where the visitor is holding a link somebody at the
// venue sent them and needs to learn it is the LINK that died, not their event.
//
// So this says what happened, offers the two things a visitor can actually do
// (ask about a date, go to the front door), and prints the hall's telephone
// number — the one contact that still works when a share token does not.
//
// It renders on the Fresh paper like every other public surface; nothing here
// is a new register.
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
  }, []);

  return (
    <div className="fr-root nf-root">
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
