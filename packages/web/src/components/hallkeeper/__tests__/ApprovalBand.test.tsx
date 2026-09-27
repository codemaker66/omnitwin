import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConfigurationReviewStatus } from "@omnitwin/types";
import { ApprovalBand, ApprovalStamp } from "../ApprovalBand.js";

afterEach(cleanup);

describe("the sheet's approval band", () => {
  it("tells a hallkeeper in words not to prepare the room from a rejected sheet, and interrupts to say so", () => {
    const { container } = render(<ApprovalBand status="rejected" />);
    const band = screen.getByRole("alert");
    expect(band.textContent).toBe("RejectedDo not prepare the room from this sheet. The venue rejected this layout.");
    expect(container.querySelector(".hkf-approval-band")?.classList.contains("is-brick")).toBe(true);
  });

  it("marks every other unapproved state in its own words and tone, without interrupting", () => {
    const cases: readonly (readonly [ConfigurationReviewStatus, string, string])[] = [
      ["submitted", "Awaiting approval", "amber"],
      ["under_review", "Under review", "amber"],
      ["changes_requested", "Changes requested", "amber"],
      ["withdrawn", "Withdrawn", "slate"],
      ["draft", "Draft", "slate"],
      ["archived", "Archived", "slate"],
    ];
    for (const [status, label, tone] of cases) {
      const { container, unmount } = render(<ApprovalBand status={status} />);
      const band = screen.getByRole("status");
      expect(band.querySelector("strong")?.textContent).toBe(label);
      expect(band.classList.contains(`is-${tone}`)).toBe(true);
      expect(container.querySelectorAll("[role='alert']")).toHaveLength(0);
      unmount();
    }
  });

  it("shows nothing for an approved sheet, or while the state is unread", () => {
    expect(render(<ApprovalBand status="approved" />).container.innerHTML).toBe("");
    expect(render(<ApprovalBand status={null} />).container.innerHTML).toBe("");
  });
});

describe("the approved sheet's stamp", () => {
  it("names the version, the venue's time and the approver once", () => {
    render(<ApprovalStamp approval={{ version: 3, approvedAt: "2026-04-17T14:30:00.000Z", approverName: "Catherine Tait" }} timeZone="Europe/London" />);
    expect(screen.getByText("Approved v3 · Fri 17 Apr, 15:30 · Catherine Tait")).toBeTruthy();
  });
});
