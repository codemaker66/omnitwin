import type { DepositPaymentView, DepositRequestView } from "@omnitwin/types";
import { formatMinorAsCurrency } from "../../../lib/money-input.js";
import { venueMoment } from "../enquiries/enquiry-desk-format.js";

// ---------------------------------------------------------------------------
// The deposit on the Proposals desk (Plan 19 L5), in the booker's words.
// ---------------------------------------------------------------------------

const PERCENT_INPUT = /^(\d{1,3})(?:\.(\d{1,2}))?%?$/u;

/** "25", "12.5" or "33.33%" as basis points (2,500; 1,250; 3,333), or null. */
export function parsePercentToBasisPoints(input: string): number | null {
  const match = PERCENT_INPUT.exec(input.trim());
  if (match === null) return null;
  const whole = Number(match[1]);
  const hundredths = Number((match[2] ?? "").padEnd(2, "0"));
  const points = whole * 100 + hundredths;
  return points >= 1 && points <= 10_000 ? points : null;
}

/** The deposit a percentage comes to, as the API figures it: a half penny rounds up. */
export function previewPercent(totalMinor: number, basisPoints: number): number {
  return Math.floor((totalMinor * basisPoints + 5_000) / 10_000);
}

function percentWords(basisPoints: number): string {
  return `${(basisPoints / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;
}

/** "£625.00, 25% of version 1's £2,500.00". */
export function depositAskedWords(request: DepositRequestView): string {
  const amount = formatMinorAsCurrency(request.amountMinor, request.currency);
  const total = formatMinorAsCurrency(request.quoteTotalMinor, request.currency);
  const share = request.basis === "percent" && request.percentBasisPoints !== null ? `${percentWords(request.percentBasisPoints)} of` : "against";
  return `${amount}, ${share} version ${String(request.proposalVersion)}'s ${total}`;
}

function when(iso: string | null): string {
  return iso === null ? "" : ` ${venueMoment(iso) ?? ""}`.trimEnd();
}

/** Where a request stands, said from what Stripe has reported. */
export function depositStateWords(request: DepositRequestView): string {
  const attempt: DepositPaymentView | null = request.payments[0] ?? null;
  const settled = request.payments.find((payment) => payment.state === request.state) ?? attempt;
  switch (request.state) {
    case "paid":
      return `Paid${when(settled?.paidAt ?? null)}.`;
    case "partially_refunded":
      return `Paid${when(settled?.paidAt ?? null)}. ${formatMinorAsCurrency(settled?.amountRefundedMinor ?? 0, request.currency)} refunded in Stripe.`;
    case "refunded":
      return "Paid, then refunded in full in Stripe.";
    case "processing":
      return "Paid by a bank payment that Stripe confirms in a few working days.";
    case "mismatch":
      return `Stripe reported ${formatMinorAsCurrency(settled?.amountReceivedMinor ?? 0, request.currency)} against the ${formatMinorAsCurrency(request.amountMinor, request.currency)} asked for. Check the payment in Stripe before relying on it.`;
    case "cancelled":
      return `Withdrawn${when(request.cancelledAt)}.`;
    case "requested":
      break;
  }
  if (attempt === null) return "Waiting for the client. They have not opened the payment page.";
  switch (attempt.state) {
    case "declined":
      return `The client's last attempt was declined${attempt.failureMessage === null ? "." : `: ${attempt.failureMessage}`}`;
    case "failed":
      return "The client's bank payment failed. They can pay again from their link.";
    case "expired":
      return "The payment page lapsed unpaid. The client can open it again from their link.";
    default:
      return `The client opened the payment page${when(attempt.createdAt)}. Nothing is paid yet.`;
  }
}

/** Whether a request can still be withdrawn: nothing paid or on its way. */
export function depositWithdrawable(request: DepositRequestView): boolean {
  return request.state === "requested";
}
