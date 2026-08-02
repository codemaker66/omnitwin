import { useCallback, useState } from "react";
import type {
  FreezePhaseLayoutSnapshotBody,
  FreezePhaseLayoutSnapshotParams,
  FreezePhaseLayoutSnapshotResponse,
} from "../api/room-layout-timeline.js";
import { freezePhaseLayoutSnapshot } from "../api/room-layout-timeline.js";
import { ApiError } from "../api/client.js";
import { isLayoutTimelineMutationLocked } from "../lib/layout-timeline-preview-lock.js";

export type FreezePhaseLayoutSnapshotStatus = "idle" | "saving" | "success" | "error";

export interface FreezePhaseLayoutSnapshotState {
  readonly status: FreezePhaseLayoutSnapshotStatus;
  readonly result: FreezePhaseLayoutSnapshotResponse | null;
  readonly error: string | null;
  readonly errorCode: string | null;
}

const INITIAL_STATE: FreezePhaseLayoutSnapshotState = {
  status: "idle",
  result: null,
  error: null,
  errorCode: null,
};

export interface UseFreezePhaseLayoutSnapshotResult extends FreezePhaseLayoutSnapshotState {
  readonly freeze: (
    params: FreezePhaseLayoutSnapshotParams,
    body: FreezePhaseLayoutSnapshotBody,
  ) => Promise<FreezePhaseLayoutSnapshotResponse | null>;
}

export function useFreezePhaseLayoutSnapshot(): UseFreezePhaseLayoutSnapshotResult {
  const [state, setState] = useState<FreezePhaseLayoutSnapshotState>(INITIAL_STATE);

  const freeze = useCallback(async (
    params: FreezePhaseLayoutSnapshotParams,
    body: FreezePhaseLayoutSnapshotBody,
  ): Promise<FreezePhaseLayoutSnapshotResponse | null> => {
    if (isLayoutTimelineMutationLocked()) return null;
    setState({ status: "saving", result: null, error: null, errorCode: null });
    try {
      const result = await freezePhaseLayoutSnapshot(params, body);
      setState({ status: "success", result, error: null, errorCode: null });
      return result;
    } catch (error) {
      const message = error instanceof ApiError
        ? error.message
        : "The saved plan could not be frozen for this phase.";
      const errorCode = error instanceof ApiError ? error.code : "UNKNOWN";
      setState({ status: "error", result: null, error: message, errorCode });
      return null;
    }
  }, []);

  return { ...state, freeze };
}
