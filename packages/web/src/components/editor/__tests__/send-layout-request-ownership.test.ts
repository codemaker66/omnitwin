import { Scene } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchSaveResponse } from "../../../api/configurations.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { prepareLayoutForGuestEnquiry } from "../send-layout-flow.js";

vi.mock("../../../api/configurations.js", () => ({
  getPublicConfig: vi.fn(), publicBatchSave: vi.fn(), updatePublicThumbnail: vi.fn(),
  parseRevisionConflict: vi.fn(() => null),
}));
vi.mock("../../../api/spaces.js", () => ({ getSpace: vi.fn() }));
vi.mock("../../../lib/ortho-capture.js", () => ({ captureOrthographic: vi.fn() }));
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
  captureApi.captureOrthographic.mockReturnValue("data:image/png;base64,layout-A");
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
      return "data:image/png;base64,old-layout";
    });
    expect(await prepareLayoutForGuestEnquiry("A")).toBe(false);
    expect(configApi.updatePublicThumbnail).not.toHaveBeenCalled();
  });

  it("keeps thumbnail failure best-effort for the same saved session", async () => {
    await open("A");
    configApi.updatePublicThumbnail.mockRejectedValueOnce(new Error("thumbnail unavailable"));
    expect(await prepareLayoutForGuestEnquiry("A")).toBe(true);
  });
});
