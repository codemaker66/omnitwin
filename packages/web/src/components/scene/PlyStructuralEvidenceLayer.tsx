import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type { VisualLineagePlyMeshRuntimeStateV0 } from "@omnitwin/types";
import {
  FrontSide,
  MeshNormalMaterial,
  REVISION,
  type BufferGeometry,
} from "three";
import { parsePlyStructuralEvidence } from "../../lib/ply-structural-evidence.js";

const PINNED_THREE_VERSION = "0.180.0";
if (`0.${REVISION}.0` !== PINNED_THREE_VERSION) {
  throw new Error(`PLY structural evidence requires Three.js ${PINNED_THREE_VERSION}.`);
}

export interface PlyStructuralEvidenceLoadEvent {
  readonly url: string;
  readonly runtimeState: VisualLineagePlyMeshRuntimeStateV0;
}

export interface PlyStructuralEvidenceErrorEvent {
  readonly url: string;
  readonly error: Error;
}

interface PlyStructuralEvidenceLayerProps {
  readonly url: string;
  readonly onLoad: (event: PlyStructuralEvidenceLoadEvent) => void;
  readonly onError: (event: PlyStructuralEvidenceErrorEvent) => void;
}

interface LoadedPlyStructuralEvidence {
  readonly geometry: BufferGeometry;
  readonly event: PlyStructuralEvidenceLoadEvent;
}

function errorFromUnknown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function PostRenderLoadProbe({
  event,
  onLoad,
}: {
  readonly event: PlyStructuralEvidenceLoadEvent;
  readonly onLoad: (event: PlyStructuralEvidenceLoadEvent) => void;
}): null {
  const reported = useRef(false);
  useFrame(() => {
    if (reported.current) return;
    reported.current = true;
    queueMicrotask(() => {
      onLoad(event);
    });
  });
  return null;
}

/** Exact-byte structural PLY lane. It never crops, repairs, or changes source positions. */
export function PlyStructuralEvidenceLayer({
  url,
  onLoad,
  onError,
}: PlyStructuralEvidenceLayerProps): React.ReactElement | null {
  const [loaded, setLoaded] = useState<LoadedPlyStructuralEvidence | null>(null);
  const material = useMemo(() => new MeshNormalMaterial({
    flatShading: true,
    side: FrontSide,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    toneMapped: false,
  }), []);

  useEffect(() => () => {
    material.dispose();
  }, [material]);

  useEffect(() => {
    const controller = new AbortController();
    let ownedGeometry: BufferGeometry | null = null;
    setLoaded(null);

    void (async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
          credentials: "omit",
        });
        if (!response.ok) {
          throw new Error(`PLY structural source request failed with HTTP ${String(response.status)}.`);
        }
        const bytes = await response.arrayBuffer();
        const sourceSha256 = await sha256(bytes);
        const parsed = parsePlyStructuralEvidence(bytes);
        ownedGeometry = parsed.geometry;
        if (controller.signal.aborted) {
          ownedGeometry.dispose();
          ownedGeometry = null;
          return;
        }
        setLoaded({
          geometry: parsed.geometry,
          event: {
            url,
            runtimeState: {
              sourceSizeBytes: bytes.byteLength,
              sourceSha256,
              header: parsed.header,
              loader: {
                implementation: "three/addons/loaders/PLYLoader.js",
                version: PINNED_THREE_VERSION,
              },
              geometry: parsed.geometryState,
              material: {
                type: "MeshNormalMaterial",
                side: "FrontSide",
                flatShading: true,
                transparent: false,
                depthTest: true,
                depthWrite: true,
                toneMapped: false,
              },
              frustumCulled: true,
              provenance: {
                truthClass: "RECONSTRUCTED",
                byteTreatment: "source_bytes_unchanged",
                geometryRole: "structural_evidence_only",
                appearanceRole: "deterministic_debug_visualization_not_source_appearance",
                registrationAuthority: "inspection_only",
              },
            },
          },
        });
      } catch (error: unknown) {
        if (!controller.signal.aborted) onError({ url, error: errorFromUnknown(error) });
      }
    })();

    return () => {
      controller.abort();
      ownedGeometry?.dispose();
    };
  }, [onError, url]);

  return loaded === null
    ? null
    : (
      <>
        <mesh geometry={loaded.geometry} material={material} frustumCulled />
        <PostRenderLoadProbe
          key={loaded.event.runtimeState.sourceSha256}
          event={loaded.event}
          onLoad={onLoad}
        />
      </>
    );
}
