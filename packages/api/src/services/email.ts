import { Resend } from "resend";

// ---------------------------------------------------------------------------
// Email service — sends via Resend, or logs to console in dev mode
// ---------------------------------------------------------------------------

let resendClient: Resend | null = null;

const apiKey = process.env["RESEND_API_KEY"];
if (apiKey !== undefined && apiKey !== "") {
  resendClient = new Resend(apiKey);
}

const emailFrom = process.env["EMAIL_FROM"] ?? "OMNITWIN <notifications@omnitwin.com>";

export interface EmailPayload {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
}

/**
 * Sends an email via Resend. If RESEND_API_KEY is not set, logs to console.
 * Returns true on success (or dev log), false on error.
 */
export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  if (resendClient === null) {
    console.log(`[DEV EMAIL] To: ${payload.to}`);
    console.log(`[DEV EMAIL] Subject: ${payload.subject}`);
    console.log(`[DEV EMAIL] Body: ${payload.html.slice(0, 200)}...`);
    return true;
  }

  try {
    await resendClient.emails.send({
      from: emailFrom,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    });
    return true;
  } catch (err) {
    console.error("[EMAIL ERROR]", err);
    return false;
  }
}

/**
 * Fire-and-forget email — does not block, does not throw.
 */
export function sendEmailAsync(payload: EmailPayload): void {
  setImmediate(() => {
    void sendEmail(payload);
  });
}
