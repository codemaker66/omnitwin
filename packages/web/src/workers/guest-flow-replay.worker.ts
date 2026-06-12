import {
  GuestFlowReplayArtifactSchema,
  GuestFlowReplayInputSchema,
  runGuestFlowReplayV0,
  type GuestFlowReplayArtifact,
  type GuestFlowReplayInput,
} from "@omnitwin/types";

export interface GuestFlowReplayWorkerRequest {
  readonly id: string;
  readonly input: GuestFlowReplayInput;
}

export type GuestFlowReplayWorkerResponse =
  | { readonly id: string; readonly ok: true; readonly artifact: GuestFlowReplayArtifact }
  | { readonly id: string; readonly ok: false; readonly error: string };

type GuestFlowReplayWorkerScope = typeof self & {
  onmessage: ((event: MessageEvent<GuestFlowReplayWorkerRequest>) => void) | null;
  postMessage: (message: GuestFlowReplayWorkerResponse) => void;
};

const workerScope = self as GuestFlowReplayWorkerScope;

workerScope.onmessage = (event: MessageEvent<GuestFlowReplayWorkerRequest>) => {
  const request = event.data;
  const parsed = GuestFlowReplayInputSchema.safeParse(request.input);
  if (!parsed.success) {
    workerScope.postMessage({
      id: request.id,
      ok: false,
      error: "Guest Flow Replay input failed validation.",
    });
    return;
  }

  try {
    const artifact = GuestFlowReplayArtifactSchema.parse(runGuestFlowReplayV0(parsed.data));
    workerScope.postMessage({ id: request.id, ok: true, artifact });
  } catch {
    workerScope.postMessage({
      id: request.id,
      ok: false,
      error: "Guest Flow Replay worker failed to generate a replay artifact.",
    });
  }
};
