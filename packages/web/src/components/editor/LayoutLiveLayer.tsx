import { useEffect, useMemo, type ReactElement } from "react";
import "./LayoutLiveLayer.css";
import type { LiveParticipant } from "@omnitwin/types";
import { getConfig } from "../../api/configurations.js";
import { getAuthToken } from "../../api/client.js";
import { API_URL } from "../../config/env.js";
import { CO_EDITING_AUTOSAVE_MS, LayoutLiveClient, browserLiveSocket } from "../../lib/layout-live/live-client.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { isE2EAuthBypassEnabled, isE2ELiveSocketEnabled } from "../../lib/e2e-auth-bypass.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useLayoutLiveStore } from "../../stores/layout-live-store.js";
import { ActivityStatus } from "../shared/Activity.js";
import { setAutoSaveDelayOverride } from "./EditorBridge.js";

// ---------------------------------------------------------------------------
// Live co-editing v1 — the planner's view of other people in the layout.
//
// One mount per planner (beside EditorBridge). It opens the layout's live
// room for a signed-in person on a saved layout; the server decides whether
// they are admitted (owner and venue floor only). Until it says yes nothing
// is drawn, so a client sees exactly what they saw before.
//
// What is drawn is deliberately quiet: a row of initials for the other
// people here (the room each is viewing in the tooltip and accessible name),
// one brief line when someone else's change lands on what this person is
// touching, and a reconnecting status when the room is lost.
// ---------------------------------------------------------------------------

/** How long "Alex moved this table" stays. */
export const LIVE_NOTICE_MS = 3_200;
const MAX_AVATARS = 4;

/** Muted tones from the house palette — distinguishable, never loud. */
const PARTICIPANT_TONES: readonly string[] = ["#2b4a3d", "#8a4119", "#2c5537", "#4d6c5c", "#94491f", "#5d8963"];

function toneFor(connectionId: string): string {
  let hash = 0;
  for (let i = 0; i < connectionId.length; i += 1) hash = (hash * 31 + connectionId.charCodeAt(i)) >>> 0;
  return PARTICIPANT_TONES[hash % PARTICIPANT_TONES.length] ?? "#2b4a3d";
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/u).filter((part) => part.length > 0);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase() || "·";
}

export function describeParticipant(participant: LiveParticipant): string {
  return participant.view === null ? participant.name : `${participant.name} · ${participant.view.label}`;
}


/** Opens and owns the live room for the open layout. Renders nothing. */
function useLayoutLiveRoom(): void {
  const configId = useEditorStore((s) => s.configId);
  const isPublicPreview = useEditorStore((s) => s.isPublicPreview);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  useEffect(() => {
    if (configId === null || isPublicPreview || !isAuthenticated || typeof WebSocket === "undefined") return;
    // A mocked e2e harness has no socket server; a live-stack run opts in.
    if (isE2EAuthBypassEnabled() && !isE2ELiveSocketEnabled()) return;
    const client = new LayoutLiveClient({
      configId,
      url: `${API_URL.replace(/^http/u, "ws")}/ws/configurations/${configId}`,
      openSocket: browserLiveSocket,
      getToken: getAuthToken,
      fetchConfig: getConfig,
      onCoEditorsChanged: (others) => { setAutoSaveDelayOverride(others > 0 ? CO_EDITING_AUTOSAVE_MS : null); },
    });
    client.start();
    return () => { client.stop(); };
  }, [configId, isPublicPreview, isAuthenticated]);
}

export function LayoutLivePresence({ others }: { readonly others: readonly LiveParticipant[] }): ReactElement | null {
  if (others.length === 0) return null;
  const shown = others.slice(0, MAX_AVATARS);
  const hidden = others.length - shown.length;
  const label = `Also in this layout: ${others.map(describeParticipant).join(", ")}`;
  return (
    <div role="group" aria-label={label} data-testid="layout-live-presence" className="layout-live-presence">
      {shown.map((participant) => (
        <span
          key={participant.connectionId}
          title={describeParticipant(participant)}
          data-testid="layout-live-avatar"
          className="layout-live-avatar"
          style={{ background: toneFor(participant.connectionId) }}
        >
          {initialsOf(participant.name)}
        </span>
      ))}
      {hidden > 0 && (
        <span
          title={others.slice(MAX_AVATARS).map(describeParticipant).join(", ")}
          className="layout-live-avatar"
          style={{ background: "#1f3a2f" }}
        >
          +{hidden}
        </span>
      )}
    </div>
  );
}

export function LayoutLiveLayer({ mobile }: { readonly mobile: boolean }): ReactElement | null {
  useLayoutLiveRoom();
  const status = useLayoutLiveStore((s) => s.status);
  const participants = useLayoutLiveStore((s) => s.participants);
  const connectionId = useLayoutLiveStore((s) => s.connectionId);
  const notice = useLayoutLiveStore((s) => s.notice);
  const dismissNotice = useLayoutLiveStore((s) => s.dismissNotice);
  const others = useMemo(
    () => participants.filter((participant) => participant.connectionId !== connectionId),
    [participants, connectionId],
  );

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => { dismissNotice(notice.id); }, LIVE_NOTICE_MS);
    return () => { clearTimeout(timer); };
  }, [notice, dismissNotice]);

  if (status !== "live" && status !== "reconnecting") return null;
  return (
    <div data-testid="layout-live-layer" className={mobile ? "layout-live-layer is-mobile" : "layout-live-layer"}>
      {status === "reconnecting" ? (
        <span className="layout-live-capsule">
          <ActivityStatus>Reconnecting to the room…</ActivityStatus>
        </span>
      ) : (
        <LayoutLivePresence others={others} />
      )}
      {notice !== null && status === "live" && (
        <span role="status" aria-live="polite" data-testid="layout-live-notice" className="layout-live-capsule layout-live-notice">
          {notice.text}
        </span>
      )}
    </div>
  );
}
