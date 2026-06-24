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
  useEditorStore.setState({ configId: null });
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

  it("blocks share creation until staff sign-in", () => {
    render(<ShareLensPanel />);
    expect(screen.getByTestId("share-precondition").textContent).toMatch(/sign in as venue staff/i);
    expect(screen.queryByTestId("share-create")).toBeNull();
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
