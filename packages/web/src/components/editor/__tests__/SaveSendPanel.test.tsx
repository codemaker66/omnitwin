import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveSendPanel } from "../SaveSendPanel.js";
import { useEditorStore } from "../../../stores/editor-store.js";

vi.mock("../send-layout-flow.js", () => ({ prepareLayoutForGuestEnquiry: vi.fn() }));
vi.mock("../GuestEnquiryModal.js", () => ({ GuestEnquiryModal: () => <div data-testid="enquiry-ready" /> }));
vi.mock("../../../hooks/use-media-query.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../hooks/use-media-query.js")>(),
  useIsNarrowViewport: () => false,
  useIsCoarsePointer: () => false,
}));

beforeEach(() => {
  useEditorStore.getState().reset();
  useEditorStore.setState({ configId: "cfg-send", isPublicPreview: true });
  useEditorStore.getState().addObject("test-chair", 0, 0, 0);
});
afterEach(() => { cleanup(); useEditorStore.getState().reset(); });

describe("SaveSendPanel", () => {
  it("offers a guest's draft to the events team", () => {
    render(<SaveSendPanel embedded />);
    expect(screen.getByRole("button", { name: "Send to Events Team" })).toBeTruthy();
  });

  // POST /public/enquiries accepts only a guest's draft (public preview), so the
  // button could only fail for a plan saved to an account; that plan goes to the
  // venue through its review instead (QoL E-01).
  it("is not offered for a plan saved to an account", () => {
    useEditorStore.setState({ isPublicPreview: false });
    render(<SaveSendPanel embedded />);
    expect(screen.queryByRole("button", { name: "Send to Events Team" })).toBeNull();
  });

  it("is not offered before anything is placed", () => {
    useEditorStore.setState({ objects: [] });
    render(<SaveSendPanel embedded />);
    expect(screen.queryByRole("button", { name: "Send to Events Team" })).toBeNull();
  });
});
