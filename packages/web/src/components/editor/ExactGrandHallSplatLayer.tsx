import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { SplatMesh } from "@sparkjsdev/spark";
import type { GrandHallRoomOnlyVisualMemberV2 } from "@omnitwin/types";
import type { VerifiedRuntimePackagePreview } from "../../api/runtime-package-preview-transport.js";
import {
  fetchRuntimePackagePreviewMetadata,
  fetchVerifiedRuntimePackagePreviewMember,
} from "../../api/runtime-package-preview-transport.js";
import {
  validateGrandHallCapturedPreview,
} from "../../lib/grand-hall-captured-source.js";
import {
  beginExactGrandHallLoadDeadline,
  type ExactGrandHallLoadDeadline,
} from "../../lib/exact-grand-hall-load-deadline.js";
import type { RuntimeAssetViewTransform } from "../../lib/runtime-package-resolution.js";
import { SparkRendererHost } from "../scene/SparkSplatLayer.js";

interface MutableVector3 {
  set: (x: number, y: number, z: number) => unknown;
}

export interface ExactGrandHallMesh {
  visible: boolean;
  opacity: number;
  readonly position: MutableVector3;
  readonly rotation: MutableVector3;
  readonly scale: { setScalar: (value: number) => unknown };
  readonly initialized: Promise<ExactGrandHallMesh>;
  readonly numSplats: number;
  dispose: () => void;
}

export interface ExactGrandHallResource {
  readonly runtimePackageId: string;
  readonly meshes: readonly ExactGrandHallMesh[];
  readonly memberNames: readonly string[];
  readonly splatCount: number;
}

export interface ExactGrandHallSplatLayerProps {
  readonly runtimePackageId: string;
  readonly transform: RuntimeAssetViewTransform;
  readonly active: boolean;
  readonly onChunkLoaded?: (memberName: string) => void;
  readonly onChunkFailed?: (memberName: string) => void;
  /** Receives the immutable accepted inventory before protected member reads. */
  readonly onAdmission?: (summary: ExactGrandHallAdmissionSummary) => void;
  /** Fires after React atomically attaches the complete accepted inventory. */
  readonly onReady?: () => void;
  /** Fires only for a terminal fetch, verification, or decode failure. */
  readonly onFailed?: () => void;
}

export interface ExactGrandHallAdmissionSummary {
  readonly memberNames: readonly string[];
  readonly totalBytes: number;
  readonly totalGaussianCount: number;
}

type ExactGrandHallCallbacks = Pick<
  ExactGrandHallSplatLayerProps,
  "onChunkLoaded" | "onChunkFailed" | "onAdmission" | "onReady" | "onFailed"
>;

interface ReadyNotification {
  readonly resource: ExactGrandHallResource;
  readonly callbacks: ExactGrandHallCallbacks;
  readonly deadline: ExactGrandHallLoadDeadline;
  readonly requestId: number;
}

type ExactGrandHallMeshFactory = (
  member: VerifiedRuntimePackagePreview["members"][number],
  expected: GrandHallRoomOnlyVisualMemberV2,
) => ExactGrandHallMesh;

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

/**
 * Admit the exact evidence-bound cropped inventory before requesting any
 * protected member bytes, then fetch each through the request auth boundary.
 */
async function fetchExactGrandHallPreview(
  runtimePackageId: string,
  signal: AbortSignal,
  onAdmission?: (summary: ExactGrandHallAdmissionSummary) => void,
): Promise<VerifiedRuntimePackagePreview> {
  const preview = await fetchRuntimePackagePreviewMetadata(runtimePackageId, signal);
  const admission = validateGrandHallCapturedPreview(preview);
  if (!admission.ok) {
    throw new Error("The exact Grand Hall preview metadata failed its room-only evidence contract.");
  }
  onAdmission?.({
    memberNames: admission.evidence.croppedVisual.members.map((member) => member.fileName),
    totalBytes: admission.evidence.croppedVisual.totalBytes,
    totalGaussianCount: admission.evidence.croppedVisual.totalGaussianCount,
  });

  const members: VerifiedRuntimePackagePreview["members"][number][] = [];
  for (let index = 0; index < admission.evidence.croppedVisual.members.length; index += 1) {
    throwIfAborted(signal);
    members.push(await fetchVerifiedRuntimePackagePreviewMember(preview, index, signal));
  }
  throwIfAborted(signal);
  return { preview, members };
}

