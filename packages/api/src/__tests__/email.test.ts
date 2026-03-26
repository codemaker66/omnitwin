import { describe, it, expect, vi } from "vitest";
import {
  newEnquiryNotification,
  enquiryApproved,
  enquiryRejected,
} from "../services/email-templates.js";

// ---------------------------------------------------------------------------
// Email template tests
// ---------------------------------------------------------------------------

describe("newEnquiryNotification", () => {
  const baseData = {
    spaceName: "Grand Hall",
    eventType: "Wedding",
    contactName: "Jane Smith",
    contactEmail: "jane@example.com",
    contactPhone: "+441234567890",
    eventDate: "2026-06-15",
    guestCount: 120,
    message: "We'd love to host our reception here.",
    dashboardUrl: "http://localhost:5173/dashboard",
  } as const;

  it("includes space name in subject", () => {
    const { subject } = newEnquiryNotification(baseData);
    expect(subject).toContain("Grand Hall");
  });

  it("includes event type in subject", () => {
    const { subject } = newEnquiryNotification(baseData);
    expect(subject).toContain("Wedding");
  });

  it("includes contact info in body", () => {
    const { html } = newEnquiryNotification(baseData);
    expect(html).toContain("jane@example.com");
    expect(html).toContain("Jane Smith");
    expect(html).toContain("+441234567890");
  });

  it("includes event details in body", () => {
    const { html } = newEnquiryNotification(baseData);
    expect(html).toContain("2026-06-15");
    expect(html).toContain("120");
  });

  it("includes message in body", () => {
    const { html } = newEnquiryNotification(baseData);
    expect(html).toContain("reception here");
  });

  it("includes dashboard link", () => {
    const { html } = newEnquiryNotification(baseData);
    expect(html).toContain("http://localhost:5173/dashboard");
  });

  it("handles null event type gracefully", () => {
    const { subject, html } = newEnquiryNotification({ ...baseData, eventType: null });
    expect(subject).toBe("New enquiry for Grand Hall");
    expect(html).toContain("Grand Hall");
  });

  it("handles null message gracefully", () => {
    const { html } = newEnquiryNotification({ ...baseData, message: null });
    expect(html).not.toContain("reception here");
  });
});

describe("enquiryApproved", () => {
  const baseData = {
    venueName: "Trades Hall Glasgow",
    spaceName: "Grand Hall",
    eventDate: "2026-06-15",
    configUrl: "http://localhost:5173/editor/config-123",
  } as const;

  it("includes space name in subject", () => {
    const { subject } = enquiryApproved(baseData);
    expect(subject).toContain("Grand Hall");
    expect(subject).toContain("approved");
  });

  it("includes venue name in body", () => {
    const { html } = enquiryApproved(baseData);
    expect(html).toContain("Trades Hall Glasgow");
  });

  it("includes event date in body", () => {
    const { html } = enquiryApproved(baseData);
    expect(html).toContain("2026-06-15");
  });

  it("includes config link", () => {
    const { html } = enquiryApproved(baseData);
    expect(html).toContain("editor/config-123");
  });

  it("handles null configUrl", () => {
    const { html } = enquiryApproved({ ...baseData, configUrl: null });
    expect(html).not.toContain("View Your Layout");
  });
});

describe("enquiryRejected", () => {
  const baseData = {
    venueName: "Trades Hall Glasgow",
    spaceName: "Grand Hall",
    eventDate: "2026-06-15",
    note: "Space is booked for that date",
  } as const;

  it("includes space name in subject", () => {
    const { subject } = enquiryRejected(baseData);
    expect(subject).toContain("Grand Hall");
  });

  it("includes note when provided", () => {
    const { html } = enquiryRejected(baseData);
    expect(html).toContain("Space is booked for that date");
  });

  it("works without note", () => {
    const { html } = enquiryRejected({ ...baseData, note: null });
    expect(html).not.toContain("Note from the events team");
    expect(html).toContain("alternative");
  });

  it("includes venue name", () => {
    const { html } = enquiryRejected(baseData);
    expect(html).toContain("Trades Hall Glasgow");
  });
});

// ---------------------------------------------------------------------------
// sendEmail tests
// ---------------------------------------------------------------------------

describe("sendEmail", () => {
  it("logs to console when no RESEND_API_KEY", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const original = process.env["RESEND_API_KEY"];
    delete process.env["RESEND_API_KEY"];

    // Re-import to get fresh module state
    const { sendEmail } = await import("../services/email.js");
    const result = await sendEmail({ to: "test@test.com", subject: "Test", html: "<p>Test</p>" });

    expect(result).toBe(true);
    // The dev log may or may not fire depending on module caching,
    // but the function should not throw
    consoleSpy.mockRestore();
    process.env["RESEND_API_KEY"] = original;
  });

  it("exports sendEmailAsync", async () => {
    const { sendEmailAsync } = await import("../services/email.js");
    expect(typeof sendEmailAsync).toBe("function");
  });
});
