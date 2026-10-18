import { useEffect, useState, type ReactElement } from "react";
import { BellRing } from "lucide-react";
import type { PushDeviceKind } from "../../api/push.js";
import { readPushAlertsState, subscribeThisDevice, unsubscribeThisDevice, type PushAlertsState } from "../../lib/push-alerts.js";
import { ActivityIndicator } from "../shared/Activity.js";
import "./slot-requests.css";

// ---------------------------------------------------------------------------
// "Alerts on this device" (goal 19 S7): the one switch for web push. It says
// which of five states the device is in, in plain words, and what to do about
// the ones the person can change. Three events only, and the words say so.
// ---------------------------------------------------------------------------

export const PUSH_ALERTS_COPY = {
  on: "Alerts on this device: on",
  turnOn: "Turn on alerts on this device",
  turnOff: "Turn off",
  what: "A request landed for you, a request escalated to you, a reply to your request. Nothing else.",
  reading: "Checking this device…",
  working: "One moment…",
  denied: "Alerts are blocked for this site in the browser. Allow notifications for venviewer.com in the browser's site settings, then try again.",
  unsupported: "This browser cannot show alerts. On an iPhone, add Venviewer to the Home Screen from the Share menu and open it from there.",
  offServer: "Alerts are not switched on for this venue yet.",
  failed: "Could not change alerts on this device. Nothing changed.",
} as const;

export interface PushAlertsToggleProps {
  readonly venueId: string;
  readonly deviceKind: PushDeviceKind;
}

export function PushAlertsToggle({ venueId, deviceKind }: PushAlertsToggleProps): ReactElement {
  const [state, setState] = useState<PushAlertsState | "reading">("reading");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readPushAlertsState()
      .then((read) => { if (!cancelled) setState(read); })
      .catch(() => { if (!cancelled) setState("unsupported"); });
    return () => { cancelled = true; };
  }, []);

  const change = async (work: () => Promise<PushAlertsState>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    try {
      setState(await work());
    } catch (error: unknown) {
      setFailed(error instanceof Error && error.message.trim().length > 0 ? error.message : PUSH_ALERTS_COPY.failed);
    } finally {
      setBusy(false);
    }
  };

  const note = (text: string, alert = false): ReactElement => (
    <p className={`vv-push-alerts-note${alert ? " vv-request-error" : ""}`} role={alert ? "alert" : "status"}>{text}</p>
  );

  return (
    <div className="vv-push-alerts">
      {state === "reading" && note(PUSH_ALERTS_COPY.reading)}
      {state === "unsupported" && note(PUSH_ALERTS_COPY.unsupported)}
      {state === "off-server" && note(PUSH_ALERTS_COPY.offServer)}
      {state === "denied" && note(PUSH_ALERTS_COPY.denied)}
      {state === "off" && (
        <button
          type="button"
          className="vv-chime-toggle"
          aria-pressed={false}
          disabled={busy}
          aria-busy={busy}
          title={PUSH_ALERTS_COPY.what}
          onClick={() => { void change(() => subscribeThisDevice(venueId, deviceKind)); }}
        >
          {busy ? <ActivityIndicator size={16} /> : <BellRing size={16} aria-hidden="true" />}
          {busy ? PUSH_ALERTS_COPY.working : PUSH_ALERTS_COPY.turnOn}
        </button>
      )}
      {state === "on" && (
        <div className="vv-push-alerts-on">
          <span className="vv-push-alerts-state" role="status" title={PUSH_ALERTS_COPY.what}>
            <BellRing size={16} aria-hidden="true" /> {PUSH_ALERTS_COPY.on}
          </span>
          <button
            type="button"
            className="vv-request-action"
            disabled={busy}
            aria-busy={busy}
            onClick={() => { void change(() => unsubscribeThisDevice()); }}
          >
            {busy ? PUSH_ALERTS_COPY.working : PUSH_ALERTS_COPY.turnOff}
          </button>
        </div>
      )}
      {failed !== null && note(failed, true)}
    </div>
  );
}

export default PushAlertsToggle;
