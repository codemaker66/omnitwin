import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LeadProfile } from "../../../api/clients.js";
import { ClientProfile } from "../ClientProfile.js";

// ---------------------------------------------------------------------------
// A client's enquiries name the room the guest chose, never the room an
// enquiry that named none is filed under (roadmap N6).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({ getLeadProfile: vi.fn(), getClientProfile: vi.fn() }));

vi.mock("../../../api/clients.js", () => ({
  getLeadProfile: mocks.getLeadProfile,
  getClientProfile: mocks.getClientProfile,
}));

function lead(enquiries: LeadProfile["enquiries"]): LeadProfile {
  return {
    lead: { id: "lead-1", email: "elaine@example.test", phone: null, name: "Elaine Fraser", convertedToUserId: null, createdAt: "2026-09-20T09:00:00.000Z" },
    enquiries,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ClientProfile enquiries", () => {
  it("names the room a guest chose, and says no room was chosen where they named none", async () => {
    mocks.getLeadProfile.mockResolvedValue(lead([
      { id: "enquiry-1", state: "submitted", eventType: "wedding", preferredDate: "2027-05-14", spaceName: "Grand Hall", roomChosen: false, createdAt: "2026-09-26T09:00:00.000Z" },
      { id: "enquiry-2", state: "approved", eventType: "dinner", preferredDate: null, spaceName: "Saloon", roomChosen: true, createdAt: "2026-09-20T09:00:00.000Z" },
    ]));
    render(<ClientProfile leadId="lead-1" onBack={vi.fn()} onViewEnquiry={vi.fn()} />);
    expect(await screen.findByText("Room not chosen")).toBeDefined();
    expect(screen.getByText("Saloon")).toBeDefined();
    expect(screen.queryByText("Grand Hall")).toBeNull();
  });

  it("reads each enquiry's occasion as words, and one typed as it was typed", async () => {
    mocks.getLeadProfile.mockResolvedValue(lead([
      { id: "enquiry-1", state: "submitted", eventType: "corporate", preferredDate: null, spaceName: "Saloon", roomChosen: true, createdAt: "2026-09-26T09:00:00.000Z" },
      { id: "enquiry-2", state: "approved", eventType: "Burns supper", preferredDate: null, spaceName: "Saloon", roomChosen: true, createdAt: "2026-09-20T09:00:00.000Z" },
    ]));
    render(<ClientProfile leadId="lead-1" onBack={vi.fn()} onViewEnquiry={vi.fn()} />);
    expect(await screen.findByText("Corporate event")).toBeDefined();
    expect(screen.getByText("Burns supper")).toBeDefined();
    expect(screen.queryByText("corporate")).toBeNull();
  });

  it("keeps the room an older API names, which says nothing of the choice", async () => {
    mocks.getLeadProfile.mockResolvedValue(lead([
      { id: "enquiry-3", state: "submitted", eventType: null, preferredDate: null, spaceName: "Grand Hall", createdAt: "2026-09-26T09:00:00.000Z" },
    ]));
    render(<ClientProfile leadId="lead-1" onBack={vi.fn()} onViewEnquiry={vi.fn()} />);
    expect(await screen.findByText("Grand Hall")).toBeDefined();
    expect(screen.queryByText("Room not chosen")).toBeNull();
  });
});
