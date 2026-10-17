import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client.js";
import { fetchVisitorPlanPdf } from "../api/visitor-plan.js";
import { flushAutoSave } from "../components/editor/EditorBridge.js";
import { isLayoutTimelineMutationLocked } from "../lib/layout-timeline-preview-lock.js";
import {
  captureEditorSession,
  isCurrentEditorSession,
  useEditorStore,
  type EditorObject,
} from "../stores/editor-store.js";

// ---------------------------------------------------------------------------
// useVisitorPlanPdf — an anonymous organiser's plan as a file to send on.
//
// One action, with its consequence stated by the caller: save the latest
// change, ask the API for the PDF of this plan, and keep it on this device as
// a file. Nothing is emailed and nothing is published; the organiser decides
// who receives it (the phone's share sheet, or a download to attach).
//
// The PDF is drawn from the SAVED plan, so the autosave is flushed first. If
// the plan changes after the PDF was made, the result says so instead of
// offering an out-of-date file.
// ---------------------------------------------------------------------------

export type VisitorPlanPdfState =
  | { readonly phase: "idle" }
  | { readonly phase: "preparing" }
  | {
    readonly phase: "ready";
    readonly file: File;
    readonly url: string;
    readonly preparedAt: Date;
    /** What the PDF drew (see planDrawingSignature); a later edit makes it stale. */
    readonly drawnSignature: string;
  }
  | { readonly phase: "error"; readonly message: string };

type OwnedState = VisitorPlanPdfState & { readonly configId: string | null };

const IDLE: VisitorPlanPdfState = { phase: "idle" };

export interface VisitorPlanPdf {
  readonly state: VisitorPlanPdfState;
  /** True when the plan changed after the ready PDF was drawn. */
  readonly stale: boolean;
  /** True when this browser can hand the file to the system share sheet. */
  readonly canShareFile: boolean;
  /** A short line after a share attempt that did not go through, else null. */
  readonly shareNote: string | null;
  readonly prepare: () => void;
  readonly share: () => void;
}

/** "Grand Hall plan.pdf", the same name the API gives the file. */
export function visitorPlanFilename(roomName: string): string {
  const safe = roomName.replace(/[^A-Za-z0-9 -]/gu, "").replace(/\s+/gu, " ").trim();
  return `${safe === "" ? "Room" : safe} plan.pdf`;
}

/**
 * The parts of a plan the PDF draws: which item, where, which way round, how
 * large. Labels, cloths, notes and ids (a save can swap a draft id for the
 * stored one) are not drawn, so they do not make it stale.
 */
export function planDrawingSignature(objects: readonly EditorObject[]): string {
  return objects
    .map((o) => `${o.assetDefinitionId}:${String(o.positionX)}:${String(o.positionZ)}:${String(o.rotationY)}:${String(o.scale)}`)
    .sort()
    .join("|");
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

export function formatPreparedTime(at: Date): string {
  return at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export const VISITOR_PDF_UNSAVED_MESSAGE =
  "Your latest change hasn't saved, so the PDF would be out of date. Check the connection and try again.";
export const VISITOR_PDF_PREVIEW_MESSAGE =
  "Exit the room timeline preview, then prepare the PDF.";

export function visitorPlanPdfErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return "This plan isn't stored any more, so there is nothing to put in a PDF. Reload the page to start a new plan.";
    }
    if (error.status === 429) {
      // Every "no" offers a way forward: when to try again, and who to ask now.
      return "Several PDFs have been made from this connection in the last hour. Try again in an hour, or use Send to Events Team.";
    }
  }
  return "The PDF couldn't be prepared. Check the connection and try again, or use Send to Events Team.";
}

export const VISITOR_PDF_NO_FILE_SHARING =
  "This browser can't send files directly. Use Download, then attach the PDF to your message.";
const SHARE_FAILED = "Sending didn't start. Use Download, then attach the PDF to your message.";

function canShareFiles(data: ShareData): boolean {
  if (typeof navigator === "undefined" || !("canShare" in navigator)) return false;
  try {
    return navigator.canShare(data);
  } catch {
    return false;
  }
}

export function useVisitorPlanPdf(configId: string | null, roomName: string): VisitorPlanPdf {
  const objects = useEditorStore((s) => s.objects);
  const currentSignature = useMemo(() => planDrawingSignature(objects), [objects]);
  const [owned, setOwned] = useState<OwnedState>({ configId, ...IDLE });
  const [shareNote, setShareNote] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const operationRef = useRef(0);

  // A PDF belongs to the plan it was drawn from; another plan starts idle.
  const state: VisitorPlanPdfState = owned.configId === configId ? owned : IDLE;

  const releaseUrl = useCallback((): void => {
    if (urlRef.current !== null) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  // Leaving the plan (or the page) stops the request and frees the file.
  useEffect(() => () => {
    operationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    releaseUrl();
  }, [configId, releaseUrl]);

  const preparing = state.phase === "preparing";

  const prepare = useCallback((): void => {
    if (configId === null || preparing) return;
    // Pinned for the async work below: this request belongs to this plan.
    const planId: string = configId;
    setShareNote(null);
    if (isLayoutTimelineMutationLocked()) {
      setOwned({ configId: planId, phase: "error", message: VISITOR_PDF_PREVIEW_MESSAGE });
      return;
    }
    const operation = ++operationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const session = captureEditorSession();
    const isCurrent = (): boolean => operationRef.current === operation
      && session.configId === planId && isCurrentEditorSession(session);
    releaseUrl();
    setOwned({ configId: planId, phase: "preparing" });

    void (async () => {
      try {
        const saved = await flushAutoSave();
        if (!isCurrent()) return;
        if (!saved) {
          setOwned({ configId: planId, phase: "error", message: VISITOR_PDF_UNSAVED_MESSAGE });
          return;
        }
        const drawnSignature = planDrawingSignature(useEditorStore.getState().objects);
        const blob = await fetchVisitorPlanPdf(planId, controller.signal);
        if (!isCurrent()) return;
        const file = new File([blob], visitorPlanFilename(roomName), { type: "application/pdf" });
        const url = URL.createObjectURL(file);
        urlRef.current = url;
        setOwned({ configId: planId, phase: "ready", file, url, preparedAt: new Date(), drawnSignature });
      } catch (error) {
        if (!isCurrent()) return;
        setOwned({ configId: planId, phase: "error", message: visitorPlanPdfErrorMessage(error) });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    })();
  }, [configId, preparing, releaseUrl, roomName]);

  const readyFile = state.phase === "ready" ? state.file : null;
  const canShareFile = useMemo(
    () => readyFile !== null && canShareFiles({ files: [readyFile] }),
    [readyFile],
  );

  const share = useCallback((): void => {
    if (readyFile === null) return;
    const data: ShareData = { files: [readyFile], title: readyFile.name.replace(/\.pdf$/u, "") };
    if (!canShareFiles(data)) {
      setShareNote(VISITOR_PDF_NO_FILE_SHARING);
      return;
    }
    navigator.share(data).then(
      () => { setShareNote(null); },
      (error: unknown) => {
        // Closing the share sheet is a choice, not a failure.
        if (error instanceof DOMException && error.name === "AbortError") return;
        setShareNote(SHARE_FAILED);
      },
    );
  }, [readyFile]);

  return {
    state,
    stale: state.phase === "ready" && state.drawnSignature !== currentSignature,
    canShareFile,
    shareNote,
    prepare,
    share,
  };
}
