import { type ReactElement } from "react";
import { RoomLayoutTimelineDock } from "./RoomLayoutTimelineDock.js";
import { ClientEventScheduleDock } from "./ClientEventScheduleDock.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { canReadInternalEventData } from "../../../lib/event-access.js";
import "./CockpitBottom.css";

/** Production bottom dock for browsing immutable room-layout keyframes. */
export function CockpitBottom({ initiallyCollapsed = false }: { readonly initiallyCollapsed?: boolean }): ReactElement {
  const auth = useAuthStore();
  return canReadInternalEventData(auth)
    ? <RoomLayoutTimelineDock initiallyCollapsed={initiallyCollapsed} />
    : <ClientEventScheduleDock initiallyCollapsed={initiallyCollapsed} />;
}
