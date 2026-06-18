import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, ExternalLink, RefreshCw } from "lucide-react";
import type { Notification } from "@omnitwin/types";
import { listNotifications, markNotificationRead } from "../../api/notifications.js";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly notifications: readonly Notification[] }
  | { readonly kind: "error" };

const shellStyle: CSSProperties = {
  position: "relative",
};

const triggerStyle: CSSProperties = {
  alignItems: "center",
  background: "rgba(143,216,210,0.1)",
  border: "1px solid rgba(143,216,210,0.28)",
  borderRadius: 8,
  color: "#eaf9f6",
  cursor: "pointer",
  display: "inline-flex",
  gap: 8,
  fontWeight: 850,
  minHeight: 38,
  padding: "0 12px",
};

const badgeStyle: CSSProperties = {
  alignItems: "center",
  background: "#d7b56d",
  borderRadius: 999,
  color: "#15110c",
  display: "inline-flex",
  fontSize: 11,
  fontWeight: 900,
  justifyContent: "center",
  minWidth: 22,
  padding: "3px 7px",
};

const panelStyle: CSSProperties = {
  background: "linear-gradient(180deg, rgba(15,23,24,0.98), rgba(8,10,10,0.98))",
  border: "1px solid rgba(215,181,109,0.3)",
  borderRadius: 8,
  boxShadow: "0 24px 70px rgba(0,0,0,0.42)",
  color: "#f6f1e8",
  minWidth: 340,
  padding: 12,
  position: "absolute",
  right: 0,
  top: 46,
  width: "min(420px, calc(100vw - 32px))",
  zIndex: 80,
};

const iconButtonStyle: CSSProperties = {
  alignItems: "center",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  color: "#f6f1e8",
  cursor: "pointer",
  display: "inline-flex",
  height: 34,
  justifyContent: "center",
  width: 34,
};

function notificationTone(notification: Notification): CSSProperties {
  if (notification.severity === "urgent") return { color: "#ff9b82" };
  if (notification.severity === "attention") return { color: "#d7b56d" };
  return { color: "#8fd8d2" };
}

export function NotificationCenter(): ReactElement {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = (): void => {
    setState({ kind: "loading" });
    void listNotifications("unread", 12)
      .then((notifications) => { setState({ kind: "ready", notifications }); })
      .catch(() => { setState({ kind: "error" }); });
  };

  useEffect(() => {
    load();
  }, []);

  const notifications = state.kind === "ready" ? state.notifications : [];
  const unreadCount = notifications.filter((notification) => notification.readAt === null).length;
  const summary = useMemo(() => {
    if (state.kind === "loading") return "Loading notifications";
    if (state.kind === "error") return "Notifications unavailable";
    if (unreadCount === 0) return "No unread notifications";
    return `${String(unreadCount)} unread notification${unreadCount === 1 ? "" : "s"}`;
  }, [state.kind, unreadCount]);

  const markRead = (notification: Notification): void => {
    setBusyId(notification.id);
    void markNotificationRead(notification.id)
      .then((updated) => {
        setState((prev) => prev.kind === "ready"
          ? {
              kind: "ready",
              notifications: prev.notifications
                .map((item) => item.id === updated.id ? updated : item)
                .filter((item) => item.readAt === null),
            }
          : prev);
      })
      .finally(() => { setBusyId(null); });
  };

  const viewNotification = (notification: Notification): void => {
    markRead(notification);
    if (notification.actionPath !== null) {
      void navigate(notification.actionPath);
      setOpen(false);
    }
  };

  return (
    <div style={shellStyle}>
      <button
        type="button"
        style={triggerStyle}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => { setOpen((value) => !value); }}
      >
        <Bell aria-hidden="true" size={16} />
        <span>{summary}</span>
        {unreadCount > 0 && <span style={badgeStyle}>{unreadCount}</span>}
      </button>

      {open && (
        <section style={panelStyle} aria-label="Notifications">
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <div>
              <h2 style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 20, margin: 0 }}>Change feed</h2>
              <p style={{ color: "rgba(246,241,232,0.62)", fontSize: 12, fontWeight: 750, margin: "3px 0 0" }}>
                Live plan, proposal, and ops notifications.
              </p>
            </div>
            <button type="button" style={iconButtonStyle} aria-label="Refresh notifications" onClick={load}>
              <RefreshCw aria-hidden="true" size={16} />
            </button>
          </div>

          {state.kind === "loading" && (
            <p style={{ color: "#c9d2cc", margin: "18px 0" }}>Loading the latest operational changes.</p>
          )}
          {state.kind === "error" && (
            <p style={{ color: "#ffbc9d", margin: "18px 0" }}>Notifications could not be loaded.</p>
          )}
          {state.kind === "ready" && notifications.length === 0 && (
            <p style={{ color: "#c9d2cc", margin: "18px 0" }}>No unread changes for this workspace.</p>
          )}
          {state.kind === "ready" && notifications.length > 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              {notifications.map((notification) => (
                <article
                  key={notification.id}
                  style={{
                    background: "rgba(255,255,255,0.055)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    padding: 12,
                  }}
                >
                  <div style={{ alignItems: "start", display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr) auto auto" }}>
                    <div>
                      <p style={{ ...notificationTone(notification), fontSize: 12, fontWeight: 900, margin: "0 0 4px", textTransform: "uppercase" }}>
                        {notification.severity}
                      </p>
                      <h3 style={{ fontSize: 14, margin: 0 }}>{notification.title}</h3>
                      <p style={{ color: "rgba(246,241,232,0.68)", fontSize: 13, lineHeight: 1.42, margin: "5px 0 0" }}>
                        {notification.body}
                      </p>
                    </div>
                    {notification.actionPath !== null && (
                      <button
                        type="button"
                        style={iconButtonStyle}
                        aria-label={`View ${notification.title}`}
                        onClick={() => { viewNotification(notification); }}
                      >
                        <ExternalLink aria-hidden="true" size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      style={iconButtonStyle}
                      aria-label={`Mark ${notification.title} read`}
                      disabled={busyId === notification.id}
                      onClick={() => { markRead(notification); }}
                    >
                      <CheckCheck aria-hidden="true" size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
