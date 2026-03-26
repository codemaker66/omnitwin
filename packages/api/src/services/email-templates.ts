// ---------------------------------------------------------------------------
// Email templates — pure functions returning { subject, html }
// ---------------------------------------------------------------------------

const BRAND_NAVY = "#1a1a2e";
const BRAND_BLUE = "#3b82f6";

function layout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
  <tr><td style="background:${BRAND_NAVY};padding:20px 24px;">
    <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">OMNITWIN</span>
    <span style="color:rgba(255,255,255,0.5);font-size:13px;margin-left:12px;">${title}</span>
  </td></tr>
  <tr><td style="padding:24px;">${bodyHtml}</td></tr>
  <tr><td style="padding:16px 24px;border-top:1px solid #eee;font-size:11px;color:#999;">
    Sent by OMNITWIN — Venue Planning Platform
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function row(label: string, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return `<tr><td style="padding:4px 0;color:#999;font-size:13px;width:120px;vertical-align:top;">${label}</td><td style="padding:4px 0;font-size:13px;color:#333;">${value}</td></tr>`;
}

// ---------------------------------------------------------------------------
// New enquiry notification — sent to hallkeeper
// ---------------------------------------------------------------------------

export interface NewEnquiryData {
  readonly spaceName: string;
  readonly eventType: string | null;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly contactPhone: string | null;
  readonly eventDate: string | null;
  readonly guestCount: number | null;
  readonly message: string | null;
  readonly dashboardUrl: string;
}

export function newEnquiryNotification(data: NewEnquiryData): { subject: string; html: string } {
  const subject = data.eventType !== null
    ? `New enquiry for ${data.spaceName} — ${data.eventType}`
    : `New enquiry for ${data.spaceName}`;

  const bodyHtml = `
    <h2 style="margin:0 0 16px;font-size:18px;color:${BRAND_NAVY};">New Enquiry Received</h2>
    <table cellpadding="0" cellspacing="0" style="width:100%;">
      ${row("Contact", data.contactName)}
      ${row("Email", data.contactEmail)}
      ${row("Phone", data.contactPhone)}
      ${row("Space", data.spaceName)}
      ${row("Event type", data.eventType)}
      ${row("Date", data.eventDate)}
      ${row("Guests", data.guestCount !== null ? String(data.guestCount) : null)}
    </table>
    ${data.message !== null && data.message !== "" ? `<div style="margin-top:16px;padding:12px;background:#f9f9f6;border-radius:6px;font-size:13px;color:#555;">${data.message}</div>` : ""}
    <div style="margin-top:20px;">
      <a href="${data.dashboardUrl}" style="display:inline-block;padding:10px 20px;background:${BRAND_BLUE};color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">View in Dashboard</a>
    </div>`;

  return { subject, html: layout("New Enquiry", bodyHtml) };
}

// ---------------------------------------------------------------------------
// Enquiry approved — sent to planner/guest
// ---------------------------------------------------------------------------

export interface EnquiryApprovedData {
  readonly venueName: string;
  readonly spaceName: string;
  readonly eventDate: string | null;
  readonly configUrl: string | null;
}

export function enquiryApproved(data: EnquiryApprovedData): { subject: string; html: string } {
  const subject = `Your enquiry for ${data.spaceName} has been approved`;

  const bodyHtml = `
    <h2 style="margin:0 0 16px;font-size:18px;color:#059669;">Enquiry Approved</h2>
    <p style="font-size:14px;color:#333;line-height:1.5;">
      Great news! Your enquiry for <strong>${data.spaceName}</strong> at <strong>${data.venueName}</strong>
      ${data.eventDate !== null ? ` on <strong>${data.eventDate}</strong>` : ""} has been approved.
    </p>
    <p style="font-size:14px;color:#333;line-height:1.5;">
      The events team will be in touch shortly to confirm final details and arrangements.
    </p>
    ${data.configUrl !== null ? `<div style="margin-top:16px;"><a href="${data.configUrl}" style="display:inline-block;padding:10px 20px;background:${BRAND_BLUE};color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">View Your Layout</a></div>` : ""}`;

  return { subject, html: layout("Approved", bodyHtml) };
}

// ---------------------------------------------------------------------------
// Enquiry rejected — sent to planner/guest
// ---------------------------------------------------------------------------

export interface EnquiryRejectedData {
  readonly venueName: string;
  readonly spaceName: string;
  readonly eventDate: string | null;
  readonly note: string | null;
}

export function enquiryRejected(data: EnquiryRejectedData): { subject: string; html: string } {
  const subject = `Update on your enquiry for ${data.spaceName}`;

  const bodyHtml = `
    <h2 style="margin:0 0 16px;font-size:18px;color:${BRAND_NAVY};">Enquiry Update</h2>
    <p style="font-size:14px;color:#333;line-height:1.5;">
      Thank you for your interest in <strong>${data.spaceName}</strong> at <strong>${data.venueName}</strong>${data.eventDate !== null ? ` on <strong>${data.eventDate}</strong>` : ""}.
      Unfortunately, we're unable to accommodate this particular request at this time.
    </p>
    ${data.note !== null && data.note !== "" ? `<div style="margin:16px 0;padding:12px;background:#fef2f2;border-radius:6px;border-left:3px solid #ef4444;font-size:13px;color:#555;"><strong>Note from the events team:</strong><br>${data.note}</div>` : ""}
    <p style="font-size:14px;color:#333;line-height:1.5;">
      We'd love to help you find an alternative — please don't hesitate to try different dates or explore our other spaces.
    </p>`;

  return { subject, html: layout("Update", bodyHtml) };
}
