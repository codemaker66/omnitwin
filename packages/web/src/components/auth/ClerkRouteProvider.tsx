import { ClerkProvider } from "@clerk/react";
import type { ReactElement, ReactNode } from "react";
import { ClerkAuthBridge } from "./ClerkAuthBridge.js";
import { isE2EAuthBypassEnabled } from "../../lib/e2e-auth-bypass.js";
import { VENVIEWER_CLERK_LOCALIZATION } from "./clerk-localization.js";

interface ClerkRouteProviderProps {
  readonly children: ReactNode;
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
  if (isE2EAuthBypassEnabled()) return <>{children}</>;

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey()}
      afterSignOutUrl="/"
      localization={VENVIEWER_CLERK_LOCALIZATION}
    >
      <ClerkAuthBridge />
      {children}
    </ClerkProvider>
  );
}
