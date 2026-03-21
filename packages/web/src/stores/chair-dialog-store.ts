import { create } from "zustand";
import type { ChairCountRequest } from "../components/ChairCountDialog.js";

// ---------------------------------------------------------------------------
// Chair dialog store — manages the "how many chairs?" popup state
// ---------------------------------------------------------------------------

interface ChairDialogState {
  readonly pending: ChairCountRequest | null;
  /** When editing an existing group, the table's placed item ID. Null for new placement. */
  readonly editTableId: string | null;
  readonly showDialog: (request: ChairCountRequest, editTableId?: string) => void;
  readonly clearDialog: () => void;
}

export const useChairDialogStore = create<ChairDialogState>()((set) => ({
  pending: null,
  editTableId: null,

  showDialog: (request: ChairCountRequest, editTableId?: string) => {
    set({ pending: request, editTableId: editTableId ?? null });
  },

  clearDialog: () => {
    set({ pending: null, editTableId: null });
  },
}));
