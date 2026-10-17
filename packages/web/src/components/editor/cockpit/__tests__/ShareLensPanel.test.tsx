import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Mock only the proposal API calls; everything else (stores, model) is real so
// this exercises the genuine layout→draft→chain path.
const mocks = vi.hoisted(() => ({
  createProposal: vi.fn(),
  createProposalVersion: vi.fn(),
  transitionProposal: vi.fn(),
  createProposalShareToken: vi.fn(),
}));
vi.mock("../../../../api/proposals.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../api/proposals.js")>();
  return {
    ...actual,
    createProposal: mocks.createProposal,
    createProposalVersion: mocks.createProposalVersion,
    transitionProposal: mocks.transitionProposal,
    createProposalShareToken: mocks.createProposalShareToken,
  };
});

import { ShareLensPanel } from "../ShareLensPanel.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useShareStore } from "../../../../stores/share-store.js";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { useAuthStore } from "../../../../stores/auth-store.js";

const CONFIG_ID = "11111111-1111-4111-8111-111111111111";

function signInStaff(): void {
  useAuthStore.getState().setUser({ id: "u1", email: "staff@venue.test", role: "owner", platformRole: "none", venueId: "v1", name: "Staff" });
}

beforeEach(() => {
  mocks.createProposal.mockReset();
  mocks.createProposalVersion.mockReset();
  mocks.transitionProposal.mockReset();
  mocks.createProposalShareToken.mockReset();
  usePlacementStore.setState({ placedItems: [] });
  useCockpitStore.getState().reset();
  useShareStore.getState().reset();
  useEditorStore.getState().reset();
  useAuthStore.getState().logout();
});

afterEach(() => { cleanup(); });

describe("ShareLensPanel", () => {
  it("renders a client-safe preview built from the live layout", () => {
    useCockpitStore.getState().setPlannedGuestCount(120);
    render(<ShareLensPanel />);
    expect(screen.getByTestId("share-lens-panel")).toBeTruthy();
    expect(screen.getByText("Share this plan")).toBeTruthy();
    expect(screen.getByTestId("share-layout-summary").textContent).toContain("120");
    expect(screen.getByText(/safety, occupancy, or compliance/i)).toBeTruthy();
  });

  it("gives an anonymous organiser a way to send the plan, never a staff sign-in", () => {
    render(<ShareLensPanel />);
    const panel = screen.getByTestId("share-lens-panel");
    expect(panel.textContent).not.toMatch(/sign in as venue staff/iu);
    expect(screen.queryByTestId("share-precondition")).toBeNull();
    // The proposal chain stays staff-only.
    expect(screen.queryByTestId("share-create")).toBeNull();
    expect(screen.queryByTestId("share-title")).toBeNull();
    expect(screen.queryByTestId("share-message")).toBeNull();
    expect(screen.getByTestId("visitor-share-explainer").textContent)
      .toMatch(/no prices, and says it was drawn by a visitor and not reviewed by the venue/u);
    // Not saved yet: say what happens next instead of offering a dead button.
    expect(screen.getByTestId("visitor-pdf-unavailable").textContent)
      .toBe("Your plan saves as you work. Once it has saved, it can be sent as a PDF.");
    expect(screen.getByTestId("visitor-share-venue").textContent).toMatch(/Send to Events Team/u);
  });

  it("offers a saved guest plan as a PDF, with its consequence stated", () => {
    useEditorStore.setState({ configId: CONFIG_ID, isPublicPreview: true });
    useEditorStore.getState().addObject("test-chair", 0, 0, 0);
    render(<ShareLensPanel />);
    expect(screen.getByTestId("visitor-pdf-prepare").textContent).toBe("Prepare the PDF");
    expect(screen.getByTestId("visitor-pdf-consequence").textContent).toMatch(/Nothing is emailed/u);
    expect(screen.queryByTestId("share-create")).toBeNull();
  });

  it("asks for furniture before a PDF of an empty saved plan", () => {
    useEditorStore.setState({ configId: CONFIG_ID, isPublicPreview: true, objects: [] });
    render(<ShareLensPanel />);
    expect(screen.getByTestId("visitor-pdf-unavailable").textContent).toBe("Place some furniture first; the PDF shows your layout.");
    expect(screen.queryByTestId("visitor-pdf-prepare")).toBeNull();
  });

  it("keeps the proposal chain for a signed-in account's own (claimed) plan", () => {
    useAuthStore.getState().setUser({ id: "u2", email: "client@example.test", role: "client", platformRole: "none", venueId: null, name: "Client" });
    useEditorStore.setState({ configId: CONFIG_ID, isPublicPreview: false });
    render(<ShareLensPanel />);
    expect(screen.queryByTestId("visitor-pdf")).toBeNull();
    expect(screen.getByTestId("share-precondition")).toBeTruthy();
  });

  it("asks to save the layout when signed in without a saved configuration", () => {
    signInStaff();
    render(<ShareLensPanel />);
    expect(screen.getByTestId("share-precondition").textContent).toMatch(/save this layout/i);
    expect(screen.queryByTestId("share-create")).toBeNull();
  });

  it("creates a sendable client share link via the proven proposal chain", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID });
    mocks.createProposal.mockResolvedValue({ id: "p1", title: "Event plan" });
    mocks.createProposalVersion.mockResolvedValue({});
    mocks.transitionProposal.mockResolvedValue({});
    mocks.createProposalShareToken.mockResolvedValue({ token: "tok", shareUrl: "/proposal-share/tok", tokenPrefix: "tok", proposal: {} });

    render(<ShareLensPanel />);
    fireEvent.click(screen.getByTestId("share-create"));

    await waitFor(() => { expect(screen.getByTestId("share-url")).toBeTruthy(); });
    expect(screen.getByTestId("share-url").textContent).toContain("/proposal-share/tok");
    expect(mocks.createProposal).toHaveBeenCalledWith({ venueId: "v1", title: "Event plan", configurationId: CONFIG_ID });
    expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1);
    expect(mocks.transitionProposal).toHaveBeenCalledWith("p1", "sent");
    expect(mocks.createProposalShareToken).toHaveBeenCalledWith("p1");
    expect(useShareStore.getState().lastShareUrl).toContain("/proposal-share/tok");
    // Opening the client's own link would count as the client opening it;
    // the panel offers the preview instead, which stamps nothing.
    expect(screen.queryByTestId("share-open")).toBeNull();
    const preview = screen.getByTestId("share-preview");
    expect(preview.getAttribute("href")).toBe("/proposal-preview/p1");
    expect(preview.getAttribute("target")).toBe("_blank");
    expect(preview.getAttribute("rel")).toContain("noopener");
    expect(preview.getAttribute("href")).not.toContain("/proposal-share/");
    // Nothing was emailed, so nothing says "sent"; and another link is
    // another proposal, which the panel says before it is pressed.
    expect(screen.getByTestId("share-result").textContent).toContain("Link ready. Not emailed; copy it into your message.");
    expect(screen.getByTestId("share-result").textContent).not.toMatch(/sent/iu);
    expect(screen.getByTestId("share-another-hint").textContent).toBe("Another link starts a new proposal. This one stays in Proposals.");
  });

  it("shows a friendly error and does not break when the API fails", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID });
    mocks.createProposal.mockRejectedValue(new Error("network"));

    render(<ShareLensPanel />);
    fireEvent.click(screen.getByTestId("share-create"));

    await waitFor(() => { expect(screen.getByTestId("share-error")).toBeTruthy(); });
    expect(screen.getByTestId("share-error").textContent).toMatch(/couldn't create the share link/i);
    expect(screen.queryByTestId("share-url")).toBeNull();
  });
});
