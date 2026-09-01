import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useNavigate, useParams } from "react-router-dom";
import {
  SparkSplatLayer,
  type SparkSplatErrorEvent,
  type SparkSplatLoadEvent,
} from "../components/scene/SparkSplatLayer.js";
import {
  roomSplatBundle,
  roomSplatServedBytes,
  roomSplatServedSplats,
  roomSplatServedTileCount,
  roomSplatTileUrls,
  roomsWithSplatBundles,
} from "../data/room-splat-bundles.js";
import {
  runtimeAssetCameraViewForRoom,
  runtimeAssetViewTransformForRoom,
  STAGED_CAPTURE_STATUS,
  TRADES_HALL_RUNTIME_ROOMS,
  type TradesHallRuntimeRoomSlug,
} from "../lib/runtime-package-resolution.js";
import "./RoomCapturesPage.css";

// ---------------------------------------------------------------------------
// Room captures — every captured Trades Hall room, in the app.
//
// These are staged captures: real geometry, but no registry row vouches for
// them and no human has signed their alignment. The page says so, and marks
// per room whether the derived alignment is one the tool will stand behind —
// four of the eight sit at "review" today, and hiding that would defeat the
// point. Every room is listed here whatever its state: this is the console a
// reviewer uses to look.
//
// Admin-gated in production (router.tsx) because it is a review surface. It
// is NOT what keeps a misaligned room from the public — the public walk at
// /room/:slug is gated per room by data/room-walk-exposure.ts, a decision
// record that says whether a room's walk box can hold a visitor.
// ---------------------------------------------------------------------------

const VENUE_SLUG = "trades-hall";
const DEFAULT_ROOM: TradesHallRuntimeRoomSlug = "reception-room";

function displayName(slug: string): string {
  return TRADES_HALL_RUNTIME_ROOMS.find((room) => room.slug === slug)?.label ?? slug;
}

function isCapturedRoom(slug: string | undefined): slug is TradesHallRuntimeRoomSlug {
  return slug !== undefined && roomsWithSplatBundles().includes(slug);
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-GB");
}

interface SceneProps {
  readonly room: TradesHallRuntimeRoomSlug;
  readonly urls: readonly string[];
  readonly onTileLoad: (event: SparkSplatLoadEvent) => void;
  readonly onTileError: (event: SparkSplatErrorEvent) => void;
}

function CaptureScene({ room, urls, onTileLoad, onTileError }: SceneProps): ReactElement {
  // Derived from this capture's own room mesh, and meaningful only because THIS
  // staged capture is what is mounted — hence the explicit "staged" source.
  const transform = runtimeAssetViewTransformForRoom(room, "staged");
  const camera = runtimeAssetCameraViewForRoom(room, "staged");

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ powerPreference: "high-performance", antialias: false }}
      camera={{
        position: [...camera.position] as [number, number, number],
        fov: camera.fov,
        near: 0.1,
        far: 500,
      }}
      data-testid="room-captures-canvas"
    >
      <ambientLight intensity={1} />
      {urls.map((url) => (
        <SparkSplatLayer
          key={url}
          url={url}
          position={[...transform.position] as [number, number, number]}
          rotation={[...transform.rotation] as [number, number, number]}
          scale={transform.scale}
          onLoad={onTileLoad}
          onError={onTileError}
        />
      ))}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={camera.dampingFactor}
        target={[...camera.target] as [number, number, number]}
        minDistance={camera.minDistance}
        maxDistance={camera.maxDistance}
        panSpeed={camera.panSpeed}
        rotateSpeed={camera.rotateSpeed}
        zoomSpeed={camera.zoomSpeed}
        minPolarAngle={camera.minPolarAngle}
        maxPolarAngle={camera.maxPolarAngle}
      />
    </Canvas>
  );
}

