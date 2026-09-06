import { type ReactElement } from "react";
import { RoomLayoutTimelineDock } from "./RoomLayoutTimelineDock.js";
import "./CockpitBottom.css";

/** Production bottom dock for browsing immutable room-layout keyframes. */
export function CockpitBottom({ initiallyCollapsed = false }: { readonly initiallyCollapsed?: boolean }): ReactElement {
  return <RoomLayoutTimelineDock initiallyCollapsed={initiallyCollapsed} />;
}
