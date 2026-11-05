import { Scene } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../api/client.js";
import type { BatchSaveResponse } from "../../../api/configurations.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { prepareLayoutForGuestEnquiry } from "../send-layout-flow.js";

vi.mock("../../../api/configuration-conflict.js", () => ({ parseRevisionConflict: vi.fn(() => null) }));
vi.mock("../../../api/configurations.js", () => ({
  getPublicConfig: vi.fn(), publicBatchSave: vi.fn(), updatePublicThumbnail: vi.fn(),
}));
vi.mock("../../../api/spaces.js", () => ({ getSpace: vi.fn() }));
vi.mock("../../../lib/ortho-capture.js", () => ({ captureOrthographic: vi.fn(), PLAN_THUMBNAIL: { width: 800, height: 533 } }));
const reports = vi.hoisted(() => ({ reportFailure: vi.fn() }));
vi.mock("../../../observability/failure-reports.js", () => reports);
const configApi = vi.mocked(await import("../../../api/configurations.js"));
const spacesApi = vi.mocked(await import("../../../api/spaces.js"));
const captureApi = vi.mocked(await import("../../../lib/ortho-capture.js"));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function open(id: string): Promise<void> {
  configApi.getPublicConfig.mockResolvedValueOnce({
    id, revision: 1, spaceId: `${id}-room`, venueId: "venue", userId: null,
    name: id, isPublicPreview: true, objects: [],
  });
  await useEditorStore.getState().loadConfiguration(id);
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  useEditorStore.getState().reset();
  useEditorStore.setState({ scene: new Scene() });
  useLayoutTimelinePreviewStore.getState().clear();
  spacesApi.getSpace.mockImplementation((_venue, id) => Promise.resolve({
    id, venueId: "venue", name: id, slug: id, widthM: "10", lengthM: "20", heightM: "6", floorPlanOutline: [],
  }));
  captureApi.captureOrthographic.mockResolvedValue("data:image/png;base64,layout-A");
  configApi.updatePublicThumbnail.mockResolvedValue({
    id: "A", revision: 1, spaceId: "A-room", venueId: "venue", userId: null, name: "A", isPublicPreview: true,
  });
});

describe("save-to-enquiry request ownership", () => {
  it("rejects a configuration that is not the open editor before saving or capturing", async () => {
    await open("B");
    expect(await prepareLayoutForGuestEnquiry("A")).toBe(false);
    expect(configApi.publicBatchSave).not.toHaveBeenCalled();
    expect(captureApi.captureOrthographic).not.toHaveBeenCalled();
    expect(configApi.updatePublicThumbnail).not.toHaveBeenCalled();
  });

  it.each([false, true])("cancels waiting for A's save without flushing or capturing another session (return to A: %s)", async (returnToA) => {
    await open("A");
    const pending = deferred<BatchSaveResponse>();
    configApi.publicBatchSave.mockReturnValueOnce(pending.promise);
    const saving = useEditorStore.getState().saveToServer();
    const preparing = prepareLayoutForGuestEnquiry("A");
    await open("B");
    if (returnToA) await open("A");
    expect(await preparing).toBe(false);
    expect(captureApi.captureOrthographic).not.toHaveBeenCalled();
    expect(configApi.updatePublicThumbnail).not.toHaveBeenCalled();
    pending.resolve({ objects: [], revision: 2 });
    await saving;
  });

  it.each([false, true])("cancels after an outstanding thumbnail upload if its editor session changed (return to A: %s)", async (returnToA) => {
    await open("A");
    const upload = deferred<Awaited<ReturnType<typeof configApi.updatePublicThumbnail>>>();
    const started = deferred<undefined>();
    configApi.updatePublicThumbnail.mockImplementationOnce(() => { started.resolve(undefined); return upload.promise; });
    const preparing = prepareLayoutForGuestEnquiry("A");
    await started.promise;
    expect(configApi.updatePublicThumbnail).toHaveBeenCalledWith("A", "data:image/png;base64,layout-A");
    await open("B");
    if (returnToA) await open("A");
    upload.reject(new Error("thumbnail transport failed"));
    expect(await preparing).toBe(false);
  });

  it("rechecks ownership after capture before uploading an image", async () => {
    await open("A");
    captureApi.captureOrthographic.mockImplementationOnce(() => {
      useEditorStore.getState().reset();
      return Promise.resolve("data:image/png;base64,old-layout");
    });
    expect(await prepareLayoutForGuestEnquiry("A")).toBe(false);
    expect(configApi.updatePublicThumbnail).not.toHaveBeenCalled();
  });

  it("rejects a thumbnail that finishes after an editor session change during GPU readback", async () => {
    await open("A");
    const pending = deferred<string | null>();
    const started = deferred<undefined>();
    captureApi.captureOrthographic.mockImplementationOnce(() => { started.resolve(undefined); return pending.promise; });
    const preparing = prepareLayoutForGuestEnquiry("A");
    await started.promise;
    await open("B");
    pending.resolve("data:image/png;base64,old-layout");
    expect(await preparing).toBe(false);
    expect(configApi.updatePublicThumbnail).not.toHaveBeenCalled();
  });

  it("keeps thumbnail failure best-effort for the same saved session", async () => {
    await open("A");
    configApi.updatePublicThumbnail.mockRejectedValueOnce(new Error("thumbnail unavailable"));
    expect(await prepareLayoutForGuestEnquiry("A")).toBe(true);
  });
});

