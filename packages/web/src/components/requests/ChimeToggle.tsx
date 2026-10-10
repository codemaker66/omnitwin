import { useSyncExternalStore, type ReactElement } from "react";
import { Bell, BellOff } from "lucide-react";
import { isChimeEnabled, playArrivalChime, setChimeEnabled, subscribeChime, unlockChime } from "./arrival-chime.js";
import "./slot-requests.css";

const NEVER_ON = (): boolean => false;

/**
 * "Chime on arrivals": opt-in, per device, from the board (goal 19 D3
 * "Sound"). The press that turns it on is the gesture that unlocks audio, and
 * it plays the bell once so the person hears what they said yes to. Audio off
 * loses nothing; the ring and the words carry the signal.
 */
export function ChimeToggle(): ReactElement {
  const on = useSyncExternalStore(subscribeChime, isChimeEnabled, NEVER_ON);
  return (
    <button
      type="button"
      className="vv-chime-toggle"
      aria-pressed={on}
      onClick={() => {
        const next = !on;
        setChimeEnabled(next);
        if (next) {
          unlockChime();
          playArrivalChime();
        }
      }}
    >
      {on ? <Bell size={16} aria-hidden="true" /> : <BellOff size={16} aria-hidden="true" />}
      Chime on arrivals
    </button>
  );
}

export default ChimeToggle;
