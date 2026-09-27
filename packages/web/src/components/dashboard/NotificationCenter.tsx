import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronDown, RefreshCw } from "lucide-react";
import type { Notification } from "@omnitwin/types";
import { listNotifications, markNotificationRead } from "../../api/notifications.js";
import { listensForFloorRequests, subscribeRequestsLive } from "../../lib/requests-live.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import "./NotificationCenter.css";

// The notifications block inside the dashboard's More popover. It reads the
// register it sits in (--reg-*, styles/workspace.css): ink on the ivory
// popover, where it used to paint its own near-black panel.

/** The newest unread, which is what fits the popover. */
const NOTIFICATION_PAGE = 12;

type LoadState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly notifications: readonly Notification[];
      readonly refreshing: boolean;
      /** A reload failed, so the list on screen is the one from before. */
      readonly refreshFailed: boolean;
    }
  | { readonly kind: "error" };

/** Every tone carries a word; the dot beside it is never the only signal. */
const SEVERITY_WORDS: Readonly<Record<Notification["severity"], string>> = {
  urgent: "Urgent",
  attention: "Needs attention",
  info: "Update",
};

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
  /**
   * Whether the list is showing. The shell owns it, so the bell on the nav
   * row opens the popover with the list already showing, and More opens it on
   * its links.
   */
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
}

export function NotificationCenter({
  unreadCount, onUnreadChanged, expanded, onExpandedChange,
}: NotificationCenterProps): ReactElement {
  const navigate = useNavigate();
  const panelId = useId();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(() => new Set());
  const listens = useAuthStore((store) => listensForFloorRequests(store.user));
  // Only the newest request may write the list: an older answer landing late
  // would put back what a newer one had already replaced.
  const latestLoad = useRef(0);
  // Read here, so a list asked for before the read landed cannot bring it back.
  const readIds = useRef(new Set<string>());

  // A reload keeps the list on screen while it asks again; only a first load,
  // or one after a failure, has nothing to show but the working state.
  const load = useCallback((): void => {
    latestLoad.current += 1;
    const request = latestLoad.current;
    setState((prev) => prev.kind === "ready" ? { ...prev, refreshing: true } : { kind: "loading" });
    void listNotifications("unread", NOTIFICATION_PAGE)
      .then((notifications) => {
        if (request !== latestLoad.current) return;
        setState({
          kind: "ready",
          notifications: notifications.filter((item) => !readIds.current.has(item.id)),
          refreshing: false,
          refreshFailed: false,
        });
      })
      .catch(() => {
        if (request !== latestLoad.current) return;
        setState((prev) => prev.kind === "ready"
          ? { ...prev, refreshing: false, refreshFailed: true }
          : { kind: "error" });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Opening the list asks again, so what it shows is current rather than
  // whatever was true when the dashboard loaded.
  const wasExpanded = useRef(expanded);
  useEffect(() => {
    if (expanded && !wasExpanded.current) load();
    wasExpanded.current = expanded;
  }, [expanded, load]);

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
    const { id } = notification;
    setBusyIds((prev) => new Set(prev).add(id));
    setFailedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    void markNotificationRead(id)
      .then(() => {
        readIds.current.add(id);
        onUnreadChanged();
        setState((prev) => prev.kind === "ready"
          ? { ...prev, notifications: prev.notifications.filter((item) => item.id !== id) }
          : prev);
      })
      .catch(() => {
        // Said beside the notification it belongs to; the notification stays
        // unread and in the list, so trying again is the same button.
        setFailedIds((prev) => new Set(prev).add(id));
      })
      .finally(() => {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
  };

  const viewNotification = (notification: Notification): void => {
    markRead(notification);
    if (notification.actionPath !== null) {
      void navigate(notification.actionPath);
      onExpandedChange(false);
    }
  };

  return (
    <div className="vv-notifications">
      <button
        type="button"
        className="vv-notifications-trigger"
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        onClick={() => { onExpandedChange(!expanded); }}
      >
        {state.kind === "loading" ? <ActivityIndicator size={16} /> : <Bell aria-hidden="true" size={16} />}
        <span className="vv-notifications-summary">{summary}</span>
        <ChevronDown aria-hidden="true" size={16} className="vv-notifications-chevron" />
      </button>

      {expanded && (
        <section id={panelId} className="vv-notifications-panel" aria-label="Notifications">
          <div className="vv-notifications-bar">
            <p className="vv-notifications-order">Unread, newest first</p>
            {/* Each name starts with the words on the button, then says what it
                acts on, so a spoken command and a screen reader agree. */}
            <button
              type="button"
              className="vv-notifications-button"
              aria-label="Refresh notifications"
              aria-busy={state.kind === "ready" && state.refreshing}
              onClick={load}
            >
              {state.kind === "ready" && state.refreshing
                ? <ActivityIndicator size={14} />
                : <RefreshCw aria-hidden="true" size={14} />}
              Refresh
            </button>
          </div>

          {state.kind === "loading" && (
            <ActivityStatus className="vv-notifications-note">Loading notifications…</ActivityStatus>
          )}
          {state.kind === "error" && (
            <p className="vv-notifications-note vv-notifications-note--alert">Notifications could not be loaded.</p>
          )}
          {state.kind === "ready" && state.refreshFailed && (
            <p className="vv-notifications-note vv-notifications-note--alert">Could not refresh; this list may be out of date.</p>
          )}
          {state.kind === "ready" && notifications.length === 0 && (
            <p className="vv-notifications-note">Nothing waiting on you.</p>
          )}
          {notifications.length > 0 && (
            <ul className="vv-notifications-list">
              {notifications.map((notification) => {
                const busy = busyIds.has(notification.id);
                return (
                  <li key={notification.id} className="vv-notification" data-severity={notification.severity}>
                    <p className="vv-notification-tone">
                      <span className="vv-notification-dot" aria-hidden="true" />
                      {SEVERITY_WORDS[notification.severity]}
                    </p>
                    <h3 className="vv-notification-title">{notification.title}</h3>
                    <p className="vv-notification-body">{notification.body}</p>
                    <div className="vv-notification-actions">
                      {notification.actionPath !== null && (
                        <button
                          type="button"
                          className="vv-notifications-button"
                          aria-label={`View: ${notification.title}`}
                          onClick={() => { viewNotification(notification); }}
                        >
                          View
                        </button>
                      )}
                      <button
                        type="button"
                        className="vv-notifications-button"
                        aria-label={`Mark read: ${notification.title}`}
                        disabled={busy}
                        aria-busy={busy}
                        onClick={() => { markRead(notification); }}
                      >
                        {busy && <ActivityIndicator size={14} />}
                        Mark read
                      </button>
                    </div>
                    {failedIds.has(notification.id) && (
                      <p className="vv-notification-failed" role="alert">Could not mark this read. Try again.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
