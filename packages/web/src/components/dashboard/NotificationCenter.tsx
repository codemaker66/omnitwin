import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, ExternalLink, RefreshCw } from "lucide-react";
import type { Notification } from "@omnitwin/types";
import { listNotifications, markNotificationRead } from "../../api/notifications.js";
import { listensForFloorRequests, subscribeRequestsLive } from "../../lib/requests-live.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";

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
  fontWeight: 700,
  minHeight: 38,
  padding: "0 12px",
};

const panelStyle: CSSProperties = {
  background: "linear-gradient(180deg, rgba(15,23,24,0.98), rgba(8,10,10,0.98))",
  border: "1px solid rgba(201, 138, 91,0.3)",
  borderRadius: 8,
  boxShadow: "0 24px 70px rgba(0,0,0,0.42)",
  color: "var(--house-text-1, #f6f1e8)",
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
  color: "var(--house-text-1, #f6f1e8)",
  cursor: "pointer",
  display: "inline-flex",
  height: 34,
  justifyContent: "center",
  width: 34,
};

function notificationTone(notification: Notification): CSSProperties {
  if (notification.severity === "urgent") return { color: "#ff9b82" };
  if (notification.severity === "attention") return { color: "#c98a5b" };
  return { color: "#8fd8d2" };
}

export interface NotificationCenterProps {
  /**
   * The one unread number. The dashboard shell owns it, reads it from
   * GET /notifications/unread-count and shows it on the nav row's chip; this
   * panel says the same number in words rather than showing a second chip.
   * Null while it is not known, so the panel never states a count it has not
   * read.
   */
  readonly unreadCount: number | null;
  /** Called when something here changed what is unread. */
  readonly onUnreadChanged: () => void;
}

export function NotificationCenter({ unreadCount, onUnreadChanged }: NotificationCenterProps): ReactElement {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const listens = useAuthStore((store) => listensForFloorRequests(store.user));

  const load = useCallback((): void => {
    setState({ kind: "loading" });
    void listNotifications("unread", 12)
      .then((notifications) => { setState({ kind: "ready", notifications }); })
      .catch(() => { setState({ kind: "error" }); });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Something landing in the inbox, a request from the floor included,
  // refreshes the list without anybody reloading the page. Only people the
  // channel can carry something to open it.
  useEffect(() => {
    if (!listens) return;
    return subscribeRequestsLive((event) => {
      if (event.kind === "notification" || event.kind === "reconnected") load();
    });
  }, [listens, load]);

  const notifications = state.kind === "ready" ? state.notifications : [];
  const summary = useMemo(() => {
    if (state.kind === "loading") return "Loading notifications";
    if (state.kind === "error") return "Notifications unavailable";
    if (unreadCount === null) return "Notifications";
    if (unreadCount === 0) return "No unread notifications";
    return `${String(unreadCount)} unread notification${unreadCount === 1 ? "" : "s"}`;
  }, [state.kind, unreadCount]);

  const markRead = (notification: Notification): void => {
    setBusyId(notification.id);
    void markNotificationRead(notification.id)
      .then((updated) => {
        onUnreadChanged();
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
        {state.kind === "loading" ? <ActivityIndicator size={16} /> : <Bell aria-hidden="true" size={16} />}
        <span>{summary}</span>
      </button>

      {open && (
        <section style={panelStyle} aria-label="Notifications">
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <div>
              <h2 style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 20, margin: 0 }}>Notifications</h2>
            </div>
            <button type="button" style={iconButtonStyle} aria-label="Refresh notifications" onClick={load}>
              <RefreshCw aria-hidden="true" size={16} />
            </button>
          </div>

          {state.kind === "loading" && (
            <ActivityStatus style={{ color: "#c9d2cc", margin: "18px 0" }}>Loading notifications…</ActivityStatus>
          )}
          {state.kind === "error" && (
            <p style={{ color: "#ffbc9d", margin: "18px 0" }}>Notifications could not be loaded.</p>
          )}
          {state.kind === "ready" && notifications.length === 0 && (
            <p style={{ color: "#c9d2cc", margin: "18px 0" }}>No unread notifications.</p>
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
                      <p style={{ ...notificationTone(notification), fontSize: 12, fontWeight: 700, margin: "0 0 4px", textTransform: "uppercase" }}>
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
                      aria-busy={busyId === notification.id}
                      onClick={() => { markRead(notification); }}
                    >
                      {busyId === notification.id ? <ActivityIndicator size={15} /> : <CheckCheck aria-hidden="true" size={15} />}
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
