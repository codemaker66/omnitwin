import { useRef, type ReactElement } from "react";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { roomResolveCaption } from "../../../lib/room-resolve-model.js";
import "./RoomResolveCaption.css";

/**
 * The quiet caption of "the room resolves" (CARD A2, 01 §13): visible only
 * while captured chunks are developing, reporting honest arrival progress.
 * No spinner — the room materializing is the progress indicator. The element
 * stays mounted so the exit can fade (Emil: exits are choreography too);
 * the last caption text is retained for the fade-out frame.
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
      {visible ? caption : lastCaptionRef.current}
    </p>
  );
}
