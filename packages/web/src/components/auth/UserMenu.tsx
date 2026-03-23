import { useState, useRef, useEffect } from "react";
import { useAuthStore } from "../../stores/auth-store.js";

// ---------------------------------------------------------------------------
// UserMenu — top-right dropdown with email, role badge, logout
// ---------------------------------------------------------------------------

const triggerStyle: React.CSSProperties = {
  position: "fixed", top: 12, right: 12, zIndex: 100,
  display: "flex", alignItems: "center", gap: 8,
  background: "rgba(255,255,255,0.95)", borderRadius: 8, padding: "6px 12px",
  cursor: "pointer", border: "1px solid #e5e5e5", fontSize: 13,
  fontFamily: "'Inter', sans-serif", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
};

const badgeStyle: React.CSSProperties = {
  background: "#e0e7ff", color: "#3730a3", borderRadius: 4,
  padding: "2px 6px", fontSize: 11, fontWeight: 600, textTransform: "uppercase",
};

const dropdownStyle: React.CSSProperties = {
  position: "fixed", top: 48, right: 12, zIndex: 101,
  background: "#fff", borderRadius: 8, padding: 4,
  border: "1px solid #e5e5e5", boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
  minWidth: 180, fontFamily: "'Inter', sans-serif",
};

const menuItemStyle: React.CSSProperties = {
  display: "block", width: "100%", padding: "8px 12px", fontSize: 13,
  background: "none", border: "none", cursor: "pointer", textAlign: "left",
  borderRadius: 4, color: "#333",
};

export function UserMenu(): React.ReactElement | null {
  const { user, isAuthenticated, logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => { document.removeEventListener("mousedown", handler); };
  }, []);

  if (!isAuthenticated || user === null) return null;

  return (
    <div ref={ref}>
      <button
        type="button"
        style={triggerStyle}
        onClick={() => { setOpen((p) => !p); }}
        data-testid="user-menu-trigger"
      >
        <span>{user.email}</span>
        <span style={badgeStyle}>{user.role}</span>
      </button>
      {open && (
        <div style={dropdownStyle} data-testid="user-menu-dropdown">
          <div style={{ padding: "8px 12px", fontSize: 12, color: "#999", borderBottom: "1px solid #eee" }}>
            Signed in as <strong>{user.name ?? user.email}</strong>
          </div>
          <button
            type="button"
            style={{ ...menuItemStyle, color: "#dc2626" }}
            onClick={() => { logout(); }}
            data-testid="logout-button"
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
