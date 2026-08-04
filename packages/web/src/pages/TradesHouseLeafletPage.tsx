import { ExternalLink, Sparkles } from "lucide-react";
import { useEffect, type ReactElement } from "react";
import "./TradesHouseLeafletPage.css";

const LEAFLET_URL = "/trades-house-media/leaflet.html";

export function TradesHouseLeafletPage(): ReactElement {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Visitor leaflet — Trades House Glasgow";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <main className="trades-house-leaflet-page">
      <header className="trades-house-leaflet-toolbar">
        <div className="trades-house-leaflet-title">
          <span>Trades House of Glasgow</span>
          <h1>Visitor leaflet</h1>
        </div>
        <nav aria-label="Trades House campaign">
          <a className="trades-house-leaflet-action is-primary" href="/trades-house/discover-your-craft">
            <Sparkles aria-hidden="true" size={17} strokeWidth={1.5} />
            Discover your Craft
          </a>
          <a
            className="trades-house-leaflet-action"
            href={LEAFLET_URL}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink aria-hidden="true" size={16} strokeWidth={1.5} />
            Open printable leaflet
          </a>
        </nav>
        <p className="trades-house-leaflet-review-note">
          Venue-supplied campaign preview · final copy and image-rights review required before print.
        </p>
      </header>
      <iframe
        className="trades-house-leaflet-frame"
        src={LEAFLET_URL}
        title="Trades House Glasgow two-sided leaflet"
        loading="lazy"
      />
    </main>
  );
}
