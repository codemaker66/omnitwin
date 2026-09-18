import { useRef, type ReactElement } from "react";
import { ActivityIndicator } from "../../shared/Activity.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { roomResolveCaption } from "../../../lib/room-resolve-model.js";
import "./RoomResolveCaption.css";

/**
 * Reports real capture progress and preserves terminal failure notices.
 * Working motion ends after the captured sources draw or fail, and pauses
 * in Model view where hidden captures cannot draw. Retained text lets a
 * successful caption fade out without disappearing during the transition.
 */
export function RoomResolveCaption(): ReactElement {
  const resolve = useCockpitStore((s) => s.roomResolve);
  const layerMode = useCockpitStore((s) => s.layerMode);
  const roomName = useEditorStore((s) => s.space?.name ?? null);
  const caption = resolve.phase === "developing" && layerMode === "mesh" ? null
    : roomResolveCaption(resolve.phase, roomName, resolve.loadedChunks, resolve.totalChunks);

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
      {visible && resolve.phase === "developing" && <ActivityIndicator size={24} />}
      {visible ? caption : lastCaptionRef.current}
    </p>
  );
}
