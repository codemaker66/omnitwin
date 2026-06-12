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
