import { ClerkProvider } from "@clerk/react";
import type { ReactElement, ReactNode } from "react";
import { ClerkAuthBridge } from "./ClerkAuthBridge.js";
import { isE2EAuthBypassEnabled } from "../../lib/e2e-auth-bypass.js";
import { VENVIEWER_CLERK_APPEARANCE } from "./clerk-appearance.js";
import { VENVIEWER_CLERK_LOCALIZATION } from "./clerk-localization.js";

interface ClerkRouteProviderProps {
  readonly children: ReactNode;
}

declare const __VENVIEWER_CLERK_PUBLISHABLE_KEY__: string | undefined;

function injectedClerkPublishableKey(): string | undefined {
  if (typeof __VENVIEWER_CLERK_PUBLISHABLE_KEY__ === "string") {
    const trimmed = __VENVIEWER_CLERK_PUBLISHABLE_KEY__.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function clerkPublishableKey(): string {
  const key = injectedClerkPublishableKey() ?? import.meta.env["VITE_CLERK_PUBLISHABLE_KEY"];
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
      appearance={VENVIEWER_CLERK_APPEARANCE}
      localization={VENVIEWER_CLERK_LOCALIZATION}
    >
      <ClerkAuthBridge />
      {children}
    </ClerkProvider>
  );
}
