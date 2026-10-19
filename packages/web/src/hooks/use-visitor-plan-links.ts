import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanViewLink } from "@omnitwin/types";
import { ApiError } from "../api/client.js";
import {
  createPlanViewLink,
  listPlanViewLinks,
  planViewPageUrl,
  stopPlanViewLink,
} from "../api/plan-view.js";
import { flushAutoSave } from "../components/editor/EditorBridge.js";
import { isLayoutTimelineMutationLocked } from "../lib/layout-timeline-preview-lock.js";
import { captureEditorSession, isCurrentEditorSession } from "../stores/editor-store.js";

// ---------------------------------------------------------------------------
// useVisitorPlanLinks — view-only links to an anonymous organiser's plan
// (fix-first item 11).
//
// "Copy a view-only link" saves the latest change, asks the API for a new
// link and puts it on the clipboard. The link is shown here once: the API
// keeps only its hash, so once this view closes it cannot be shown again
// (another can always be made). The organiser's working links are listed
// with when each was made and when it stops, and any of them can be stopped.
//
// The link reads the SAVED plan, live: whoever opens it later sees later
// changes too, never prices, and can never change anything.
// ---------------------------------------------------------------------------

export type PlanLinkState =
  | { readonly phase: "idle" }
  | { readonly phase: "making" }
  | {
    readonly phase: "made";
    readonly linkId: string;
    readonly url: string;
    readonly expiresAt: string;
    /** Whether the link reached the clipboard; when not, it is shown to copy by hand. */
    readonly copied: boolean;
  }
  | { readonly phase: "error"; readonly message: string };

export type PlanLinkListState =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly links: readonly PlanViewLink[] }
  | { readonly phase: "error" };

export interface VisitorPlanLinks {
  readonly state: PlanLinkState;
  readonly list: PlanLinkListState;
  /** The link being stopped, if any. */
  readonly stoppingId: string | null;
  /** A short line after stopping a link, or after a stop that failed. */
  readonly stopNote: string | null;
  readonly make: () => void;
  readonly copyAgain: () => void;
  readonly stop: (linkId: string) => void;
  readonly reloadList: () => void;
}

export const PLAN_LINK_UNSAVED_MESSAGE =
  "Your latest change hasn't saved, so the link would show an older plan. Check the connection and try again.";
export const PLAN_LINK_PREVIEW_MESSAGE = "Exit the room timeline preview, then make the link.";
export const PLAN_LINK_STOPPED_NOTE = "Stopped. Anyone holding that link now sees that it no longer works.";
export const PLAN_LINK_STOP_FAILED_NOTE = "That link couldn't be stopped. Check the connection and try again.";

export function planLinkErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return "This plan isn't stored any more, so there is nothing to link to. Reload the page to start a new plan.";
    }
    if (error.status === 409 && error.code === "VIEW_LINK_LIMIT") {
      return "This plan already has five working links. Stop one below to make another.";
    }
    if (error.status === 429) {
      return "Several links have been made from this connection in the last hour. Try again in an hour, or send the PDF instead.";
    }
  }
  return "The link couldn't be made. Check the connection and try again, or send the PDF instead.";
}

