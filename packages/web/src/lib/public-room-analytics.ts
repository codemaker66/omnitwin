import type { TradesHallRuntimeRoomSlug } from "@omnitwin/types";

export type RoomShowcaseEventName =
  | "room_viewed"
  | "event_type_selected"
  | "request_layout_clicked"
  | "enquiry_clicked"
  | "visual_loaded";

export interface RoomShowcaseEvent {
  readonly name: RoomShowcaseEventName;
  readonly venueSlug: "trades-hall";
  readonly roomSlug: TradesHallRuntimeRoomSlug;
  readonly eventType?: string;
  readonly visualSource?: "runtime" | "fallback";
}

export function recordRoomShowcaseEvent(event: RoomShowcaseEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<RoomShowcaseEvent>("venviewer:room-showcase", { detail: event }));
}
