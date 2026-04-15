// ---------------------------------------------------------------------------
// Email validation — pragmatic strictness, NOT full RFC 5322
//
// The previous regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` accepted strings like
// `..@..` and `a@b.c..` — close enough to fool a typo check, but loose
// enough that obviously bad inputs slipped through to the API where they
// became silent enquiry-delivery failures.
//
// We do NOT implement true RFC 5322 — no production system does. Instead:
//
//   1. The HTML5 input[type=email] spec regex (the one Chrome/Firefox
//      use) is the floor. Anything a browser accepts via native
//      validation, we accept too.
//   2. Plus: reject leading/trailing/consecutive dots in the local part
//      (RFC 3696 prohibition; common typo class).
//   3. Plus: total length ≤ 254 (RFC 3696), local part ≤ 64 (RFC 5321).
//
// These are the rules that catch the typos a user actually makes
// without rejecting weird-but-valid addresses (`+`, subaddressing, etc).
// ---------------------------------------------------------------------------

// HTML5 spec regex from https://html.spec.whatwg.org/multipage/input.html#email-state-(type=email)
// Verbatim — this is what input type="email" validates against.
const HTML5_EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

const MAX_TOTAL_LENGTH = 254;   // RFC 3696 §3
const MAX_LOCAL_LENGTH = 64;    // RFC 5321 §4.5.3.1.1

export function isValidEmail(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TOTAL_LENGTH) return false;

  // Must contain exactly one "@" and split into non-empty parts.
  const atIndex = trimmed.indexOf("@");
  if (atIndex < 0 || atIndex !== trimmed.lastIndexOf("@")) return false;
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (local.length === 0 || local.length > MAX_LOCAL_LENGTH) return false;
  if (domain.length === 0) return false;

  // Local-part dot rules (RFC 3696):
  //   - no leading dot
  //   - no trailing dot
  //   - no consecutive dots
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;

  // Domain must contain at least one dot (no bare hostnames for human users).
  if (!domain.includes(".")) return false;

  // Defer the rest to the HTML5 spec regex.
  return HTML5_EMAIL_RE.test(trimmed);
}
