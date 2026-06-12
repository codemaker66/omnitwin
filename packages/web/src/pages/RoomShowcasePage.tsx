import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, CalendarDays, LayoutTemplate, Mail, ShieldQuestion, Sparkles, Users } from "lucide-react";
import type { PublicRoomRuntimeVisual } from "@omnitwin/types";
import { getPublicRoomRuntimeVisual } from "../api/public-room-visual.js";
import { recordRoomShowcaseEvent } from "../lib/public-room-analytics.js";
import { safePublicCopy } from "../lib/safe-public-copy.js";
import {
  getRoomShowcaseProfile,
  roomShowcaseRoutes,
  type RoomShowcaseProfile,
} from "../lib/trades-hall-room-showcase.js";
import "./RoomShowcasePage.css";

const RuntimeCanvas = lazy(() => import("../components/showcase/PublicRoomRuntimeCanvas.js").then((module) => ({
  default: module.PublicRoomRuntimeCanvas,
})));

const VENUE_SLUG = "trades-hall";

function safeFallbackVisual(roomSlug: RoomShowcaseProfile["slug"]): PublicRoomRuntimeVisual {
  return {
    venueSlug: VENUE_SLUG,
    roomSlug,
    runtimeVisualAvailable: false,
    visualUrl: null,
    visualLabel: "Visual preview",
    safeCopy: "Runtime room visual is not currently available for this public preview. Final details are confirmed by the venue team.",
    humanReviewRequired: true,
  };
}

interface HeroVisualProps {
  readonly profile: RoomShowcaseProfile;
  readonly runtimeVisual: PublicRoomRuntimeVisual;
  readonly visualFailed: boolean;
  readonly onRuntimeLoaded: () => void;
  readonly onRuntimeFailed: () => void;
}

function HeroVisual({
  profile,
  runtimeVisual,
  visualFailed,
  onRuntimeLoaded,
  onRuntimeFailed,
}: HeroVisualProps): ReactElement {
  const publicVisualUrl = runtimeVisual.runtimeVisualAvailable && runtimeVisual.visualUrl !== null && !visualFailed
    ? runtimeVisual.visualUrl
    : null;
  const canShowRuntime = publicVisualUrl !== null;

  return (
    <section className="room-showcase-visual" aria-label={`${profile.name} visual preview`}>
      <div className="room-showcase-visual-stage">
        {canShowRuntime ? (
          <Suspense
            fallback={(
              <div className="room-showcase-loading" role="status">
                Preparing visual preview
              </div>
            )}
          >
            <RuntimeCanvas
              visualUrl={publicVisualUrl}
              onLoaded={onRuntimeLoaded}
              onFailed={onRuntimeFailed}
            />
          </Suspense>
        ) : (
          <img src={profile.heroImage} alt={profile.heroImageAlt} />
        )}

        <div className="room-showcase-visual-label" aria-live="polite">
          <span>{runtimeVisual.visualLabel}</span>
          <strong>{canShowRuntime ? "Runtime visual available" : "Visual preview"}</strong>
        </div>
      </div>
      <p className="room-showcase-visual-note">
        {profile.heroImageKind === "venue-context" && !canShowRuntime
          ? "Venue context image shown while a room-specific public visual is prepared."
          : safePublicCopy(runtimeVisual.safeCopy)}
      </p>
    </section>
  );
}

function RoomNotFound(): ReactElement {
  return (
    <main className="room-showcase room-showcase-missing">
      <section className="room-showcase-missing-panel">
        <p className="room-showcase-kicker">Trades Hall rooms</p>
        <h1>Room preview unavailable</h1>
        <p>
          This room route is not available for the public preview. Choose one of the prepared Trades Hall room pages.
        </p>
        <div className="room-showcase-missing-links" aria-label="Available room routes">
          {roomShowcaseRoutes.map((route) => (
            <Link key={route} to={route}>{route.split("/").at(-1)?.replaceAll("-", " ")}</Link>
          ))}
        </div>
      </section>
    </main>
  );
}

