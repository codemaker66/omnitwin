import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { LivingHallPage } from "./LivingHallPage.js";
import {
  selectReceptionLocalPreflight,
  type ReceptionLocalPreflightCandidateId,
} from "./reception-local-preflight.js";
import {
  parseExperimentalReceptionCamera,
  resolveReceptionReviewView,
} from "./reception-experimental-camera.js";

const CAPTURE_QUERY_KEYS = new Set([
  "candidate", "camera", "lookAt", "up", "fov", "experimentalViewId",
  "capture", "captureNonce",
]);
const SAFE_CAPTURE_NONCE = /^[a-z0-9][a-z0-9._-]{0,95}$/u;

export interface ReceptionCapturePageRequest {
  readonly candidateId: ReceptionLocalPreflightCandidateId;
  readonly captureNonce: string;
  readonly reviewView: NonNullable<ReturnType<typeof parseExperimentalReceptionCamera>>;
}

export function parseReceptionCapturePageRequest(
  searchParams: URLSearchParams,
): ReceptionCapturePageRequest | null {
  if ([...searchParams.keys()].some((key) => !CAPTURE_QUERY_KEYS.has(key))) return null;
  if (searchParams.getAll("capture").length !== 1 || searchParams.get("capture") !== "1") return null;
  const candidates = searchParams.getAll("candidate");
  const nonces = searchParams.getAll("captureNonce");
  if (candidates.length !== 1 || nonces.length !== 1) return null;
  const candidateId = candidates[0];
  const captureNonce = nonces[0];
  const reviewView = parseExperimentalReceptionCamera(searchParams);
  if ((candidateId !== "quality" && candidateId !== "mobile")
    || captureNonce === undefined || !SAFE_CAPTURE_NONCE.test(captureNonce)
    || reviewView === null) return null;
  return { candidateId, captureNonce, reviewView };
}

/** Development-only shell for matched real-component computer-vision inputs. */
export function LivingHallLocalPreflightPage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const captureRequested = searchParams.has("capture") || searchParams.has("captureNonce");
  const captureRequest = useMemo(
    () => captureRequested ? parseReceptionCapturePageRequest(searchParams) : null,
    [captureRequested, searchParams],
  );
  const candidateId: ReceptionLocalPreflightCandidateId = captureRequest?.candidateId
    ?? (searchParams.get("candidate") === "mobile" ? "mobile" : "quality");
  const reviewView = captureRequest?.reviewView ?? resolveReceptionReviewView(searchParams);
  const selection = useMemo(
    () => selectReceptionLocalPreflight(candidateId, reviewView),
    [candidateId, reviewView],
  );

  if (captureRequested && captureRequest === null) {
    return <main data-reception-capture-state="rejected">Capture request rejected.</main>;
  }

  return (
    <LivingHallPage
      key={`${candidateId}:${reviewView.id}`}
      localPreflight={selection}
      localCaptureOnly={captureRequest !== null}
      localCaptureNonce={captureRequest?.captureNonce ?? null}
    />
  );
}
