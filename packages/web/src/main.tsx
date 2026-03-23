import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router.js";
import { useAuthStore } from "./stores/auth-store.js";

// ---------------------------------------------------------------------------
// AppRoot — initializes auth before rendering routes
// ---------------------------------------------------------------------------

function AppRoot(): React.ReactElement {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void useAuthStore.getState().initialize().finally(() => {
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Inter', sans-serif", color: "#999", background: "#f5f5f0",
      }}>
        Loading…
      </div>
    );
  }

  return <RouterProvider router={router} />;
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
