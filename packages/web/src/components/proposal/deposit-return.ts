// ---------------------------------------------------------------------------
// The way back from Stripe's payment page (Plan 19 L5). Before the client
// leaves for Stripe, their share token is kept in this tab's session storage,
// so Stripe is given an address without it; the return page reads it back
// once, and it is gone. Storage that refuses (a private window) leaves the
// return page to say where to look instead.
// ---------------------------------------------------------------------------

const KEY = "venviewer.deposit-return.token";
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,96}$/u;

/** Keeps the client's token for this tab's return from Stripe. */
export function keepDepositReturnToken(token: string): void {
  try {
    window.sessionStorage.setItem(KEY, token);
  } catch {
    // Storage refused: the return page explains where the proposal is.
  }
}

/** The token kept for this tab, once; null when there is none (or it is not a token). */
export function takeDepositReturnToken(): string | null {
  try {
    const token = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return token !== null && TOKEN_SHAPE.test(token) ? token : null;
  } catch {
    return null;
  }
}
