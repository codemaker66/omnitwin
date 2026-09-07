import { useState, type CSSProperties, type ReactElement } from "react";
import { Download, ExternalLink } from "lucide-react";
import type { HallkeeperRoomPlan } from "../../data/hallkeeper-room-plans.js";
import { ActivityStatus } from "../shared/Activity.js";
import "./RoomPlanReference.css";

interface RoomPlanReferenceProps {
  readonly room: HallkeeperRoomPlan;
  readonly compact?: boolean;
}

/** Caller must establish the venue/room identity before selecting metadata. */
export function RoomPlanReference({ room, compact = false }: RoomPlanReferenceProps): ReactElement {
  return <RoomPlanViewer key={room.slug} room={room} compact={compact} />;
}

function RoomPlanViewer({ room, compact }: RoomPlanReferenceProps): ReactElement {
  const [view, setView] = useState<"cleaned" | "original">(room.cleanedSrc === null ? "original" : "cleaned");
  const src = view === "cleaned" && room.cleanedSrc !== null ? room.cleanedSrc : room.originalSrc;
  return (
    <div className={`hk-room-reference${compact === true ? " hk-room-reference--compact" : ""}`}>
      <div className="hk-room-reference-tools">
        <div className="hk-room-reference-switch" role="group" aria-label="Plan version">
          <button type="button" aria-pressed={view === "cleaned"} disabled={room.cleanedSrc === null}
            title={room.cleanedSrc === null ? "A cleaned reference is not available for this room." : undefined}
            onClick={() => { setView("cleaned"); }}>Cleaned</button>
          <button type="button" aria-pressed={view === "original"}
            onClick={() => { setView("original"); }}>Original</button>
        </div>
        <a className="hk-room-reference-download" href={room.originalSrc} download>
          <Download size={16} aria-hidden="true" /> Download original
        </a>
      </div>
      <ReferenceImage key={src} room={room} src={src} original={view === "original"} />
      <div className="hk-room-reference-caption">
        <p>{view === "cleaned" ? "Cleaned reference" : "Supplied reference"} · Source dimensions are annotations, not a scale.</p>
        {room.sourceNote !== undefined && <p>{room.sourceNote}</p>}
        {view === "original" && room.originalCrop !== undefined && (
          <a href={room.originalSrc} target="_blank" rel="noreferrer">View the full combined source <ExternalLink size={13} aria-hidden="true" /></a>
        )}
      </div>
    </div>
  );
}

function ReferenceImage({ room, src, original }: {
  readonly room: HallkeeperRoomPlan;
  readonly src: string;
  readonly original: boolean;
}): ReactElement {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const crop = original ? room.originalCrop : undefined;
  const cropStyle: CSSProperties | undefined = crop === undefined ? undefined : {
    width: `${String(crop.sourceWidth / crop.width * 100)}%`,
    left: `${String(-crop.x / crop.width * 100)}%`,
    top: `${String(-crop.y / crop.height * 100)}%`,
  };
  const plan = <img className={crop === undefined ? "hk-room-reference-image" : "hk-room-reference-cropped-image"}
    src={src} alt={`${room.name} ${original ? "original" : "cleaned"} reference plan${crop === undefined ? "" : ", left-hand room detail"}`}
    style={cropStyle} onLoad={() => { setStatus("ready"); }} onError={() => { setStatus("error"); }} />;
  return (
    <div className="hk-room-reference-paper" data-source-view={original ? "original" : "cleaned"}>
      {status === "loading" && <ActivityStatus className="hk-room-reference-loading">Loading room reference…</ActivityStatus>}
      {status === "error" ? (
        <div className="hk-room-reference-error" role="alert">
          <p>This reference image could not load.</p>
          <a href={room.originalSrc} target="_blank" rel="noreferrer">Open the original source</a>
        </div>
      ) : crop === undefined ? plan : (
        <div className="hk-room-reference-crop" data-testid="room-plan-crop" style={{ aspectRatio: `${String(crop.width)} / ${String(crop.height)}` }}>
          {plan}
        </div>
      )}
    </div>
  );
}