async function awaitInitialization(
  mesh: ExactGrandHallMesh,
  signal: AbortSignal,
): Promise<ExactGrandHallMesh> {
  throwIfAborted(signal);
  return new Promise<ExactGrandHallMesh>((resolve, reject) => {
    let settled = false;
    const settle = (next: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      next();
    };
    const onAbort = (): void => { settle(() => { reject(abortError()); }); };
    signal.addEventListener("abort", onAbort, { once: true });
    void mesh.initialized.then(
      (initialized) => { settle(() => { resolve(initialized); }); },
      (error: unknown) => {
        settle(() => {
          reject(error instanceof Error
            ? error
            : new Error("The exact Grand Hall capture could not initialize."));
        });
      },
    );
  });
}

function applyTransform(
  mesh: ExactGrandHallMesh,
  transform: RuntimeAssetViewTransform,
): void {
  mesh.position.set(...transform.position);
  mesh.rotation.set(...transform.rotation);
  mesh.scale.setScalar(transform.scale);
}

export function disposeExactGrandHallResource(resource: ExactGrandHallResource | null): void {
  if (resource === null) return;
  for (const mesh of new Set(resource.meshes)) {
    mesh.visible = false;
    mesh.opacity = 0;
    mesh.dispose();
  }
}

/**
 * Decode the verified cropped output while every mesh remains invisible and
 * detached. The resource returns only when all admitted members decode to
 * their evidence-bound Gaussian counts; any mismatch disposes the whole set.
 */
export async function decodeExactGrandHallResource(
  verified: VerifiedRuntimePackagePreview,
  transform: RuntimeAssetViewTransform,
  signal: AbortSignal,
  createMesh: ExactGrandHallMeshFactory = (member, expected) => new SplatMesh({
    fileBytes: member.bytes,
    fileName: member.fileName,
    maxSplats: expected.gaussianCount + 1,
    editable: false,
    raycastable: false,
  }),
): Promise<ExactGrandHallResource> {
  const admission = validateGrandHallCapturedPreview(verified.preview);
  if (
    !admission.ok
    || verified.members.length !== admission.evidence.croppedVisual.members.length
  ) {
    throw new Error("The exact Grand Hall capture failed its room-only evidence contract.");
  }

  const meshes: ExactGrandHallMesh[] = [];
  let splatCount = 0;
  try {
    for (let index = 0; index < verified.members.length; index += 1) {
      throwIfAborted(signal);
      const member = verified.members[index];
      const expected = admission.evidence.croppedVisual.members[index];
      if (
        member === undefined
        || expected === undefined
        || member.fileName !== expected.fileName
        || member.sizeBytes !== expected.sizeBytes
        || member.sha256 !== expected.sha256
        || member.bytes.byteLength !== expected.sizeBytes
      ) {
        throw new Error("The exact Grand Hall member bytes do not match the admitted inventory.");
      }

      const mesh = createMesh(member, expected);
      mesh.visible = false;
      mesh.opacity = 0;
      applyTransform(mesh, transform);
      meshes.push(mesh);
      const initialized = await awaitInitialization(mesh, signal);
      if (initialized !== mesh || mesh.numSplats !== expected.gaussianCount) {
        throw new Error("The exact Grand Hall member decoded to a different Gaussian count.");
      }
      splatCount += mesh.numSplats;
    }
    throwIfAborted(signal);
    if (splatCount !== admission.evidence.croppedVisual.totalGaussianCount) {
      throw new Error("The exact Grand Hall crop decoded to a different Gaussian total.");
    }
    return {
      runtimePackageId: verified.preview.runtimePackageId,
      meshes,
      memberNames: admission.evidence.croppedVisual.members.map((member) => member.fileName),
      splatCount,
    };
  } catch (error: unknown) {
    disposeExactGrandHallResource({
      runtimePackageId: verified.preview.runtimePackageId,
      meshes,
      memberNames: admission.evidence.croppedVisual.members.map((member) => member.fileName),
      splatCount,
    });
    throw error;
  }
}

function setResourceActive(resource: ExactGrandHallResource | null, active: boolean): void {
  if (resource === null) return;
  for (const mesh of resource.meshes) {
    mesh.opacity = active ? 1 : 0;
    mesh.visible = active;
  }
}

/**
 * Authenticated, receipt-verified, all-or-nothing Grand Hall renderer. No
 * member enters the scene until the complete admitted crop has fetched, hashed,
 * and decoded successfully.
 */
