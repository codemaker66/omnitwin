import { create } from "zustand";
import type { LiveParticipant } from "@omnitwin/types";
import { EMPTY_OVERLAY, type RemoteOverlay } from "../lib/layout-live/live-document.js";

// ---------------------------------------------------------------------------
// Live co-editing v1 — what the planner shows about other people: who is in
// this layout, which room each is viewing, the remote overlay the scene draws
// on top of the local document, and the one brief notice when someone else's
// change lands on what this person is touching. Written only by the live
// client (lib/layout-live/live-client.ts). Display only — nothing here is
// ever saved.
// ---------------------------------------------------------------------------

/**
 * - off: no live room for this layout (signed out, a public draft, a client).
 * - connecting: the socket is opening; nothing is shown yet. A person the
 *   server does not admit stays here forever and sees nothing new.
 * - live: in the room.
 * - reconnecting: was in the room and lost it; resyncs on return.
 */
export type LayoutLiveStatus = "off" | "connecting" | "live" | "reconnecting";

export interface LayoutLiveNotice {
  readonly id: number;
  readonly text: string;
}

interface LayoutLiveState {
  readonly status: LayoutLiveStatus;
  readonly connectionId: string | null;
  readonly participants: readonly LiveParticipant[];
  readonly overlay: RemoteOverlay;
  readonly notice: LayoutLiveNotice | null;
}

interface LayoutLiveActions {
  readonly showNotice: (text: string) => void;
  readonly dismissNotice: (id: number) => void;
  readonly resetLive: () => void;
}

const INITIAL: LayoutLiveState = {
  status: "off",
  connectionId: null,
  participants: [],
  overlay: EMPTY_OVERLAY,
  notice: null,
};

let noticeCounter = 0;

export const useLayoutLiveStore = create<LayoutLiveState & LayoutLiveActions>((set, get) => ({
  ...INITIAL,
  showNotice: (text) => {
    noticeCounter += 1;
    set({ notice: { id: noticeCounter, text } });
  },
  dismissNotice: (id) => {
    if (get().notice?.id === id) set({ notice: null });
  },
  resetLive: () => { set(INITIAL); },
}));

/** Everyone in the room except this connection. */
export function selectOthers(state: LayoutLiveState): readonly LiveParticipant[] {
  return state.participants.filter((participant) => participant.connectionId !== state.connectionId);
}