// Production refused the Grand Hall's plan (an 800×533 PNG over the route's
// cap) and nobody saw it: the send went on and said nothing.
describe("a plan image that did not reach the layout", () => {
  it("is reported by the API's status alone, and the enquiry still goes", async () => {
    await open("A");
    configApi.updatePublicThumbnail.mockRejectedValueOnce(
      new ApiError(400, "Must be a PNG or JPEG data URL whose bytes match its type", "VALIDATION_ERROR"),
    );
    expect(await prepareLayoutForGuestEnquiry("A")).toBe(true);
    expect(reports.reportFailure).toHaveBeenCalledWith("plan-image-failed", { stage: "upload", status: 400 });
  });

  it("is reported as a network failure when the upload never reached the API", async () => {
    await open("A");
    configApi.updatePublicThumbnail.mockRejectedValueOnce(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"));
    expect(await prepareLayoutForGuestEnquiry("A")).toBe(true);
    expect(reports.reportFailure).toHaveBeenCalledWith("plan-image-failed", { stage: "upload", status: "network" });
  });

  it("is reported as an unreadable reply when the API answered in a shape the client cannot read", async () => {
    await open("A");
    configApi.updatePublicThumbnail.mockRejectedValueOnce(
      new ApiError(0, "Server returned an unexpected response shape for POST /public/configurations/A/thumbnail", "RESPONSE_VALIDATION_ERROR"),
    );
    expect(await prepareLayoutForGuestEnquiry("A")).toBe(true);
    expect(reports.reportFailure).toHaveBeenCalledWith("plan-image-failed", { stage: "upload", status: "response-shape" });
  });

  it("is reported when there was no image to attach, and nothing is uploaded", async () => {
    await open("A");
    captureApi.captureOrthographic.mockResolvedValueOnce(null);
    expect(await prepareLayoutForGuestEnquiry("A")).toBe(true);
    expect(configApi.updatePublicThumbnail).not.toHaveBeenCalled();
    expect(reports.reportFailure).toHaveBeenCalledWith("plan-image-failed", { stage: "capture" });
  });

  it("is reported even when the layout changed while the API refused it, and the send stops", async () => {
    await open("A");
    const upload = deferred<Awaited<ReturnType<typeof configApi.updatePublicThumbnail>>>();
    const started = deferred<undefined>();
    configApi.updatePublicThumbnail.mockImplementationOnce(() => { started.resolve(undefined); return upload.promise; });
    const preparing = prepareLayoutForGuestEnquiry("A");
    await started.promise;
    await open("B");
    upload.reject(new ApiError(400, "Must be a PNG or JPEG data URL whose bytes match its type", "VALIDATION_ERROR"));
    expect(await preparing).toBe(false);
    expect(reports.reportFailure).toHaveBeenCalledWith("plan-image-failed", { stage: "upload", status: 400 });
  });

  it("is not reported when the plan arrives", async () => {
    await open("A");
    expect(await prepareLayoutForGuestEnquiry("A")).toBe(true);
    expect(configApi.updatePublicThumbnail).toHaveBeenCalledWith("A", "data:image/png;base64,layout-A");
    expect(reports.reportFailure).not.toHaveBeenCalled();
  });
});
