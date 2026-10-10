import { useRef, type ReactElement } from "react";
import { ActivityIndicator } from "../../shared/Activity.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { hallSurfacesCaption, hallSurfacesLoading, roomResolveCaption } from "../../../lib/room-resolve-model.js";
import { useModelledGrandHall } from "../../grand-hall/hall-space.js";
import { useHallViewStore } from "../../../stores/hall-view-store.js";
import "./RoomResolveCaption.css";

/**
 * Reports real capture progress and preserves terminal failure notices.
 * Working motion ends after the captured sources draw or fail, and pauses
 * in Model view where hidden captures cannot draw. The drawn Grand Hall
 * reports its own surveyed surfaces the same way. Retained text lets a
 * successful caption fade out without disappearing during the transition.
 */
export function RoomResolveCaption(): ReactElement {
  const resolve = useCockpitStore((s) => s.roomResolve);
  const layerMode = useCockpitStore((s) => s.layerMode);
  const roomName = useEditorStore((s) => s.space?.name ?? null);
  // The drawn Grand Hall needs no capture: unless its capture is shown, the
  // caption reports the hall's own surveyed surfaces arriving instead.
  const modelledHall = useModelledGrandHall();
  const surfaces = useHallViewStore((s) => s.surfaces);
  const drawnHall = modelledHall && layerMode !== "splat";
  const caption = drawnHall ? hallSurfacesCaption(surfaces)
    : resolve.phase === "developing" && layerMode === "mesh" ? null
      : roomResolveCaption(resolve.phase, roomName, resolve.loadedChunks, resolve.totalChunks);
  const working = drawnHall ? hallSurfacesLoading(surfaces) : resolve.phase === "developing";

  const lastCaptionRef = useRef("");
  if (caption !== null) lastCaptionRef.current = caption;
  const visible = caption !== null;

  return (
    <p
      className="room-resolve-caption"
      data-testid="room-resolve-caption"
      data-visible={visible}
      role="status"
      aria-live={visible ? "polite" : "off"}
      aria-hidden={!visible}
    >
      {visible && working && <ActivityIndicator size={24} />}
      {visible ? caption : lastCaptionRef.current}
    </p>
  );
}