export function RoomShowcasePage(): ReactElement {
  const { venueSlug, roomSlug } = useParams();
  const profile = useMemo(() => {
    if (venueSlug !== VENUE_SLUG || roomSlug === undefined) return null;
    return getRoomShowcaseProfile(roomSlug);
  }, [roomSlug, venueSlug]);

  const [runtimeVisual, setRuntimeVisual] = useState<PublicRoomRuntimeVisual | null>(null);
  const [selectedEventType, setSelectedEventType] = useState<string | null>(null);
  const [visualFailed, setVisualFailed] = useState(false);

  useEffect(() => {
    if (profile === null) return;
    recordRoomShowcaseEvent({
      name: "room_viewed",
      venueSlug: VENUE_SLUG,
      roomSlug: profile.slug,
    });
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    if (profile === null) return undefined;

    setRuntimeVisual(null);
    setVisualFailed(false);

    void getPublicRoomRuntimeVisual(VENUE_SLUG, profile.slug)
      .then((visual) => {
        if (!cancelled) setRuntimeVisual(visual);
      })
      .catch(() => {
        if (!cancelled) setRuntimeVisual(safeFallbackVisual(profile.slug));
      });

    return () => {
      cancelled = true;
    };
  }, [profile]);

  const loadedVisual = runtimeVisual ?? (profile === null ? null : safeFallbackVisual(profile.slug));

  const handleRuntimeLoaded = useCallback(() => {
    if (profile === null) return;
    recordRoomShowcaseEvent({
      name: "visual_loaded",
      venueSlug: VENUE_SLUG,
      roomSlug: profile.slug,
      visualSource: "runtime",
    });
  }, [profile]);

  const handleRuntimeFailed = useCallback(() => {
    setVisualFailed(true);
  }, []);

  const handleEventTypeSelected = useCallback((eventType: string) => {
    if (profile === null) return;
    setSelectedEventType(eventType);
    recordRoomShowcaseEvent({
      name: "event_type_selected",
      venueSlug: VENUE_SLUG,
      roomSlug: profile.slug,
      eventType,
      visualSource: loadedVisual?.runtimeVisualAvailable === true ? "runtime" : "fallback",
    });
  }, [loadedVisual?.runtimeVisualAvailable, profile]);

  const handleRequestLayout = useCallback(() => {
    if (profile === null) return;
    recordRoomShowcaseEvent({
      name: "request_layout_clicked",
      venueSlug: VENUE_SLUG,
      roomSlug: profile.slug,
    });
  }, [profile]);

  const handleEnquiry = useCallback(() => {
    if (profile === null) return;
    recordRoomShowcaseEvent({
      name: "enquiry_clicked",
      venueSlug: VENUE_SLUG,
      roomSlug: profile.slug,
    });
  }, [profile]);

  if (profile === null || loadedVisual === null) {
    return <RoomNotFound />;
  }

  return (
    <main className="room-showcase">
      <section className="room-showcase-hero">
        <div className="room-showcase-copy">
          <p className="room-showcase-kicker">Trades Hall room preview</p>
          <h1>{profile.name}</h1>
          <p className="room-showcase-lede">
            A client-safe visual preview for planning conversations. Human review is required before final room
            details are confirmed by the venue team.
          </p>

          <div className="room-showcase-actions" aria-label={`${profile.name} actions`}>
            <Link className="room-showcase-button primary" to={profile.requestLayoutHref} onClick={handleRequestLayout}>
              <LayoutTemplate aria-hidden="true" size={18} />
              Request layout
            </Link>
            <Link className="room-showcase-button" to={profile.enquiryHref} onClick={handleEnquiry}>
              <Mail aria-hidden="true" size={18} />
              Enquire about this room
            </Link>
            {profile.planningHref !== null ? (
              <Link className="room-showcase-button ghost" to={profile.planningHref}>
                <ArrowRight aria-hidden="true" size={18} />
                View planning options
              </Link>
            ) : null}
          </div>
        </div>

        <HeroVisual
          profile={profile}
          runtimeVisual={loadedVisual}
          visualFailed={visualFailed}
          onRuntimeLoaded={handleRuntimeLoaded}
          onRuntimeFailed={handleRuntimeFailed}
        />
      </section>

      <section className="room-showcase-details" aria-label={`${profile.name} planning guidance`}>
        <div className="room-showcase-guidance">
          <div className="room-showcase-guidance-item">
            <Users aria-hidden="true" size={20} />
            <div>
              <h2>Guest count guidance</h2>
              <p>{safePublicCopy(profile.guestGuidance)}</p>
            </div>
          </div>
          <div className="room-showcase-guidance-item">
            <ShieldQuestion aria-hidden="true" size={20} />
            <div>
              <h2>Review state</h2>
              <p>Planning-grade guidance only. Human review required before client or operational reliance.</p>
            </div>
          </div>
          <div className="room-showcase-guidance-item">
            <Sparkles aria-hidden="true" size={20} />
            <div>
              <h2>Visual status</h2>
              <p>{safePublicCopy(loadedVisual.safeCopy)}</p>
            </div>
          </div>
        </div>

        <div className="room-showcase-panel">
          <h2>Suitable event types</h2>
          <div className="room-showcase-event-types" role="list" aria-label="Suitable event types">
            {profile.eventTypes.map((eventType) => (
              <button
                key={eventType}
                type="button"
                className={eventType === selectedEventType ? "selected" : ""}
                onClick={() => {
                  handleEventTypeSelected(eventType);
                }}
              >
                <CalendarDays aria-hidden="true" size={16} />
                {eventType}
              </button>
            ))}
          </div>
        </div>

        <div className="room-showcase-panel">
          <h2>Room highlights</h2>
          <ul className="room-showcase-highlights">
            {profile.highlights.map((highlight) => (
              <li key={highlight}>{safePublicCopy(highlight)}</li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}

export default RoomShowcasePage;
