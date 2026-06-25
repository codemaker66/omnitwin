import { UserButton, SignInButton } from "@clerk/react";
import { useAuthStore } from "../../stores/auth-store.js";
import { VENVIEWER_CLERK_APPEARANCE } from "./clerk-appearance.js";
import "./UserMenu.css";

// ---------------------------------------------------------------------------
// UserMenu — Clerk's UserButton for signed-in users, SignInButton for guests
// ---------------------------------------------------------------------------

export function UserMenu(): React.ReactElement {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  return (
    <div className="user-menu" data-testid="user-menu-trigger">
      {isAuthenticated ? (
        <>
          {/* `afterSignOutUrl` is configured globally on <ClerkProvider/> in main.tsx */}
          <UserButton appearance={VENVIEWER_CLERK_APPEARANCE} />
        </>
      ) : (
        <SignInButton mode="modal">
          <button type="button" className="user-menu__sign-in">
            Sign In
          </button>
        </SignInButton>
      )}
    </div>
  );
}
