import { ClerkProvider } from "@clerk/react";
import type { ReactElement, ReactNode } from "react";
import { ClerkAuthBridge } from "./ClerkAuthBridge.js";

interface ClerkRouteProviderProps {
  readonly children: ReactNode;
}

interface E2EWindow extends Window {
  readonly __OMNITWIN_E2E__?: boolean;
}

function clerkPublishableKey(): string {
  const key = import.meta.env["VITE_CLERK_PUBLISHABLE_KEY"];
  if ((key === undefined || key === "") && import.meta.env.PROD) {
    throw new Error(
      "VITE_CLERK_PUBLISHABLE_KEY is required in production builds. " +
      "Set it in your .env or deployment environment.",
    );
  }
  return key ?? "";
}

export function ClerkRouteProvider({ children }: ClerkRouteProviderProps): ReactElement {
  const e2eEnabled = import.meta.env.DEV && (window as E2EWindow).__OMNITWIN_E2E__ === true;
  if (e2eEnabled) return <>{children}</>;

  return (
    <ClerkProvider publishableKey={clerkPublishableKey()} afterSignOutUrl="/">
      <ClerkAuthBridge />
      {children}
    </ClerkProvider>
  );
}
