import { useEditorStore } from "../../stores/editor-store.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { UserMenu } from "../auth/UserMenu.js";

// ---------------------------------------------------------------------------
// EditorToolbar — top bar with logo, save status, user/sign-in
// ---------------------------------------------------------------------------

const barStyle: React.CSSProperties = {
  position: "fixed", top: 0, left: 0, right: 0, height: 48,
  background: "rgba(255,255,255,0.95)", borderBottom: "1px solid #e5e5e5",
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "0 16px", zIndex: 50,
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  backdropFilter: "blur(8px)",
};

const logoStyle: React.CSSProperties = {
  fontSize: 16, fontWeight: 700, color: "#1a1a2e", letterSpacing: -0.5,
};

const statusStyle: React.CSSProperties = {
  fontSize: 12, color: "#999", display: "flex", alignItems: "center", gap: 6,
};

const signInStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 500, color: "#2563eb", background: "none",
  border: "1px solid #2563eb", borderRadius: 6, padding: "6px 12px",
  cursor: "pointer",
};

interface EditorToolbarProps {
  readonly onSignIn: () => void;
}

export function EditorToolbar({ onSignIn }: EditorToolbarProps): React.ReactElement {
  const isDirty = useEditorStore((s) => s.isDirty);
  const isSaving = useEditorStore((s) => s.isSaving);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  let statusText = "";
  let statusColor = "#999";
  if (isSaving) {
    statusText = "Saving...";
    statusColor = "#f59e0b";
  } else if (isDirty) {
    statusText = "Unsaved changes";
    statusColor = "#ef4444";
  } else if (lastSavedAt !== null) {
    statusText = `Saved ${lastSavedAt.toLocaleTimeString()}`;
    statusColor = "#22c55e";
  }

  return (
    <div style={barStyle}>
      <span style={logoStyle}>OMNITWIN</span>

      <div style={{ ...statusStyle, color: statusColor }}>
        {statusText !== "" && (
          <>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", background: statusColor,
            }} />
            {statusText}
          </>
        )}
      </div>

      <div>
        {isAuthenticated ? (
          <UserMenu />
        ) : (
          <button type="button" style={signInStyle} onClick={onSignIn}>
            Sign In
          </button>
        )}
      </div>
    </div>
  );
}