export function ExactGrandHallSplatLayer({
  runtimePackageId,
  transform,
  active,
  onChunkLoaded,
  onChunkFailed,
  onAdmission,
  onReady,
  onFailed,
}: ExactGrandHallSplatLayerProps): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  const [resource, setResource] = useState<ExactGrandHallResource | null>(null);
  const resourceRef = useRef<ExactGrandHallResource | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const callbacksRef = useRef<ExactGrandHallCallbacks>({
    onChunkLoaded,
    onChunkFailed,
    onAdmission,
    onReady,
    onFailed,
  });
  callbacksRef.current = { onChunkLoaded, onChunkFailed, onAdmission, onReady, onFailed };
  const readyNotificationRef = useRef<ReadyNotification | null>(null);
  const requestIdRef = useRef(0);
  const expectedMemberNamesRef = useRef<readonly string[]>([]);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    let disposed = false;
    let terminal = false;
    let deadline: ExactGrandHallLoadDeadline | null = null;
    const requestCallbacks = callbacksRef.current;
    const reportTerminalFailure = (): void => {
      if (disposed || terminal || requestIdRef.current !== requestId) return;
      terminal = true;
      deadline?.cancel();
      readyNotificationRef.current = null;
      disposeExactGrandHallResource(resourceRef.current);
      resourceRef.current = null;
      setResource(null);
      for (const memberName of expectedMemberNamesRef.current) {
        requestCallbacks.onChunkFailed?.(memberName);
      }
      requestCallbacks.onFailed?.();
      invalidate();
    };
    const loadDeadline = beginExactGrandHallLoadDeadline(reportTerminalFailure);
    deadline = loadDeadline;
    setResource(null);
    readyNotificationRef.current = null;
    disposeExactGrandHallResource(resourceRef.current);
    resourceRef.current = null;
    expectedMemberNamesRef.current = [];
    invalidate();

    void fetchExactGrandHallPreview(
      runtimePackageId,
      loadDeadline.signal,
      requestCallbacks.onAdmission,
    )
      .then((verified) => {
        const admission = validateGrandHallCapturedPreview(verified.preview);
        expectedMemberNamesRef.current = admission.ok
          ? admission.evidence.croppedVisual.members.map((member) => member.fileName)
          : [];
        return decodeExactGrandHallResource(verified, transform, loadDeadline.signal);
      })
      .then((decoded) => {
        if (disposed || terminal || loadDeadline.signal.aborted || requestIdRef.current !== requestId) {
          disposeExactGrandHallResource(decoded);
          return;
        }
        resourceRef.current = decoded;
        setResourceActive(decoded, activeRef.current);
        readyNotificationRef.current = {
          resource: decoded,
          callbacks: requestCallbacks,
          deadline: loadDeadline,
          requestId,
        };
        setResource(decoded);
        invalidate();
      })
      .catch(() => {
        if (disposed || loadDeadline.signal.aborted) return;
        reportTerminalFailure();
      });

    return () => {
      disposed = true;
      loadDeadline.cancel();
      readyNotificationRef.current = null;
      disposeExactGrandHallResource(resourceRef.current);
      resourceRef.current = null;
    };
  }, [invalidate, runtimePackageId, transform]);

  useLayoutEffect(() => {
    if (resource === null || resource.runtimePackageId !== runtimePackageId) return;
    const notification = readyNotificationRef.current;
    if (
      notification === null
      || notification.resource !== resource
      || notification.requestId !== requestIdRef.current
      || notification.deadline.signal.aborted
    ) return;
    readyNotificationRef.current = null;
    notification.deadline.complete();
    for (const memberName of resource.memberNames) {
      notification.callbacks.onChunkLoaded?.(memberName);
    }
    notification.callbacks.onReady?.();
  }, [resource, runtimePackageId]);

  useEffect(() => {
    setResourceActive(resourceRef.current, active);
    invalidate();
  }, [active, invalidate]);

  if (resource === null || resource.runtimePackageId !== runtimePackageId) return null;
  return (
    <>
      {/* The supplied LCC2 manifest declares sortingMethod=depth. */}
      <SparkRendererHost sortRadial={false} />
      {resource.meshes.map((mesh, index) => (
        <primitive
          key={`${resource.runtimePackageId}:${resource.memberNames[index] ?? String(index)}`}
          object={mesh}
        />
      ))}
    </>
  );
}
