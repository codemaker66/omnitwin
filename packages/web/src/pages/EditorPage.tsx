import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { App as Editor3D } from "../App.js";
import { useEditorStore } from "../stores/editor-store.js";
import { useAuthStore } from "../stores/auth-store.js";
import { SaveSendPanel } from "../components/editor/SaveSendPanel.js";
import { MobilePlannerTopBar } from "../components/editor/MobilePlannerTopBar.js";
import { SubmitForReviewPanel } from "../components/editor/SubmitForReviewPanel.js";
import { EditorBridge } from "../components/editor/EditorBridge.js";
import { ObjectNotePanel } from "../components/editor/ObjectNotePanel.js";
import { EventDetailsPanel } from "../components/editor/EventDetailsPanel.js";
import { TruthModeIndicator } from "../components/truth/TruthModeIndicator.js";
import { BlueprintPage } from "./BlueprintPage.js";
import {
  buildProceduralTruthSummary,
  isTruthModeUiEnabled,
} from "../lib/truth-mode-summary.js";
import { useIsCoarsePointer, useIsNarrowViewport } from "../hooks/use-media-query.js";
import {
  copyForEditorSaveStatus,
  deriveEditorSaveStatus,
} from "../lib/editor-save-status.js";
import {
  resolvePlannerVenue,
  type PlannerVenueAccessUser,
} from "../lib/planner-venue-resolution.js";
import * as spacesApi from "../api/spaces.js";

const DEFAULT_SPACE_SLUG = "grand-hall";

type PlannerBootstrapBlocker =
  | { readonly kind: "network" }
  | { readonly kind: "empty" }
  | { readonly kind: "not_found"; readonly requestedSlug: string }
  | { readonly kind: "forbidden"; readonly requestedSlug: string; readonly venueName: string };

interface PlannerBootstrapBlockerCopy {
  readonly title: string;
  readonly body: string;
  readonly action: string;
}

function plannerBootstrapBlockerCopy(blocker: PlannerBootstrapBlocker): PlannerBootstrapBlockerCopy {
  switch (blocker.kind) {
    case "empty":
      return {
        title: "No venues are available",
        body: "The planner cannot start because there are no active venues to open.",
        action: "Retry",
      };
    case "not_found":
      return {
        title: "Venue not found",
        body: `The planner link names "${blocker.requestedSlug}", but that venue is not available.`,
        action: "Open main planner",
      };
    case "forbidden":
      return {
        title: "Planner unavailable for this venue",
        body: `Your account is not attached to ${blocker.venueName}. Open your venue planner or ask an admin to update access.`,
        action: "Open main planner",
      };
    case "network":
      return {
        title: "Couldn\u2019t open the planner",
        body: "The server didn\u2019t respond in time. This is usually temporary; try again in a few seconds.",
        action: "Retry",
      };
  }
}

// ---------------------------------------------------------------------------
// EditorPage — public 3D editor with space picker + save/send flow
// ---------------------------------------------------------------------------

