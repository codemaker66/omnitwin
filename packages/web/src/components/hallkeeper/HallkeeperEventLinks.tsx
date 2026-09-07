import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import type { EventDayOpsBoard } from "@omnitwin/types";
import "./HallkeeperEventLinks.css";

export function HallkeeperEventLinks({ board }: { readonly board: EventDayOpsBoard }): ReactElement {
  const pack = board.handoffPack?.pack ?? null;
  return (
    <section className="hallkeeper-event-links" aria-label="Hallkeeper working documents">
      <div>
        <h2>Your working documents</h2>
        <p>{pack === null
          ? "An operations pack has not been linked to this event. Ask the event office to prepare the approved handoff."
          : `Handoff version ${String(pack.version)} · ${pack.sourceLabel}. The setup sheet opens the current sheet for that layout; the handoff retains its compiled version.`}</p>
      </div>
      <nav aria-label="Open hallkeeper documents">
        <Link to="/hallkeeper/today">Day Board</Link>
        {pack !== null && <>
          <Link to={`/hallkeeper/${pack.configId}`}>Open current setup sheet</Link>
          <Link to={`/ops/handoff/${pack.id}`}>Open version {pack.version} handoff</Link>
        </>}
      </nav>
    </section>
  );
}
