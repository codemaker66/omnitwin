import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ApiError } from "../../../api/client.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { setLayoutTimelineMutationLock } from "../../../lib/layout-timeline-preview-lock.js";
import {
  planDrawingSignature,
  useVisitorPlanPdf,
  visitorPlanFilename,
} from "../../../hooks/use-visitor-plan-pdf.js";
import { VisitorPlanPdfActions } from "../VisitorPlanPdfActions.js";

// ---------------------------------------------------------------------------
// The visitor's plan as a PDF (fix-first item 11): save first, then fetch,
// then hand the file over. Only the network and the autosave flush are
// mocked; the hook, the component and the editor store are real.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({ fetchPdf: vi.fn(), flush: vi.fn() }));
vi.mock("../../../api/visitor-plan.js", () => ({ fetchVisitorPlanPdf: mocks.fetchPdf }));
vi.mock("../EditorBridge.js", () => ({ flushAutoSave: mocks.flush }));

const CONFIG_ID = "11111111-1111-4111-8111-111111111111";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function Harness({ configId = CONFIG_ID }: { readonly configId?: string | null }): React.ReactElement {
  const pdf = useVisitorPlanPdf(configId, "Grand Hall");
  return <VisitorPlanPdfActions pdf={pdf} tone="sheet" unavailableReason={null} />;
}

const pdfBlob = (): Blob => new Blob(["%PDF-1.3 visitor plan"], { type: "application/pdf" });

let createUrl: MockInstance<typeof URL.createObjectURL>;
let revokeUrl: MockInstance<typeof URL.revokeObjectURL>;

beforeEach(() => {
  mocks.fetchPdf.mockReset();
  mocks.flush.mockReset();
  mocks.flush.mockResolvedValue(true);
  useEditorStore.getState().reset();
  useEditorStore.setState({ configId: CONFIG_ID, isPublicPreview: true });
  useEditorStore.getState().addObject("test-chair", 0, 0, 0);
  setLayoutTimelineMutationLock(false);
  createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:visitor-plan-1");
  revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  createUrl.mockRestore();
  revokeUrl.mockRestore();
  Reflect.deleteProperty(navigator, "canShare");
  Reflect.deleteProperty(navigator, "share");
  setLayoutTimelineMutationLock(false);
  useEditorStore.getState().reset();
});

