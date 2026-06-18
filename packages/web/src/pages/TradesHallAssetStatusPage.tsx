import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Boxes, ExternalLink, ShieldQuestion } from "lucide-react";
import type { RoomAssetStatus } from "@omnitwin/types";
import { getAdminAssetRooms } from "../api/asset-status.js";
import { containsUnsafePublicClaim } from "../lib/safe-public-copy.js";
import "./TradesHallAssetStatusPage.css";

type LoadState = "loading" | "loaded" | "error";

function statusLabel(value: string | null): string {
  return value === null ? "not checked" : value.replace(/_/gu, " ");
}

function roomUrl(roomSlug: string): string {
  const params = new URLSearchParams({ venue: "trades-hall", room: roomSlug });
  return `/dev/trades-hall-visual?${params.toString()}`;
}

function roomTone(room: RoomAssetStatus): "loadable" | "pending" | "processing" {
  if (room.runtimeStatus === "internal_ready" || room.runtimeStatus === "published") return "loadable";
  if (room.captureStatus === "splat_exists_outside_repo_needs_registration") return "pending";
  return "processing";
}

function hasUnsafeClaim(rooms: readonly RoomAssetStatus[]): boolean {
  const text = rooms
    .flatMap((room) => [
      room.safeCopy,
      room.nextAction,
      room.splatStatus,
      room.runtimePackageStatus,
      room.reviewedTransformSafeCopy,
      room.reviewedQaSafeCopy,
      room.captureControlAuthoritySafeCopy,
      room.captureControlStalenessSafeCopy,
      room.captureControlSafeCopy,
      room.runtimeControlEvidenceChainSafeCopy,
      room.runtimeControlEvidenceChainNextAction,
    ])
    .join(" ")
    .toLowerCase();
  return containsUnsafePublicClaim(text);
}

