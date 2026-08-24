import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { Group } from "three";
import {
  clearDollhouse,
  DollhouseStage,
  type DollhouseStageProps,
} from "./DollhouseStage.js";
import { LocalEvidenceStageErrorBoundary } from "./LocalEvidenceStageErrorBoundary.js";
import { disposeOwnedLocalDollhouseScene } from "./local-evidence-dollhouse-resources.js";

const MAX_LOCAL_DOLLHOUSE_BYTES = 64 * 1024 * 1024;

export type LocalEvidenceDollhouseStageProps = Omit<DollhouseStageProps, "meshUrl"> & {
  /** Token-bearing loopback lease. It is consumed only by the caught fetch
   * below and is never handed to useGLTF, Suspense, an Error, or the DOM. */
  readonly sourceUrl: string;
  readonly onError: () => void;
};

interface BlobLease {
  readonly sourceUrl: string;
  readonly blobUrl: string;
}

interface OwnedScene {
  readonly blobUrl: string;
  readonly scene: Group;
}

/**
 * Converts a local evidence GLB lease into an opaque browser-owned URL before
 * Three enters the picture. Fetch/HTTP/body failures are caught here, while a
 * later decoder failure can mention only the `blob:` URL in React's console.
 */
export function LocalEvidenceDollhouseStage({
  sourceUrl,
  onError,
  ...stageProps
}: LocalEvidenceDollhouseStageProps): ReactElement | null {
  const [lease, setLease] = useState<BlobLease | null>(null);
  const onErrorRef = useRef(onError);
  const ownedSceneRef = useRef<OwnedScene | null>(null);
  onErrorRef.current = onError;

  const captureOwnedScene = useCallback((blobUrl: string, scene: Group): void => {
    ownedSceneRef.current = { blobUrl, scene };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let released = false;
    let ownedBlobUrl: string | null = null;

    const fail = (): void => {
      if (!disposed && !controller.signal.aborted) {
        onErrorRef.current();
      }
    };

    const load = async (): Promise<void> => {
      try {
        const response = await fetch(sourceUrl, {
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (!response.ok || response.redirected) {
          fail();
          return;
        }
        const declaredLength = response.headers.get("content-length");
        if (declaredLength !== null) {
          const parsedLength = Number(declaredLength);
          if (
            !Number.isSafeInteger(parsedLength) ||
            parsedLength < 0 ||
            parsedLength > MAX_LOCAL_DOLLHOUSE_BYTES
          ) {
            fail();
            return;
          }
        }
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOCAL_DOLLHOUSE_BYTES) {
          fail();
          return;
        }
        if (disposed || controller.signal.aborted) {
          return;
        }
        ownedBlobUrl = URL.createObjectURL(
          new Blob([bytes], { type: "model/gltf-binary" }),
        );
        setLease({ sourceUrl, blobUrl: ownedBlobUrl });
      } catch {
        // Deliberately discard the raw failure: browser/network errors may
        // contain the ephemeral source URL. The parent renders fixed copy.
        fail();
      }
    };

    void load();
    return () => {
      if (released) {
        return;
      }
      released = true;
      disposed = true;
      controller.abort();
      if (ownedBlobUrl !== null) {
        clearDollhouse(ownedBlobUrl);
        const ownedScene = ownedSceneRef.current;
        if (ownedScene?.blobUrl === ownedBlobUrl) {
          disposeOwnedLocalDollhouseScene(ownedScene.scene);
          ownedSceneRef.current = null;
        }
        URL.revokeObjectURL(ownedBlobUrl);
      }
    };
  }, [sourceUrl]);

  const blobUrl = lease?.sourceUrl === sourceUrl ? lease.blobUrl : null;
  if (blobUrl === null) {
    return null;
  }

  return (
    <LocalEvidenceStageErrorBoundary resetKey={blobUrl} onError={onError}>
      <DollhouseStage
        {...stageProps}
        meshUrl={blobUrl}
        onOwnedSceneReady={captureOwnedScene}
      />
    </LocalEvidenceStageErrorBoundary>
  );
}
