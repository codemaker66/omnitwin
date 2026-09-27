import { createContext, type ComponentType } from "react";

// ---------------------------------------------------------------------------
// <SlotRequests> mount point (owned by Lane 9 — requests and the flashing
// slot). The Day Board reserves the region and supplies the slot's identity;
// the conversation lane supplies the component. Two ways in, so that lane
// does not need a router change to land:
//
//   1. <DayBoardSlotRequestsContext.Provider value={SlotRequests}> anywhere
//      above the board, or
//   2. <DayBoardPage slotRequests={SlotRequests} /> at the route.
//
// The prop wins when both are present. The default is null: the region
// renders nothing at all, so an unmounted lane costs no chrome and no space.
// The contract is deliberately props-only — no callbacks back into the board
// — so a request surface can never drive the board's own refetch loop.
//
// The contract lives in this leaf, not in DayBoardPage.tsx, because the
// provider sits at the app root: importing it from the page made the page,
// and everything the page imports, part of the bundle every visitor loads,
// the public front door included. DayBoardPage.tsx re-exports all three
// names, so the documented import from the page still works.
// ---------------------------------------------------------------------------

export interface SlotRequestsProps {
  readonly bookingId: string;
  readonly eventId: string | null;
  readonly roomId: string;
  readonly roomName: string;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
}

export type SlotRequestsComponent = ComponentType<SlotRequestsProps>;

export const DayBoardSlotRequestsContext = createContext<SlotRequestsComponent | null>(null);
