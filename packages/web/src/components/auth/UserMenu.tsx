import { UserButton, SignInButton, SignedIn, SignedOut } from "@clerk/clerk-react";

// ---------------------------------------------------------------------------
// UserMenu — Clerk's UserButton for signed-in users, SignInButton for guests
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  position: "fixed", top: 12, right: 12, zIndex: 100,
};

export function UserMenu(): React.ReactElement {
  return (
    <div style={containerStyle} data-testid="user-menu-trigger">
      <SignedIn>
        {/* `afterSignOutUrl` is configured globally on <ClerkProvider/> in main.tsx */}
        <UserButton />
      </SignedIn>
      <SignedOut>
        <SignInButton mode="modal">
          <button
            type="button"
            style={{
              background: "rgba(255,255,255,0.95)", borderRadius: 8, padding: "6px 12px",
              cursor: "pointer", border: "1px solid #e5e5e5", fontSize: 13,
              fontFamily: "'Inter', sans-serif", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            Sign In
          </button>
        </SignInButton>
      </SignedOut>
    </div>
  );
}
