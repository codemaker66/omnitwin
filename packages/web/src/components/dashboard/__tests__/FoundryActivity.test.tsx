import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReconstructionReleaseFile } from "@omnitwin/types";
import { FoundrySigningControls } from "../foundry/FoundrySigningControls.js";
import { VisualEvidenceBoard } from "../foundry/FoundryReleaseDetail.js";

const { fetchEvidence } = vi.hoisted(() => ({ fetchEvidence: vi.fn() }));
vi.mock("../../../api/reconstruction-foundry.js", () => ({ fetchReconstructionVisualEvidence: fetchEvidence }));

afterEach(cleanup);

describe("Foundry file activity", () => {
  it("shows file reading until its text is available", async () => {
    let resolveText: ((text: string) => void) | undefined;
    const response = new Promise<string>((resolve) => { resolveText = resolve; });
    const onEnvelopeChange = vi.fn();
    const { container } = render(<FoundrySigningControls envelopeJson="" busy={false} error={null}
      onEnvelopeChange={onEnvelopeChange} onDownloadPayload={vi.fn()} onVerifyEnvelope={vi.fn()} />);
    const file = new File(["{}"], "envelope.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => response });
    const input = container.querySelector("input[type='file']");
    if (input === null) throw new Error("Missing file input");
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText("Reading signed envelope…")).toBeDefined();
    await act(async () => { resolveText?.("{}"); await response; });
    expect(onEnvelopeChange).toHaveBeenCalledWith("{}");
    expect(screen.queryByText("Reading signed envelope…")).toBeNull();
  });

  it("stops file activity and reports a read failure", async () => {
    const { container } = render(<FoundrySigningControls envelopeJson="" busy={false} error={null}
      onEnvelopeChange={vi.fn()} onDownloadPayload={vi.fn()} onVerifyEnvelope={vi.fn()} />);
    const file = new File(["{}"], "envelope.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => Promise.reject(new Error("Unreadable file")) });
    const input = container.querySelector("input[type='file']");
    if (input === null) throw new Error("Missing file input");
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByText("Reading signed envelope…")).toBeNull();
  });
});

describe("Foundry image decode activity", () => {
  const files: readonly ReconstructionReleaseFile[] = [{ path: "room/equirect_512.webp", sha256: "a".repeat(64), sizeBytes: 12, mimeType: "image/webp", role: "imagery" }];
  beforeEach(() => {
    fetchEvidence.mockResolvedValue(new Blob(["preview"], { type: "image/webp" }));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:foundry-preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("ends measured decode activity after the displayed image loads", async () => {
    render(<VisualEvidenceBoard releaseId="release-1" files={files} selectedPaths={[]} onSelectAll={vi.fn()} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open complete visual review board" }));
    const preview = await screen.findByRole("img");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    fireEvent.load(preview);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("button", { name: "Bind every displayed preview to this review" }).hasAttribute("disabled")).toBe(false);
  });

  it("ends decode activity and reports an image error", async () => {
    render(<VisualEvidenceBoard releaseId="release-1" files={files} selectedPaths={[]} onSelectAll={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open complete visual review board" }));
    fireEvent.error(await screen.findByRole("img"));
    expect(screen.getByRole("alert").textContent).toContain("Preview image could not be decoded");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("keeps a worker failure terminal when another preview completes late", async () => {
    let rejectFirst: ((reason: Error) => void) | undefined;
    let resolveSecond: ((blob: Blob) => void) | undefined;
    const first = new Promise<Blob>((_resolve, reject) => { rejectFirst = reject; });
    const second = new Promise<Blob>((resolve) => { resolveSecond = resolve; });
    fetchEvidence.mockReset().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const file = files[0];
    if (file === undefined) throw new Error("Missing preview fixture");
    render(<VisualEvidenceBoard releaseId="release-1" files={[file, { ...file, path: "room/second.webp" }]} selectedPaths={[]} onSelectAll={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open complete visual review board" }));
    await waitFor(() => { expect(fetchEvidence).toHaveBeenCalledTimes(2); });
    rejectFirst?.(new Error("First preview failed"));
    expect((await screen.findByRole("alert")).textContent).toContain("First preview failed");
    await act(async () => { resolveSecond?.(new Blob(["late preview"])); await second; });
    expect(screen.getByRole("alert").textContent).toContain("First preview failed");
    expect(screen.getByRole("button", { name: "Open complete visual review board" }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
