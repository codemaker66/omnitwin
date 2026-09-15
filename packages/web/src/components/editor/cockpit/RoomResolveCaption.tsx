import { useRef, type ReactElement } from "react";
import { ActivityIndicator } from "../../shared/Activity.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { roomResolveCaption } from "../../../lib/room-resolve-model.js";
import "./RoomResolveCaption.css";

/**
 * Reports real capture progress and preserves terminal failure notices.
 * Working motion ends when downloads settle. Retained text lets a successful
 * caption fade out without its content disappearing during the transition.
 */
export function RoomResolveCaption(): ReactElement {
  const resolve = useCockpitStore((s) => s.roomResolve);
  const roomName = useEditorStore((s) => s.space?.name ?? null);
  const caption = roomResolveCaption(resolve.phase, roomName, resolve.loadedChunks, resolve.totalChunks);

  const lastCaptionRef = useRef("");
  if (caption !== null) lastCaptionRef.current = caption;
  const visible = caption !== null;

  return (
    <p
      className="room-resolve-caption"
      data-testid="room-resolve-caption"
      data-visible={visible}
      role="status"
      aria-live="polite"
    >
      {resolve.phase === "developing" && <ActivityIndicator size={24} />}
      {visible ? caption : lastCaptionRef.current}
    </p>
  );
}