function RoomStatusRow({ room }: { readonly room: RoomAssetStatus }): ReactElement {
  const url = roomUrl(room.roomSlug);
  const tone = roomTone(room);
  return (
    <article className={`asset-status-room ${tone}`}>
      <div className="asset-status-room-heading">
        <span className="asset-status-room-mark" aria-hidden="true"><Boxes size={18} /></span>
        <div>
          <h2>{room.displayName}</h2>
          <p>{room.roomSlug} / {room.roomGroup}</p>
        </div>
        <span className="asset-status-pill">{room.defaultStatus.replace(/_/gu, " ")}</span>
      </div>

      <dl className="asset-status-grid">
        <div>
          <dt>Capture status</dt>
          <dd>{room.splatStatus}</dd>
        </div>
        <div>
          <dt>Runtime package</dt>
          <dd>{room.runtimePackageStatus}</dd>
        </div>
        <div>
          <dt>Evidence status</dt>
          <dd>{statusLabel(room.evidenceStatus)}</dd>
        </div>
        <div>
          <dt>Runtime transform</dt>
          <dd>
            {room.reviewedTransformSafeCopy}
            {room.latestTransformArtifactId !== null ? (
              <span className="asset-status-transform-id">{room.latestTransformArtifactId}</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Runtime QA / exposure</dt>
          <dd>
            <span className="asset-status-qa-status" data-status={room.reviewedQaStatus}>
              {statusLabel(room.reviewedQaStatus)}
            </span>
            <span className="asset-status-qa-copy">{room.reviewedQaSafeCopy}</span>
            {room.latestQaRecordId !== null ? (
              <span className="asset-status-qa-id">QA {room.latestQaRecordId}</span>
            ) : null}
            {room.qaSignedTransformArtifactId !== null ? (
              <span className="asset-status-qa-link">
                {room.qaSignedTransformLinked ? "transform link current: " : "transform link not current: "}
                {room.qaSignedTransformArtifactId}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Capture control</dt>
          <dd>
            <span className="asset-status-capture-control-status" data-status={room.captureControlStatus}>
              {statusLabel(room.captureControlStatus)}
            </span>
            <span className="asset-status-capture-control-copy">{room.captureControlSafeCopy}</span>
            <span className="asset-status-capture-control-authority">{room.captureControlAuthoritySafeCopy}</span>
            <span
              className="asset-status-capture-control-freshness"
              data-status={room.captureControlFreshnessStatus}
            >
              {statusLabel(room.captureControlFreshnessStatus)}
            </span>
            <span className="asset-status-capture-control-staleness">{room.captureControlStalenessSafeCopy}</span>
            {room.latestCaptureControlSourceRecordId !== null ? (
              <span className="asset-status-capture-control-id">
                Record {room.latestCaptureControlSourceRecordId}
              </span>
            ) : null}
            {room.latestCaptureControlSourceId !== null ? (
              <span className="asset-status-capture-control-id">
                Source {room.latestCaptureControlSourceId}
              </span>
            ) : null}
            {room.latestCaptureControlSourceClass !== null ? (
              <span className="asset-status-capture-control-id">
                Class {statusLabel(room.latestCaptureControlSourceClass)}
              </span>
            ) : null}
            {room.latestCaptureControlPoseAuthorityLevel !== null ? (
              <span className="asset-status-capture-control-id">
                Authority {statusLabel(room.latestCaptureControlPoseAuthorityLevel)}
              </span>
            ) : null}
            {room.latestCaptureControlAlignmentMethods.length > 0 ? (
              <span className="asset-status-capture-control-id">
                Methods {room.latestCaptureControlAlignmentMethods.map(statusLabel).join(", ")}
              </span>
            ) : null}
            {room.latestCaptureControlStalenessTriggers.length > 0 ? (
              <span className="asset-status-capture-control-stale-list">
                Stale when {room.latestCaptureControlStalenessTriggers.map(statusLabel).join(", ")}
              </span>
            ) : null}
            {room.latestCaptureControlActiveStalenessTriggers.length > 0 ? (
              <span className="asset-status-capture-control-active-stale-list">
                Active stale trigger {room.latestCaptureControlActiveStalenessTriggers.map(statusLabel).join(", ")}
              </span>
            ) : null}
            {room.latestCaptureControlQaStatus !== null ? (
              <span className="asset-status-capture-control-id">
                QA {statusLabel(room.latestCaptureControlQaStatus)}
              </span>
            ) : null}
            {room.captureControlLinkedTransformArtifactId !== null ? (
              <span className="asset-status-capture-control-link">
                {room.captureControlTransformLinked ? "transform link current: " : "transform link not current: "}
                {room.captureControlLinkedTransformArtifactId}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Runtime-control chain</dt>
          <dd>
            <span
              className="asset-status-runtime-control-status"
              data-status={room.runtimeControlEvidenceChainStatus}
            >
              {statusLabel(room.runtimeControlEvidenceChainStatus)}
            </span>
            <span className="asset-status-runtime-control-copy">
              {room.runtimeControlEvidenceChainSafeCopy}
            </span>
            {room.runtimeControlRequiredCoordinatePairCount !== null &&
            room.runtimeControlReviewedCoordinatePairCount !== null ? (
              <span className="asset-status-runtime-control-counts">
                Coordinate pairs {room.runtimeControlReviewedCoordinatePairCount} / {room.runtimeControlRequiredCoordinatePairCount}
              </span>
            ) : null}
            {room.runtimeControlEvidenceChainRef !== null ? (
              <span className="asset-status-runtime-control-ref">
                Evidence {room.runtimeControlEvidenceChainRef}
              </span>
            ) : null}
            <span className="asset-status-runtime-control-next">
              {room.runtimeControlEvidenceChainNextAction}
            </span>
          </dd>
        </div>
        <div>
          <dt>Safe copy</dt>
          <dd>{room.safeCopy}</dd>
        </div>
      </dl>

      <div className="asset-status-action">
        <p>{room.nextAction}</p>
        {room.internalVisualEnabled ? (
          <Link to={url}>
            Open room view <ExternalLink size={15} aria-hidden="true" />
          </Link>
        ) : (
          <span>Internal visual disabled</span>
        )}
      </div>
    </article>
  );
}

export function TradesHallAssetStatusPage(): ReactElement {
  const [rooms, setRooms] = useState<readonly RoomAssetStatus[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setError(null);

    void getAdminAssetRooms("trades-hall")
      .then((result) => {
        if (cancelled) return;
        setRooms(result);
        setLoadState("loaded");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRooms([]);
        setLoadState("error");
        setError(err instanceof Error ? err.message : "Asset room status is unavailable.");
      });

    return () => { cancelled = true; };
  }, []);

  const unsafeClaimDetected = useMemo(() => hasUnsafeClaim(rooms), [rooms]);

  return (
    <main className="asset-status-shell">
      <header className="asset-status-hero">
        <div>
          <p className="asset-status-eyebrow">Internal asset registry</p>
          <h1>Trades Hall runtime rooms</h1>
          <p>
            Room-level capture and runtime package state for P0 real asset intake.
            Missing packages are planning context only.
          </p>
        </div>
        <div className="asset-status-trust">
          <ShieldQuestion size={22} aria-hidden="true" />
          <span>Human review required before operational reliance</span>
        </div>
      </header>

      {unsafeClaimDetected && (
        <section className="asset-status-warning" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          Unsafe public wording detected in asset status copy.
        </section>
      )}

      {loadState === "loading" && (
        <section className="asset-status-panel" aria-live="polite">
          Loading room runtime status.
        </section>
      )}

      {loadState === "error" && (
        <section className="asset-status-panel error" role="alert">
          <strong>Asset status unavailable.</strong>
          <span>{error}</span>
        </section>
      )}

      {loadState === "loaded" && rooms.length === 0 && (
        <section className="asset-status-panel">
          No room status records returned for Trades Hall.
        </section>
      )}

      {loadState === "loaded" && rooms.length > 0 && (
        <section className="asset-status-list" aria-label="Trades Hall room asset statuses">
          {rooms.map((room) => (
            <RoomStatusRow key={room.roomSlug} room={room} />
          ))}
        </section>
      )}
    </main>
  );
}
