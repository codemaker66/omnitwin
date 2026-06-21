interface E2EWindow extends Window {
  readonly __OMNITWIN_E2E__?: boolean;
}

export function isE2EAuthBypassEnabled(): boolean {
  const buildAllowsBypass = import.meta.env.DEV || import.meta.env["VITE_ENABLE_E2E_AUTH_BYPASS"] === "true";
  return buildAllowsBypass && (window as E2EWindow).__OMNITWIN_E2E__ === true;
}
