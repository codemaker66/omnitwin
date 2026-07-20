import { useEffect, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import {
  TWIN_ERROR_LINE,
  TWIN_LOADING_LINE,
  TWIN_PREPARING_LINE,
  TWIN_RETRY_LABEL,
  TWIN_TITLE,
} from "../twin/twin-copy.js";
import { TwinViewer } from "../twin/TwinViewer.js";
import {
  isDefaultTwinAssetBase,
  twinAssetBase,
  useTwinManifest,
} from "../twin/useTwinManifest.js";
import "../twin/twin.css";

// -----------------------------------------------------------------------------
// TwinPage — the public walkable twin at /venues/:venueSlug/twin.
//
// Phase 1: the route shell and its Rite-voiced states. The page owns
// loading / error / ready around the manifest fetch; the ready state mounts
// TwinViewer (Task 9) — the R3F walkthrough with its own HUD, including the
// disclosure line, which therefore renders exactly once on the page.
//
// Public from day one: named main landmark, calm failure states, and
// claim-safe copy (all strings live in twin-copy.ts) are the contract here.
// -----------------------------------------------------------------------------

/** Title-only document chrome (mirrors LandingPage's useRiteDocumentChrome). */
function useTwinDocumentTitle(): void {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = TWIN_TITLE;
    return () => {
      document.title = previousTitle;
    };
  }, []);
}

/**
 * Deploy posture (plan Task 12): until the twin bundle is published, a
 * production failure on the default asset base means "not ready yet", not
 * "broken" — the page stays patient rather than alarming. Any configured
 * VITE_TWIN_ASSET_BASE, or a dev build, reports the honest error line.
 */
function twinErrorLine(): string {
  return import.meta.env.PROD && isDefaultTwinAssetBase()
    ? TWIN_PREPARING_LINE
    : TWIN_ERROR_LINE;
}

export function TwinPage(): ReactElement {
  const params = useParams<{ venueSlug: string }>();
  // /tour mounts this page with no :venueSlug — the flagship is the
  // default so the branded short address stays in the URL bar.
  const venueSlug = params.venueSlug ?? "trades-hall";
  useTwinDocumentTitle();
  const manifest = useTwinManifest(venueSlug);

  return (
    <div className="vv-twin">
      <main
        className={
          manifest.state === "ready" ? "vv-twin-main vv-twin-main--viewer" : "vv-twin-main"
        }
        aria-label={TWIN_TITLE}
      >
        {/* Document structure: a page needs an h1, but the twin is all imagery,
            so it lives for screen readers only (finding [12]). */}
        <h1 className="vv-sr-only">{TWIN_TITLE}</h1>

        {manifest.state === "loading" && (
          <section className="vv-twin-state" role="status" aria-live="polite">
            <p className="vv-twin-line">{TWIN_LOADING_LINE}</p>
          </section>
        )}

        {manifest.state === "error" && (
          <section className="vv-twin-state" role="alert">
            <p className="vv-twin-line">{twinErrorLine()}</p>
            <button type="button" className="vv-twin-retry" onClick={manifest.retry}>
              {TWIN_RETRY_LABEL}
            </button>
          </section>
        )}

        {manifest.state === "ready" && (
          <div className="vv-twin-stage" data-testid="twin-stage">
            <TwinViewer
              // Re-seed the walk state if the venue ever changes without a
              // route remount (reviewer P1 — defence for the multi-venue
              // milestone; today's router always remounts).
              key={manifest.manifest.venueSlug}
              manifest={manifest.manifest}
              assetBase={`${twinAssetBase()}/${venueSlug}`}
            />
          </div>
        )}
      </main>
    </div>
  );
}