/** "17 Oct, 14:02" in the organiser's own clock. */
export function formatLinkMade(iso: string): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${day}, ${time}`;
}

/** "16 November" (with the year when it is not this one). */
export function formatLinkUntil(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  return at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !("clipboard" in navigator)) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type Owned<T> = T & { readonly configId: string | null };

const IDLE: PlanLinkState = { phase: "idle" };
const LOADING: PlanLinkListState = { phase: "loading" };

export function useVisitorPlanLinks(configId: string | null): VisitorPlanLinks {
  const [owned, setOwned] = useState<Owned<PlanLinkState>>({ configId, ...IDLE });
  const [ownedList, setOwnedList] = useState<Owned<PlanLinkListState>>({ configId, ...LOADING });
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [stopNote, setStopNote] = useState<string | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const operationRef = useRef(0);

  // Links belong to the plan they were made for; another plan starts afresh.
  const state: PlanLinkState = owned.configId === configId ? owned : IDLE;
  const list: PlanLinkListState = ownedList.configId === configId ? ownedList : LOADING;

  useEffect(() => () => { operationRef.current += 1; }, [configId]);

  useEffect(() => {
    if (configId === null) return undefined;
    const controller = new AbortController();
    const planId: string = configId;
    listPlanViewLinks(planId, controller.signal).then(
      (links) => { if (!controller.signal.aborted) setOwnedList({ configId: planId, phase: "ready", links }); },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        // A plan that is not stored has no links; making one will say why.
        if (error instanceof ApiError && error.status === 404) {
          setOwnedList({ configId: planId, phase: "ready", links: [] });
          return;
        }
        setOwnedList({ configId: planId, phase: "error" });
      },
    );
    return () => { controller.abort(); };
  }, [configId, listVersion]);

  const reloadList = useCallback((): void => { setListVersion((version) => version + 1); }, []);

  const making = state.phase === "making";

  const make = useCallback((): void => {
    if (configId === null || making) return;
    const planId: string = configId;
    setStopNote(null);
    if (isLayoutTimelineMutationLocked()) {
      setOwned({ configId: planId, phase: "error", message: PLAN_LINK_PREVIEW_MESSAGE });
      return;
    }
    const operation = ++operationRef.current;
    const session = captureEditorSession();
    const isCurrent = (): boolean => operationRef.current === operation
      && session.configId === planId && isCurrentEditorSession(session);
    setOwned({ configId: planId, phase: "making" });

    void (async () => {
      try {
        const saved = await flushAutoSave();
        if (!isCurrent()) return;
        if (!saved) {
          setOwned({ configId: planId, phase: "error", message: PLAN_LINK_UNSAVED_MESSAGE });
          return;
        }
        const link = await createPlanViewLink(planId);
        if (!isCurrent()) return;
        const url = planViewPageUrl(link.token);
        const copied = await copyText(url);
        if (!isCurrent()) return;
        setOwned({ configId: planId, phase: "made", linkId: link.id, url, expiresAt: link.expiresAt, copied });
        setListVersion((version) => version + 1);
      } catch (error) {
        if (!isCurrent()) return;
        setOwned({ configId: planId, phase: "error", message: planLinkErrorMessage(error) });
      }
    })();
  }, [configId, making]);

  const madeUrl = state.phase === "made" ? state.url : null;
  const copyAgain = useCallback((): void => {
    if (madeUrl === null || configId === null) return;
    const planId: string = configId;
    void copyText(madeUrl).then((copied) => {
      setOwned((current) => current.configId === planId && current.phase === "made" && current.url === madeUrl
        ? { ...current, copied }
        : current);
    });
  }, [configId, madeUrl]);

  const stop = useCallback((linkId: string): void => {
    if (configId === null || stoppingId !== null) return;
    const planId: string = configId;
    setStoppingId(linkId);
    setStopNote(null);
    stopPlanViewLink(planId, linkId).then(
      () => {
        setStoppingId(null);
        setStopNote(PLAN_LINK_STOPPED_NOTE);
        // The link just made is no longer one to copy.
        setOwned((current) => current.configId === planId && current.phase === "made" && current.linkId === linkId
          ? { configId: planId, phase: "idle" }
          : current);
        setOwnedList((current) => current.configId === planId && current.phase === "ready"
          ? { ...current, links: current.links.filter((link) => link.id !== linkId) }
          : current);
      },
      () => {
        setStoppingId(null);
        setStopNote(PLAN_LINK_STOP_FAILED_NOTE);
      },
    );
  }, [configId, stoppingId]);

  return { state, list, stoppingId, stopNote, make, copyAgain, stop, reloadList };
}