describe("visitor plan PDF hand-off", () => {
  it("states the consequence before the action: saved first, nothing emailed", () => {
    render(<Harness />);
    expect(screen.getByTestId("visitor-pdf-prepare").textContent).toBe("Prepare the PDF");
    expect(screen.getByTestId("visitor-pdf-consequence").textContent)
      .toBe("Saves your latest change, then makes the PDF. Nothing is emailed. The file stays on this device until you send it.");
  });

  it("saves, then shows the shared Activity while preparing, then offers the file", async () => {
    const response = deferred<Blob>();
    mocks.fetchPdf.mockReturnValue(response.promise);
    render(<Harness />);

    fireEvent.click(screen.getByTestId("visitor-pdf-prepare"));
    const button = await screen.findByRole("button", { name: /Preparing the PDF/u });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.querySelector("[data-activity-indicator='particles']")).not.toBeNull();
    await waitFor(() => { expect(mocks.fetchPdf).toHaveBeenCalledTimes(1); });
    expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(mocks.fetchPdf.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.fetchPdf.mock.calls[0]?.[0]).toBe(CONFIG_ID);

    await act(async () => { response.resolve(pdfBlob()); await response.promise; });

    expect(screen.queryByTestId("visitor-pdf-prepare")).toBeNull();
    expect(document.querySelector("[data-activity-indicator='particles']")).toBeNull();
    expect(screen.getByTestId("visitor-pdf-file").textContent).toMatch(/^Grand Hall plan\.pdf · 1 KB · made \d{2}:\d{2}$/u);
    const download = screen.getByTestId("visitor-pdf-download");
    expect(download.getAttribute("href")).toBe("blob:visitor-plan-1");
    expect(download.getAttribute("download")).toBe("Grand Hall plan.pdf");
    expect(screen.getByRole("status").textContent).toBe("PDF ready: Grand Hall plan.pdf");
  });

  it("refuses to make an out-of-date PDF when the latest change has not saved", async () => {
    mocks.flush.mockResolvedValue(false);
    render(<Harness />);
    fireEvent.click(screen.getByTestId("visitor-pdf-prepare"));
    expect((await screen.findByTestId("visitor-pdf-error")).textContent).toMatch(/latest change hasn't saved/u);
    expect(mocks.fetchPdf).not.toHaveBeenCalled();
    expect(screen.getByTestId("visitor-pdf-prepare").textContent).toBe("Try again");
  });

  it("says plainly when the plan is no longer stored, and how to go on", async () => {
    mocks.fetchPdf.mockRejectedValue(new ApiError(404, "The plan PDF could not be prepared.", "NOT_FOUND"));
    render(<Harness />);
    fireEvent.click(screen.getByTestId("visitor-pdf-prepare"));
    expect((await screen.findByTestId("visitor-pdf-error")).textContent)
      .toBe("This plan isn't stored any more, so there is nothing to put in a PDF. Reload the page to start a new plan.");
  });

  it("offers a retry and the events team after a network failure, and recovers", async () => {
    mocks.fetchPdf.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(pdfBlob());
    render(<Harness />);
    fireEvent.click(screen.getByTestId("visitor-pdf-prepare"));
    expect((await screen.findByTestId("visitor-pdf-error")).textContent)
      .toBe("The PDF couldn't be prepared. Check the connection and try again, or use Send to Events Team.");
    fireEvent.click(screen.getByTestId("visitor-pdf-prepare"));
    expect(await screen.findByTestId("visitor-pdf-download")).toBeTruthy();
    expect(screen.queryByTestId("visitor-pdf-error")).toBeNull();
  });

  it("withdraws the file when the plan changes after it was made", async () => {
    mocks.fetchPdf.mockResolvedValue(pdfBlob());
    render(<Harness />);
    fireEvent.click(screen.getByTestId("visitor-pdf-prepare"));
    await screen.findByTestId("visitor-pdf-download");

    act(() => { useEditorStore.getState().addObject("test-table", 2, 0, 1); });

    expect(screen.getByTestId("visitor-pdf-stale").textContent).toBe("The plan has changed since this PDF was made.");
    expect(screen.queryByTestId("visitor-pdf-download")).toBeNull();
    expect(screen.getByTestId("visitor-pdf-prepare").textContent).toBe("Prepare it again");
  });

  it("will not prepare during a room timeline preview", async () => {
    setLayoutTimelineMutationLock(true);
    render(<Harness />);
    fireEvent.click(screen.getByTestId("visitor-pdf-prepare"));
    expect((await screen.findByTestId("visitor-pdf-error")).textContent).toBe("Exit the room timeline preview, then prepare the PDF.");
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(mocks.fetchPdf).not.toHaveBeenCalled();
  });

  it("hands the file to the phone's share sheet when the browser can share files", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    mocks.fetchPdf.mockResolvedValue(pdfBlob());
    render(<Harness />);
    fireEvent.click(screen.getByTestId("visitor-pdf-prepare"));
    fireEvent.click(await screen.findByTestId("visitor-pdf-share"));

    expect(share).toHaveBeenCalledTimes(1);
    const data = share.mock.calls[0]?.[0] as ShareData;
    expect(data.title).toBe("Grand Hall plan");
    expect(data.files?.[0]?.name).toBe("Grand Hall plan.pdf");
    expect(data.files?.[0]?.type).toBe("application/pdf");
    expect(data.url).toBeUndefined();
  });

  it("treats closing the share sheet as a choice, not a failure", async () => {
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", {
      value: vi.fn().mockRejectedValue(new DOMException("Share canceled", "AbortError")),
      configurable: true,
    });
    mocks.fetchPdf.mockResolvedValue(pdfBlob());
    render(<Harness />);
    fireEvent.click(screen.getByTestId("visitor-pdf-prepare"));
    const shareButton = await screen.findByTestId("visitor-pdf-share");
    await act(async () => { fireEvent.click(shareButton); await Promise.resolve(); });
    expect(screen.queryByTestId("visitor-pdf-share-note")).toBeNull();
  });

  it("points to Download when the share sheet fails to open", async () => {
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", {
      value: vi.fn().mockRejectedValue(new DOMException("Not allowed", "NotAllowedError")),
      configurable: true,
    });
    mocks.fetchPdf.mockResolvedValue(pdfBlob());
    render(<Harness />);
    fireEvent.click(screen.getByTestId("visitor-pdf-prepare"));
    fireEvent.click(await screen.findByTestId("visitor-pdf-share"));
    expect((await screen.findByTestId("visitor-pdf-share-note")).textContent)
      .toBe("Sending didn't start. Use Download, then attach the PDF to your message.");
    expect(screen.getByTestId("visitor-pdf-download")).toBeTruthy();
  });

  it("offers only Download where files cannot be shared", async () => {
    mocks.fetchPdf.mockResolvedValue(pdfBlob());
    render(<Harness />);
    fireEvent.click(screen.getByTestId("visitor-pdf-prepare"));
    await screen.findByTestId("visitor-pdf-download");
    expect(screen.queryByTestId("visitor-pdf-share")).toBeNull();
  });

  it("stops the request and frees the file when the plan is left", async () => {
    const response = deferred<Blob>();
    mocks.fetchPdf.mockReturnValue(response.promise);
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByTestId("visitor-pdf-prepare"));
    await waitFor(() => { expect(mocks.fetchPdf).toHaveBeenCalledTimes(1); });
    const signal = mocks.fetchPdf.mock.calls[0]?.[1] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);

    mocks.fetchPdf.mockResolvedValue(pdfBlob());
    const second = render(<Harness />);
    fireEvent.click(screen.getByTestId("visitor-pdf-prepare"));
    await screen.findByTestId("visitor-pdf-download");
    second.unmount();
    expect(revokeUrl).toHaveBeenCalledWith("blob:visitor-plan-1");
  });
});

describe("visitor plan PDF helpers", () => {
  it("names the file as the API does", () => {
    expect(visitorPlanFilename("Grand Hall")).toBe("Grand Hall plan.pdf");
    expect(visitorPlanFilename("Saloon \"East\"")).toBe("Saloon East plan.pdf");
    expect(visitorPlanFilename("")).toBe("Room plan.pdf");
  });

  it("ignores what the PDF does not draw when deciding staleness", () => {
    useEditorStore.getState().addObject("test-table", 1, 0, 2);
    const before = useEditorStore.getState().objects;
    const relabelled = before.map((object) => ({ ...object, id: `${object.id}-stored`, label: "Top table" }));
    expect(planDrawingSignature(relabelled)).toBe(planDrawingSignature(before));
    const moved = before.map((object, index) => (index === 0 ? { ...object, positionX: object.positionX + 1 } : object));
    expect(planDrawingSignature(moved)).not.toBe(planDrawingSignature(before));
  });
});
