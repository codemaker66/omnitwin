import { useCallback, useEffect, useState } from "react";
import type { ClientHome } from "@omnitwin/types";
import { ApiError } from "../api/client.js";
import { getClientHome } from "../api/client-home.js";
import { useAuthStore } from "../stores/auth-store.js";

export type ClientHomeStatus = "loading" | "loaded" | "error" | "sign-in-required";

export interface ClientHomeResult {
  readonly status: ClientHomeStatus;
  readonly data: ClientHome | null;
  readonly refresh: () => void;
}

interface Held {
  /** The account and request the answer belongs to. */
  readonly key: string;
  readonly status: Exclude<ClientHomeStatus, "loading">;
  readonly data: ClientHome | null;
}

/**
 * The signed-in person's own events and plans. An answer is held against the
 * account that asked, so a sign-out or a switch of account never shows one
 * person's work to the next; while a new answer is on its way the page says
 * it is loading rather than keep the old one.
 */
export function useClientHome(): ClientHomeResult {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const isLoading = useAuthStore((state) => state.isLoading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [revision, setRevision] = useState(0);
  const [held, setHeld] = useState<Held | null>(null);
  const refresh = useCallback(() => { setRevision((value) => value + 1); }, []);
  const key = JSON.stringify([userId, revision]);
  const signedOut = !isLoading && (!isAuthenticated || userId === null);

  useEffect(() => {
    if (isLoading || signedOut) return;
    const controller = new AbortController();
    void getClientHome(controller.signal).then((data) => {
      if (!controller.signal.aborted) setHeld({ key, status: "loaded", data });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setHeld({ key, status: error instanceof ApiError && error.status === 401 ? "sign-in-required" : "error", data: null });
    });
    return () => { controller.abort(); };
  }, [isLoading, key, signedOut]);

  if (signedOut) return { status: "sign-in-required", data: null, refresh };
  if (isLoading || held === null || held.key !== key) return { status: "loading", data: null, refresh };
  return { status: held.status, data: held.data, refresh };
}
