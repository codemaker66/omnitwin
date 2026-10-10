interface E2EWindow extends Window {
  readonly __OMNITWIN_E2E__?: boolean;
  readonly __OMNITWIN_E2E_LIVE__?: boolean;
}

export function isE2EAuthBypassEnabled(): boolean {
  const buildAllowsBypass = import.meta.env.DEV || import.meta.env["VITE_ENABLE_E2E_AUTH_BYPASS"] === "true";
  return buildAllowsBypass && (window as E2EWindow).__OMNITWIN_E2E__ === true;
}

/**
 * Under the bypass the mocked harness has no socket server, so the live
 * channel stays shut. A harness that runs a REAL API behind the seeded
 * identity (goal 19 S4's three-identity run, where the API accepts the
 * seeded token in test mode) says so with this second flag, and the socket
 * opens as it would for a signed-in person.
 */
export function isE2ELiveSocketEnabled(): boolean {
  return isE2EAuthBypassEnabled() && (window as E2EWindow).__OMNITWIN_E2E_LIVE__ === true;
}
