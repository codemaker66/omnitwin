import { useEffect, useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Building2 } from "lucide-react";
import { getVenue, type VenueDetail } from "../../api/spaces.js";
import { DashboardLayout } from "../../components/dashboard/DashboardLayout.js";
import { RoomPlanReference } from "../../components/hallkeeper/RoomPlanReference.js";
import { ActivityStatus } from "../../components/shared/Activity.js";
import { HALLKEEPER_PLAN_VENUE_SLUG, HALLKEEPER_ROOM_PLANS, getHallkeeperRoomPlan, type HallkeeperRoomPlan } from "../../data/hallkeeper-room-plans.js";
import { roomPosterUrl } from "../../lib/room-posters.js";
import { useAuthStore } from "../../stores/auth-store.js";
import "./hallkeeper-room-plans.css";

interface VenueResult {
  readonly venueId: string;
  readonly venue: VenueDetail | null;
  readonly error: string | null;
}

function RoomPhotograph({ room }: { readonly room: HallkeeperRoomPlan }): ReactElement {
  const [failed, setFailed] = useState(false);
  return failed
    ? <span className="hk-room-plans-photo-fallback"><Building2 size={24} aria-hidden="true" /></span>
    : <img src={roomPosterUrl(room.slug)} alt="" loading="lazy" onError={() => { setFailed(true); }} />;
}

/** Protected by the router; the current venue is also checked before choosing references. */
export function HallkeeperRoomPlansPage(): ReactElement {
  const venueId = useAuthStore((state) => state.user?.venueId ?? null);
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<VenueResult | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (venueId === null) return;
    let current = true;
    setResult(null);
    void getVenue(venueId).then((venue) => {
      if (!current) return;
      if (venue.id !== venueId) {
        setResult({ venueId, venue: null, error: "The venue reference could not be verified." });
        return;
      }
      setResult({ venueId, venue, error: null });
    }).catch((error: unknown) => {
      if (current) setResult({ venueId, venue: null, error: error instanceof Error ? error.message : "The venue reference could not be loaded." });
    });
    return () => { current = false; };
  }, [venueId, retry]);

  const currentResult = result?.venueId === venueId ? result : null;
  const verified = currentResult?.venue?.slug === HALLKEEPER_PLAN_VENUE_SLUG;
  const selected = getHallkeeperRoomPlan(params.get("room")) ?? HALLKEEPER_ROOM_PLANS[0];
  const selectRoom = (slug: string): void => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("room", slug);
      return next;
    });
  };

  return (
    <DashboardLayout mainLabel="Room reference plans">
      <div className="hk-room-plans">
        <header className="hk-room-plans-header">
          <div>
            <p className="hk-room-plans-eyebrow">The hallkeeper’s reference library</p>
            <h1>Room plans</h1>
            <p className="hk-room-plans-intro">The shape of the room, close to hand.</p>
          </div>
          <Link className="hk-room-plans-back" to="/hallkeeper"><ArrowLeft size={17} aria-hidden="true" /> Back to the working day</Link>
        </header>

        {venueId === null ? <p className="hk-room-plans-notice">No venue is linked to this account.</p>
          : currentResult === null ? <ActivityStatus variant="panel">Loading venue references…</ActivityStatus>
          : currentResult.error !== null ? (
            <div className="hk-room-plans-notice" role="alert"><p>{currentResult.error}</p>
              <button type="button" onClick={() => { setRetry((value) => value + 1); }}>Try again</button></div>
          ) : !verified ? <p className="hk-room-plans-notice">No supplied room references are available for this venue.</p>
          : selected === undefined ? null : (
            <div className="hk-room-plans-workspace">
              <aside className="hk-room-plans-rail" aria-label="Choose a room">
                <p className="hk-room-plans-rail-heading">Trades Hall <span>Six room references</span></p>
                <div className="hk-room-plans-room-list">
                  {HALLKEEPER_ROOM_PLANS.map((room) => (
                    <button key={room.slug} type="button" aria-pressed={selected.slug === room.slug}
                      onClick={() => { selectRoom(room.slug); }}>
                      <RoomPhotograph room={room} /><span>{room.name}</span>
                    </button>
                  ))}
                </div>
              </aside>
              <section className="hk-room-plans-selected" aria-label={`${selected.name} reference`}>
                <div className="hk-room-plans-room-heading">
                  <p>Room reference</p><h2>{selected.name}</h2>
                </div>
                <RoomPlanReference room={selected} />
              </section>
            </div>
          )}
      </div>
    </DashboardLayout>
  );
}

export default HallkeeperRoomPlansPage;
