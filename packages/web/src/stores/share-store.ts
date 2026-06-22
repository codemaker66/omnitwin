import { create } from "zustand";

// ---------------------------------------------------------------------------
// share-store — editable inputs + last result for the cockpit Share lens.
//
// Holds only the planner's editable handoff fields (event title, optional
// message to the client) plus the most recently created share URL, so they
// survive switching between lenses. The proposal-creation orchestration itself
// (createProposal → version → send → share-token) is a transient async action
// owned by ShareLensPanel; only its successful result is parked here. No money,
// no claims — the draft content is derived live by cockpit-share-model.
// ---------------------------------------------------------------------------

export interface ShareState {
  /** Planner-entered event title; blank → cockpit-share-model uses a default. */
  readonly eventTitle: string;
  /** Optional personal message shown to the client on the share link. */
  readonly clientMessage: string;
  /** Absolute URL of the most recently created client share link, or null. */
  readonly lastShareUrl: string | null;
}

interface ShareActions {
  readonly setEventTitle: (title: string) => void;
  readonly setClientMessage: (message: string) => void;
  readonly setLastShareUrl: (url: string | null) => void;
  readonly reset: () => void;
}

type ShareStore = ShareState & ShareActions;

const INITIAL_STATE: ShareState = {
  eventTitle: "",
  clientMessage: "",
  lastShareUrl: null,
};

export const useShareStore = create<ShareStore>((set) => ({
  ...INITIAL_STATE,
  setEventTitle: (eventTitle) => { set({ eventTitle }); },
  setClientMessage: (clientMessage) => { set({ clientMessage }); },
  setLastShareUrl: (lastShareUrl) => { set({ lastShareUrl }); },
  reset: () => { set({ ...INITIAL_STATE }); },
}));
