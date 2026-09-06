import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileUploader } from "../FileUploader.js";
import { ConfirmModal } from "../ConfirmModal.js";
import { uploadFile, type UploadProgress } from "../../../api/uploads.js";

vi.mock("../../../api/uploads.js", () => ({ uploadFile: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("shared operation feedback", () => {
  it("tracks upload bytes and removes activity when the request succeeds", async () => {
    let finish: ((result: { fileId: string; publicUrl: string | null }) => void) | undefined;
    let report: ((progress: UploadProgress) => void) | undefined;
    vi.mocked(uploadFile).mockImplementation((_file, _context, _id, onProgress) => {
      report = onProgress;
      return new Promise((resolve) => { finish = resolve; });
    });
    const onUploaded = vi.fn();
    const { container } = render(<FileUploader context="venue" contextId="venue-1" onUploaded={onUploaded} />);
    const input = container.querySelector("input");
    if (input === null) throw new Error("Upload input missing");
    fireEvent.change(input, { target: { files: [new File(["image"], "hall.jpg", { type: "image/jpeg" })] } });
    expect(screen.getByRole("status").textContent).toBe("Uploading 0%");
    act(() => { report?.({ loaded: 3, total: 5, percent: 60 }); });
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("60");
    await act(async () => { finish?.({ fileId: "photo-1", publicUrl: null }); await Promise.resolve(); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(onUploaded).toHaveBeenCalledWith("photo-1", "hall.jpg");
  });

  it("replaces failed upload motion with an actionable error", async () => {
    vi.mocked(uploadFile).mockRejectedValue(new Error("Connection lost"));
    const { container } = render(<FileUploader context="venue" contextId="venue-1" onUploaded={vi.fn()} />);
    const input = container.querySelector("input");
    if (input === null) throw new Error("Upload input missing");
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["image"], "hall.jpg", { type: "image/jpeg" })] } });
      await Promise.resolve();
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Connection lost");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("marks confirmation work busy and clears the indicator after settling", () => {
    const props = { title: "Confirm change", message: "Apply this change?", onConfirm: vi.fn(), onCancel: vi.fn() };
    const { rerender } = render(<ConfirmModal {...props} inFlight />);
    const working = screen.getByRole("button", { name: "Working..." });
    expect(working.getAttribute("aria-busy")).toBe("true");
    expect(working.querySelector("[data-activity-indicator]")).not.toBeNull();
    rerender(<ConfirmModal {...props} />);
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm.getAttribute("aria-busy")).toBe("false");
    expect(confirm.querySelector("[data-activity-indicator]")).toBeNull();
  });
});