export function RoomCapturesPage(): ReactElement {
  const params = useParams<{ venueSlug?: string; roomSlug?: string }>();
  const navigate = useNavigate();
  const room: TradesHallRuntimeRoomSlug = isCapturedRoom(params.roomSlug)
    ? params.roomSlug
    : DEFAULT_ROOM;

  const bundle = roomSplatBundle(room);
  const urls = useMemo(
    () => roomSplatTileUrls(room, import.meta.env.VITE_SPLAT_BASE_URL),
    [room],
  );

  // Tile results live in refs, never in the callbacks' dependency arrays.
  // SparkSplatLayer's load effect is keyed on the handler identities: a new
  // identity disposes the mesh and refetches the tile, so a progress counter
  // wired straight to state would refetch every tile on every completion.
  // See .claude/gotchas/spark-splat-layer-callback-identity.md.
  const resultsRef = useRef<Map<string, number>>(new Map());
  const failuresRef = useRef<Map<string, string>>(new Map());
  const [progress, setProgress] = useState({ loaded: 0, splats: 0, failed: 0 });

  const onTileLoad = useCallback((event: SparkSplatLoadEvent) => {
    resultsRef.current.set(event.url, event.splatCount);
  }, []);

  const onTileError = useCallback((event: SparkSplatErrorEvent) => {
    failuresRef.current.set(event.url, event.error.message);
  }, []);

  // Reset on room change, then poll the refs into state. The poll is what
  // re-renders; the handlers stay identity-stable for the life of the scene.
  useEffect(() => {
    resultsRef.current = new Map();
    failuresRef.current = new Map();
    setProgress({ loaded: 0, splats: 0, failed: 0 });

    const timer = setInterval(() => {
      let splats = 0;
      for (const count of resultsRef.current.values()) splats += count;
      setProgress({
        loaded: resultsRef.current.size,
        splats,
        failed: failuresRef.current.size,
      });
    }, 400);
    return () => { clearInterval(timer); };
  }, [room]);

  const total = urls.length;
  const settled = progress.loaded + progress.failed;
  const complete = total > 0 && settled >= total;

  return (
    <main className="captures">
      <header className="captures__head">
        <div>
          <h1 className="captures__title">Room captures</h1>
          <p className="captures__sub">
            Trades Hall of Glasgow — {String(roomsWithSplatBundles().length)} rooms captured with XGRIDS.
          </p>
        </div>
        <p className="captures__claim" data-testid="captures-claim">{STAGED_CAPTURE_STATUS}</p>
      </header>

      <div className="captures__body">
        <nav className="captures__rail" aria-label="Captured rooms">
          {roomsWithSplatBundles().map((slug) => {
            const entry = roomSplatBundle(slug);
            const active = slug === room;
            return (
              <button
                key={slug}
                type="button"
                className={`captures__room${active ? " captures__room--active" : ""}`}
                aria-current={active ? "true" : undefined}
                onClick={() => {
                  void navigate(`/venues/${params.venueSlug ?? VENUE_SLUG}/captures/${slug}`);
                }}
              >
                <span className="captures__roomName">{displayName(slug)}</span>
                <span className="captures__roomMeta">
                  {entry === null
                    ? "—"
                    : `${formatCount(roomSplatServedSplats(slug))} splats · ` +
                      `${formatMb(roomSplatServedBytes(slug))} · ` +
                      `${String(roomSplatServedTileCount(slug))} of ${String(entry.tiles.length)} tiles`}
                </span>
                <span className={`captures__badge captures__badge--${entry?.alignmentConfidence ?? "review"}`}>
                  {entry?.alignmentConfidence === "confident" ? "aligned" : "alignment under review"}
                </span>
              </button>
            );
          })}
        </nav>

        <section className="captures__stage" aria-label={`${displayName(room)} capture`}>
          <div className="captures__canvas">
            {total > 0
              ? (
                <CaptureScene
                  key={room}
                  room={room}
                  urls={urls}
                  onTileLoad={onTileLoad}
                  onTileError={onTileError}
                />
              )
              : <p className="captures__empty">No capture staged for this room.</p>}
          </div>

          <footer className="captures__status" data-testid="captures-status">
            <span>
              {complete
                ? `${formatCount(progress.splats)} splats across ${String(total)} tiles`
                : `Loading ${String(settled)}/${String(total)} tiles`}
            </span>
            {progress.failed > 0 && (
              <span className="captures__failed">{String(progress.failed)} tiles failed</span>
            )}
            {bundle !== null && <span className="captures__note">{bundle.alignmentNote}</span>}
          </footer>
        </section>
      </div>
    </main>
  );
}
