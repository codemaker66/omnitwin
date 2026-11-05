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
      reportPlanImageFailure(null);
    } else {
      if (!canContinue()) return false;
      await updatePublicThumbnail(configId, dataUrl);
      if (!canContinue()) return false;
    }
  } catch (error) {
    // The API's answer stands whatever the editor did meanwhile, so it is reported first.
    if (error instanceof ApiError) reportPlanImageFailure(error);
    // Best-effort: capture/upload failure must not block sending an enquiry.
    // A preview lock that appeared across an await is not a capture failure.
    if (!canContinue()) return false;
  }
  return canContinue();
}

/**
 * Reports a plan picture that never reached the layout (once per page, tags
 * only): `null` when there was none to send, or the upload's error. Sentry
 * hears the API's status, never its words: "network" when it never answered,
 * "response-shape" when its reply was unreadable (the picture may be stored).
 */
export function reportPlanImageFailure(upload: ApiError | null): void {
  if (upload === null) {
    reportFailure("plan-image-failed", { stage: "capture" });
    return;
  }
  const status = upload.status > 0 ? upload.status : upload.code === "RESPONSE_VALIDATION_ERROR" ? "response-shape" : "network";
  reportFailure("plan-image-failed", { stage: "upload", status });
}
