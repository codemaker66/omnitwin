// -----------------------------------------------------------------------------
// haptics — navigator.vibrate behind a guard. Android only, said aloud (spec
// section 5): iOS Safari has no vibration API, and desktop Chrome honours the
// call on hardware that cannot buzz. A poke is 8 ms, a commit 15 ms. It fails
// silent: an absent or refused vibrate is a false return, never an error, and
// nothing in the stage waits on it.
// -----------------------------------------------------------------------------

/** The poke's tick. */
export const POKE_HAPTIC_MS = 8;
/** The seal strike's firmer tick, for the ceremony. */
export const COMMIT_HAPTIC_MS = 15;

/** The two things the guard reads; `navigator` satisfies it, so do test doubles. */
export interface HapticNavigator {
  readonly userAgent: string;
  readonly vibrate?: (pattern: number) => boolean;
}

export function isAndroidUserAgent(userAgent: string): boolean {
  return /\bAndroid\b/u.test(userAgent);
}

function defaultNavigator(): HapticNavigator | null {
  return typeof navigator === "undefined" ? null : navigator;
}

/**
 * Vibrate for `ms` on an Android device that offers it. Returns whether the
 * call was made and accepted. Zero (the inert and sleeping reactions) is a
 * no-op by design, not an error.
 */
export function vibrate(ms: number, nav: HapticNavigator | null = defaultNavigator()): boolean {
  if (ms <= 0 || nav === null) return false;
  if (!isAndroidUserAgent(nav.userAgent) || nav.vibrate === undefined) return false;
  try {
    return nav.vibrate(Math.round(ms));
  } catch {
    // Some embedders throw instead of returning false (a WebView with the
    // permission stripped). The stage carries on either way.
    return false;
  }
}
