import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Whether this browser has a network, from `navigator.onLine` and the
// window's `online`/`offline` events.
//
// `false` is reliable (no network at all); `true` only means "maybe": a
// captive portal or a dead server still fail as a network error while online.
// So a surface may say "offline" on `false`, and must never say "saved" on
// `true` alone. The v2 slate (#167) carries the shared module
// `lib/online-status.ts`; until it lands on master the v1 header reads this.
// ---------------------------------------------------------------------------

function browserSaysOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(browserSaysOnline);
  useEffect(() => {
    const onOnline = (): void => { setOnline(true); };
    const onOffline = (): void => { setOnline(false); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    // An event may have fired between the first render and this effect.
    setOnline(browserSaysOnline());
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);
  return online;
}