export function EditorPage(): React.ReactElement {
  // Config ID resolution via URL params only. Previously used useLoaderData
  // for loader-backed routes, but React Router v7 surfaces "Internal Server
  // Error" when useLoaderData is called from a component mounted on a route
  // without a loader (e.g. /plan itself). The /:username/:slug route that
  // needed the loader is future work — no accounts have named URLs yet so
  // nothing real is lost.
  const params = useParams<{ configId?: string; code?: string; venueSlug?: string }>();
  const urlConfigId = params.configId ?? params.code;
  const routeVenueSlug = params.venueSlug;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const storeConfigId = useEditorStore((s) => s.configId);
  const isLoading = useEditorStore((s) => s.isLoading);
  const error = useEditorStore((s) => s.error);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authLoading = useAuthStore((s) => s.isLoading);
  const authRole = useAuthStore((s) => s.user?.role ?? null);
  const authVenueId = useAuthStore((s) => s.user?.venueId ?? null);
  const [autoCreateBlocker, setAutoCreateBlocker] = useState<PlannerBootstrapBlocker | null>(null);
  const autoCreateAttemptedFor = useRef<string | null>(null);
  const venueAccessUser = useMemo<PlannerVenueAccessUser | null>(() => {
    if (!isAuthenticated || authRole === null) return null;
    return { role: authRole, venueId: authVenueId };
  }, [authRole, authVenueId, isAuthenticated]);
  const wantedSpaceSlug = searchParams.get("space") ?? DEFAULT_SPACE_SLUG;

  // Load config from URL on mount. The first load uses the current
  // isAuthenticated value (false before Clerk resolves). For public configs
  // this succeeds immediately. For private/claimed configs the public path
  // may 404 — when auth later resolves and isAuthenticated flips to true,
  // the effect re-fires because storeConfigId is still null (set() is not
  // called on error), retrying via the authenticated endpoint.
  useEffect(() => {
    if (urlConfigId !== undefined && urlConfigId !== storeConfigId) {
      void useEditorStore.getState().loadConfiguration(urlConfigId, isAuthenticated);
    }
  }, [urlConfigId, storeConfigId, isAuthenticated]);

  // Auto-open the requested venue + space on the first render that has no
  // configId anywhere. `/plan` keeps the single-tenant shortcut by choosing the
  // first active venue; `/v/:venueSlug/plan` is explicit and fail-closed.
  useEffect(() => {
    if (urlConfigId !== undefined || storeConfigId !== null) return;
    if (routeVenueSlug !== undefined && authLoading) return;
    const bootstrapKey = [
      routeVenueSlug ?? "",
      wantedSpaceSlug,
      isAuthenticated ? authRole ?? "" : "anonymous",
      authVenueId ?? "",
    ].join("|");
    if (autoCreateAttemptedFor.current === bootstrapKey) return;
    autoCreateAttemptedFor.current = bootstrapKey;
    setAutoCreateBlocker(null);
    void (async () => {
      try {
        const venues = await spacesApi.listVenues();
        const venueResolution = resolvePlannerVenue(venues, routeVenueSlug, venueAccessUser);
        if (venueResolution.status !== "resolved") {
          const blocker: PlannerBootstrapBlocker =
            venueResolution.status === "forbidden"
              ? {
                kind: "forbidden",
                requestedSlug: venueResolution.requestedSlug,
                venueName: venueResolution.venue.name,
              }
              : venueResolution.status === "not_found"
                ? { kind: "not_found", requestedSlug: venueResolution.requestedSlug }
                : { kind: "empty" };
          setAutoCreateBlocker(blocker);
          return;
        }

        const spaces = await spacesApi.listSpaces(venueResolution.venue.id);
        const space =
          spaces.find((s) => s.slug === wantedSpaceSlug)
          ?? spaces.find((s) => s.slug === DEFAULT_SPACE_SLUG)
          ?? spaces[0];
        if (space === undefined) { setAutoCreateBlocker({ kind: "empty" }); return; }
        const newConfigId = await useEditorStore.getState().createPublicConfig(space.id);
        void navigate(`/plan/${newConfigId}`, { replace: true });
      } catch {
        setAutoCreateBlocker({ kind: "network" });
      }
    })();
  }, [
    authLoading,
    authRole,
    authVenueId,
    isAuthenticated,
    navigate,
    routeVenueSlug,
    storeConfigId,
    urlConfigId,
    venueAccessUser,
    wantedSpaceSlug,
  ]);

  // Auto-create failed → show a minimal retry screen instead of the
  // legacy SpacePicker splash. The SpacePicker was the old entry flow
  // (pick a venue → pick a space); now /plan always drops users
  // straight into a Grand Hall config, so the splash has no role on
  // this route.
  if (autoCreateBlocker !== null && urlConfigId === undefined && storeConfigId === null) {
    const copy = plannerBootstrapBlockerCopy(autoCreateBlocker);
    return (
      <div style={{
        minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 16, fontFamily: "'Inter', sans-serif",
        color: "#333", background: "#f5f5f0", padding: 24, textAlign: "center",
      }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>{copy.title}</div>
        <div style={{ fontSize: 14, color: "#666", maxWidth: 360 }}>
          {copy.body}
        </div>
        <button
          type="button"
          onClick={() => {
            if (autoCreateBlocker.kind === "not_found" || autoCreateBlocker.kind === "forbidden") {
              void navigate("/plan", { replace: true });
              return;
            }
            window.location.reload();
          }}
          style={{
            marginTop: 8, padding: "10px 24px", background: "#7a1f2a", color: "#fff",
            border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}
        >
          {copy.action}
        </button>
      </div>
    );
  }

  // Auto-create in flight (or about to start) — show a neutral loading
  // screen, not the SpacePicker splash.
  if (urlConfigId === undefined && storeConfigId === null) {
    return (
      <div style={{
        minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Inter', sans-serif", color: "#999", background: "#f5f5f0",
      }}>
        Opening the planner…
      </div>
    );
  }

  // Loading config
  if (isLoading) {
    return (
      <div style={{
        minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Inter', sans-serif", color: "#999", background: "#f5f5f0",
      }}>
        Loading layout...
      </div>
    );
  }

  // Error loading config — show message with retry
  if (error !== null) {
    return (
      <div style={{
        minHeight: "100dvh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 12,
        fontFamily: "'Inter', sans-serif", color: "#333", background: "#f5f5f0",
      }}>
        <p style={{ fontSize: 16, fontWeight: 600 }}>Failed to load layout</p>
        <p style={{ fontSize: 13, color: "#999" }}>{error}</p>
        <button
          type="button"
          onClick={() => { void navigate("/plan", { replace: true }); }}
          style={{
            padding: "8px 20px", fontSize: 13, fontWeight: 600,
            background: "#1a1a2e", color: "#fff", border: "none",
            borderRadius: 6, cursor: "pointer", marginTop: 8,
          }}
        >
          Start Fresh
        </button>
      </div>
    );
  }

  return (
    <PlannerCommsLayer />
  );
}

/**
 * Groups the 3D editor with the planner-authored comms layer:
 *   - ObjectNotePanel: floating input for per-object notes, appears
 *     when a single object is selected
 *   - EventDetailsPanel: modal for event-level instructions, opened
 *     via a top-right button. Only visible when a config is loaded
 *     (configId !== null).
 *
 * Pulled into its own component because the panel open/close state is
 * local — EditorPage above handles URL/store bootstrap and shouldn't
 * re-render on every UI state flip.
 */
function PlannerCommsLayer(): React.ReactElement {
  const [eventDetailsOpen, setEventDetailsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"3d" | "2d">("3d");
  const [searchParams] = useSearchParams();
  const isNarrow = useIsNarrowViewport();
  const isTouch = useIsCoarsePointer();
  const configId = useEditorStore((s) => s.configId);
  const isPublicPreview = useEditorStore((s) => s.isPublicPreview);
  const saveError = useEditorStore((s) => s.saveError);
  const saveConflict = useEditorStore((s) => s.saveConflict);
  const placedObjectCount = useEditorStore((s) => s.objects.length);
  const authState = useAuthStore((s) => s.isAuthenticated);
  const truthModeEnabled = isTruthModeUiEnabled(searchParams, import.meta.env.DEV);
  const truthSummary = useMemo(
    () => buildProceduralTruthSummary({
      surface: viewMode === "3d" ? "planner_3d" : "planner_2d",
      placedObjectCount,
      measuredRuntimeAssetsLoaded: false,
    }),
    [placedObjectCount, viewMode],
  );
  // The Event Details panel writes to the auth-only PATCH endpoint. Showing
  // it on unclaimed public-preview configs would 401 on every save and
  // discard the planner's work with a generic "Failed to save". Hide until
  // the config is claimed; the panel itself renders a sign-in hint if it
  // ever opens in that state (defense-in-depth).
  const canEditEventDetails = configId !== null && !isPublicPreview;
  const mobile = isNarrow || isTouch;
  return (
    <>
      <EditorBridge />
      <div
        data-testid="planner-3d-shell"
        style={{
          height: "100dvh",
          minHeight: "100dvh",
          width: "100vw",
          maxWidth: "100vw",
          overflow: "hidden",
          boxSizing: "border-box",
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          position: "relative",
        }}
      >
        {viewMode === "3d" ? <Editor3D /> : <BlueprintPage source="editor-store" />}
      </div>
      {mobile ? (
        <MobilePlannerTopBar mode={viewMode} onModeChange={setViewMode} />
      ) : (
        <>
          <PlannerStatusHeader viewMode={viewMode} />
          <ViewModeToggle mode={viewMode} onChange={setViewMode} isMobile={mobile} />
        </>
      )}
      {canEditEventDetails && viewMode === "3d" && (
        <button
          type="button"
          onClick={() => { setEventDetailsOpen(true); }}
          style={{
            position: "fixed",
            top: mobile ? "calc(env(safe-area-inset-top) + 84px)" : 16,
            right: 16,
            zIndex: 30,
            padding: "8px 14px", borderRadius: 8,
            background: "rgba(20,19,17,0.85)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(201,168,76,0.35)",
            color: "#c9a84c", fontSize: 12, fontWeight: 600,
            cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif",
            letterSpacing: "0.04em",
          }}
        >
          ★ EVENT DETAILS
        </button>
      )}
      <EventDetailsPanel open={eventDetailsOpen} onClose={() => { setEventDetailsOpen(false); }} />
      <ObjectNotePanel />
      <SaveSendPanel />
      <SubmitForReviewPanel />
      {truthModeEnabled && <TruthModeIndicator summary={truthSummary} />}
      {saveError !== null ? (
        <SaveErrorToast message={saveError} isAuthenticated={authState} conflict={saveConflict} />
      ) : null}
    </>
  );
}

function PlannerStatusHeader({ viewMode }: { viewMode: "3d" | "2d" }): React.ReactElement {
  const spaceName = useEditorStore((s) => s.space?.name ?? "Grand Hall");
  const configId = useEditorStore((s) => s.configId);
  const isPublicPreview = useEditorStore((s) => s.isPublicPreview);
  const objectCount = useEditorStore((s) => s.objects.length);
  const isDirty = useEditorStore((s) => s.isDirty);
  const isSaving = useEditorStore((s) => s.isSaving);
  const saveError = useEditorStore((s) => s.saveError);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const status = deriveEditorSaveStatus({ isDirty, isSaving, saveError, lastSavedAt });
  const saveCopy = copyForEditorSaveStatus(status);
  const layoutMode = isPublicPreview ? "Guest draft" : "Team layout";
  const formattedObjectCount = objectCount.toLocaleString("en-GB");
  const furnitureCopy = objectCount === 1 ? "1 placed item" : `${formattedObjectCount} placed items`;
  const viewLabel = viewMode === "3d" ? "3D planning" : "2D planning";
  const configLabel = configId === null ? "Opening layout" : "Layout proposal";

  return (
    <section
      className="planner-status-header"
      data-testid="planner-status-header"
      aria-label="Planner status"
      data-save-status={status}
    >
      <div className="planner-status-header__brand">
        <div className="planner-status-header__mark" aria-hidden="true">Vv</div>
        <div className="planner-status-header__brand-copy">
          <div className="planner-status-header__brand-title">Venviewer</div>
          <div className="planner-status-header__brand-subtitle">{layoutMode}</div>
        </div>
      </div>
      <div className="planner-status-header__cell">
        <span>Venue</span>
        <strong>{spaceName}</strong>
      </div>
      <div className="planner-status-header__cell planner-status-header__cell--phase">
        <span>Planning phase</span>
        <strong>Build layout - submit draft</strong>
      </div>
      <div className="planner-status-header__review">
        Draft layout / venue review required
      </div>
      <div className="planner-status-header__cell planner-status-header__cell--save">
        <span className="planner-status-header__dot" aria-hidden="true" />
        <span>Save status</span>
        <strong>{saveCopy.label}</strong>
      </div>
      <div className="planner-status-header__cell planner-status-header__cell--runtime">
        <span>Visual layer</span>
        <strong>Procedural layer / no signed capture</strong>
      </div>
      <div className="planner-status-header__cell planner-status-header__cell--summary">
        <span>{viewLabel}</span>
        <strong>{configLabel} / {furnitureCopy}</strong>
      </div>
    </section>
  );
}

/**
 * Non-destructive save-failure toast. Docks bottom-centre so it doesn't
 * overlap the SaveSendPanel (bottom-right). Provides an inline retry
 * (re-fires saveToServer) and a dismiss. The 3D Canvas above stays
 * mounted — the user's in-progress layout is preserved. */
function SaveErrorToast({
  message,
  isAuthenticated,
  conflict,
}: {
  message: string;
  isAuthenticated: boolean;
  conflict: { readonly expectedRevision: number; readonly currentRevision: number } | null;
}): React.ReactElement {
  const retry = (): void => {
    useEditorStore.getState().clearSaveError();
    void useEditorStore.getState().saveToServer(isAuthenticated);
  };
  const reload = (): void => {
    void useEditorStore.getState().reloadAfterConflict(isAuthenticated);
  };
  const dismiss = (): void => { useEditorStore.getState().clearSaveError(); };
  const body = conflict === null
    ? `Couldn't save — ${message}. Your layout is safe; we'll try again.`
    : `Couldn't save — ${message} Server revision ${String(conflict.currentRevision)} is newer than this tab's revision ${String(conflict.expectedRevision)}.`;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", left: "50%", transform: "translateX(-50%)",
        bottom: "calc(var(--toolbox-bottom, 0px) + 16px)",
        zIndex: 40,
        background: "rgba(20,19,17,0.95)",
        border: "1px solid rgba(201,168,76,0.5)",
        borderRadius: 8,
        padding: "12px 16px",
        display: "flex", alignItems: "center", gap: 12,
        fontFamily: "'Inter', system-ui, sans-serif",
        color: "#f5f0e8", fontSize: 13,
        maxWidth: "90vw",
        boxShadow: "0 8px 24px -8px rgba(0,0,0,0.6)",
      }}
    >
      <span style={{ color: "#e88", fontSize: 15 }}>⚠</span>
      <span style={{ flex: 1 }}>{body}</span>
      {conflict === null ? (
        <button
          type="button"
          onClick={retry}
          style={{
            padding: "4px 12px", fontSize: 12, fontWeight: 600,
            background: "#c9a84c", color: "#141311", border: "none",
            borderRadius: 4, cursor: "pointer",
          }}
        >
          Retry
        </button>
      ) : (
        <button
          type="button"
          onClick={reload}
          style={{
            padding: "4px 12px", fontSize: 12, fontWeight: 600,
            background: "#c9a84c", color: "#141311", border: "none",
            borderRadius: 4, cursor: "pointer",
          }}
        >
          Reload
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          padding: "4px 10px", fontSize: 14, background: "transparent",
          color: "#f5f0e8", border: "1px solid rgba(245,240,232,0.25)",
          borderRadius: 4, cursor: "pointer",
        }}
      >
        ✕
      </button>
    </div>
  );
}

function ViewModeToggle({
  mode,
  onChange,
  isMobile,
}: {
  mode: "3d" | "2d";
  onChange: (m: "3d" | "2d") => void;
  isMobile: boolean;
}): React.ReactElement {
  const btn = (label: string, value: "3d" | "2d"): React.ReactElement => {
    const active = mode === value;
    return (
      <button
        type="button"
        onClick={() => { onChange(value); }}
        style={{
          padding: "6px 14px",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.05em",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          background: active ? "#c9a84c" : "transparent",
          color: active ? "#141311" : "#c9a84c",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div
      style={{
        position: "fixed",
        top: isMobile ? "calc(env(safe-area-inset-top) + 10px)" : 82,
        left: isMobile ? 10 : "50%",
        transform: isMobile ? "none" : "translateX(-50%)",
        zIndex: 31,
        display: "inline-flex",
        gap: 2,
        padding: 3,
        borderRadius: 8,
        background: "rgba(20,19,17,0.85)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(201,168,76,0.35)",
      }}
      role="group"
      aria-label="View mode"
    >
      {btn("3D", "3d")}
      {btn("2D", "2d")}
    </div>
  );
}
