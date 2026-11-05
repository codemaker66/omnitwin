import { ApiError } from "../../api/client.js";
import { updatePublicThumbnail } from "../../api/configurations.js";
import { PLAN_THUMBNAIL, captureOrthographic } from "../../lib/ortho-capture.js";
import { isLayoutTimelineMutationLocked } from "../../lib/layout-timeline-preview-lock.js";
import { reportFailure } from "../../observability/failure-reports.js";
import { captureEditorSession, isCurrentEditorSession, useEditorStore } from "../../stores/editor-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { flushAutoSave } from "./EditorBridge.js";

export async function prepareLayoutForGuestEnquiry(configId: string): Promise<boolean> {
  const session = captureEditorSession();
  const canContinue = (): boolean => session.configId === configId
    && isCurrentEditorSession(session) && !isLayoutTimelineMutationLocked();
  // This flow is also callable without either send button. Keep the mutation
  // boundary here so a timeline preview can never be flushed or handed off by
  // invoking the helper directly.
  if (!canContinue()) return false;
  const saved = await flushAutoSave();
  if (!saved || !canContinue()) return false;

  try {
    const { scene, space, isPublicPreview } = useEditorStore.getState();
    // Claimed/authenticated configurations are private working artifacts.
    // Keep thumbnail capture on the public-preview path until private
    // thumbnail storage and visibility rules are explicit.
    if (scene === null || space === null || !isPublicPreview) {
      return canContinue();
    }

    const { width: roomWidthRender, length: roomLengthRender } =
      useRoomDimensionsStore.getState().dimensions;
    if (!canContinue()) return false;
    const dataUrl = await captureOrthographic(scene, roomWidthRender, roomLengthRender, PLAN_THUMBNAIL);
    if (dataUrl === null) {
      // No plan to attach (a blank draw, or none within the API's cap).
      reportFailure("plan-image-failed", { stage: "capture" });
    } else {
      if (!canContinue()) return false;
      await updatePublicThumbnail(configId, dataUrl);
      if (!canContinue()) return false;
    }
  } catch (error) {
    // The API refused the plan or never got it: Sentry hears the status, never the server's words.
    if (error instanceof ApiError) {
      reportFailure("plan-image-failed", { stage: "upload", status: error.status > 0 ? error.status : "network" });
    }
    // Best-effort: capture/upload failure must not block sending an enquiry.
    // A preview lock that appeared across an await is not a capture failure.
    if (!canContinue()) return false;
  }
  return canContinue();
}
