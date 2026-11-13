import { useSyncExternalStore } from "react";
import { readOnlineStatus, subscribeOnlineStatus } from "../lib/online-status.js";

function subscribe(onChange: () => void): () => void {
  return subscribeOnlineStatus(() => { onChange(); });
}

/** Whether the browser has a network, kept current from its online/offline events. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, readOnlineStatus, () => true);
}
