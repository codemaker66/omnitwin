import { useEffect, useRef, useState, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { AdditiveBlending, DoubleSide } from "three";
import { useCockpitStore, type CockpitBeam } from "../../stores/cockpit-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";

// ---------------------------------------------------------------------------
// CockpitEvidenceBeam — the evidence→scene beam.
//
// When a simulated conflict / review marker is hovered or focused, the cockpit
// store raises a world-anchored beam. This renders it as a soft light column
// from floor to ceiling at the exact point, plus a ground ring and a SAFE
// caption — making abstract review evidence spatial and legible. The beam eases
// in/out and honours prefers-reduced-motion.
// ---------------------------------------------------------------------------

const EASE = 0.16;
const SNAP = 0.01;
const REVIEW_COLOR = "#e0654f";
const INFO_COLOR = "#c9a84c";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function beamColor(tone: CockpitBeam["tone"]): string {
  return tone === "review" ? REVIEW_COLOR : INFO_COLOR;
}

export function CockpitEvidenceBeam(): ReactElement | null {
  const beam = useCockpitStore((state) => state.beam);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const invalidate = useThree((state) => state.invalidate);
  const [intensity, setIntensity] = useState(0);
  const intensityRef = useRef(0);
  const lastBeamRef = useRef<CockpitBeam | null>(null);

  if (beam !== null) lastBeamRef.current = beam;

  useEffect(() => {
    const target = beam !== null ? 1 : 0;
    if (prefersReducedMotion()) {
      intensityRef.current = target;
      setIntensity(target);
      invalidate();
      return;
    }
    let raf = 0;
    const step = (): void => {
      const current = intensityRef.current;
      const delta = target - current;
      if (Math.abs(delta) <= SNAP) {
        intensityRef.current = target;
        setIntensity(target);
        invalidate();
        return;
      }
      const next = current + delta * EASE;
      intensityRef.current = next;
      setIntensity(next);
      invalidate();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); };
  }, [beam, invalidate]);

  const active = lastBeamRef.current;
  if (active === null) return null;
  if (beam === null && intensity <= 0.002) return null;

  const color = beamColor(active.tone);
  const height = Math.max(2, dimensions.height);
  const [x, , z] = active.anchor;

  return (
    <group name="cockpit-evidence-beam" position={[x, 0, z]} renderOrder={6}>
      {/* Light column */}
      <mesh position={[0, height / 2, 0]} renderOrder={6}>
        <cylinderGeometry args={[0.28, 0.42, height, 20, 1, true]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.18 * intensity}
          blending={AdditiveBlending}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      {/* Ground ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} renderOrder={6}>
        <ringGeometry args={[0.62, 0.92, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.8 * intensity}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      <group position={[0, height + 0.4, 0]}>
        <Html center>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: 8,
              background: "rgba(14, 12, 9, 0.92)",
              border: `1px solid ${color}`,
              color: "#fdf6e7",
              font: "600 11px/1.3 'Inter', system-ui, sans-serif",
              maxWidth: 220,
              display: "inline-block",
              textAlign: "center",
              opacity: intensity,
              pointerEvents: "none",
              boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
            }}
          >
            {active.label}
          </span>
        </Html>
      </group>
    </group>
  );
}
