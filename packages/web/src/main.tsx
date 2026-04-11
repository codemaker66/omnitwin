import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router.js";
import { ClerkAuthBridge } from "./components/auth/ClerkAuthBridge.js";

// ---------------------------------------------------------------------------
// AppRoot — Clerk provider wraps the entire app
// ---------------------------------------------------------------------------

const CLERK_KEY = import.meta.env["VITE_CLERK_PUBLISHABLE_KEY"] as string | undefined;

function AppRoot(): React.ReactElement {
  return (
    <ClerkProvider publishableKey={CLERK_KEY ?? ""} afterSignOutUrl="/editor">
      <ClerkAuthBridge />
      <RouterProvider router={router} />
    </ClerkProvider>
  );
}

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
