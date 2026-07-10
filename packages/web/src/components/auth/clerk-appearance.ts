import type { ClerkProviderProps } from "@clerk/react";

type ClerkAppearance = NonNullable<ClerkProviderProps["appearance"]>;

const GOOGLE_SIGN_IN_ENV = "VITE_CLERK_GOOGLE_SIGN_IN_ENABLED";

export function isClerkGoogleSignInEnabled(): boolean {
  return import.meta.env[GOOGLE_SIGN_IN_ENV] === "true";
}

export const VENVIEWER_CLERK_APPEARANCE = {
  variables: {
    colorPrimary: "#dba64b",
    colorBackground: "#08100f",
    colorDanger: "#ff6f59",
    borderRadius: "8px",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  },
  elements: {
    card: {
      width: "100%",
      border: "1px solid rgba(219, 166, 75, 0.28)",
      background: "linear-gradient(180deg, rgba(13, 25, 24, 0.98), rgba(4, 9, 9, 0.98))",
      boxShadow: "none",
    },
    headerTitle: {
      color: "#fff7e8",
      fontWeight: "700",
    },
    headerSubtitle: {
      color: "rgba(246, 239, 224, 0.72)",
    },
    formFieldLabel: {
      color: "rgba(246, 239, 224, 0.82)",
      fontWeight: "700",
    },
    formFieldInput: {
      minHeight: "44px",
      borderColor: "rgba(82, 230, 224, 0.32)",
      background: "rgba(3, 9, 9, 0.88)",
      color: "#fff7e8",
    },
    formButtonPrimary: {
      minHeight: "44px",
      background: "linear-gradient(135deg, #e5c66b, #bd8430)",
      color: "#120e08",
      fontWeight: "800",
      boxShadow: "0 12px 28px rgba(189, 132, 48, 0.22)",
    },
    footer: {
      background: "rgba(255, 255, 255, 0.035)",
      color: "rgba(246, 239, 224, 0.72)",
    },
    footerActionLink: {
      color: "#f4d17b",
      fontWeight: "800",
    },
    dividerText: {
      color: "rgba(246, 239, 224, 0.6)",
    },
    socialButtonsBlockButton: {
      display: isClerkGoogleSignInEnabled() ? "flex" : "none",
      minHeight: "44px",
      border: "1px solid rgba(82, 230, 224, 0.32)",
      borderRadius: "8px",
      background: "linear-gradient(180deg, rgba(7, 19, 19, 0.96), rgba(4, 11, 11, 0.98))",
      color: "#fff7e8",
      boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.05)",
      fontWeight: "800",
    },
    socialButtonsBlockButtonText: {
      color: "#fff7e8",
      fontWeight: "800",
    },
    dividerRow: {
      display: isClerkGoogleSignInEnabled() ? "flex" : "none",
    },
  },
} satisfies ClerkAppearance;
