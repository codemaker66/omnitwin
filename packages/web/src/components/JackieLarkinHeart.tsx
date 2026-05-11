import { useEffect, useRef, useState } from "react";
import "./JackieLarkinHeart.css";

const EASTER_EGG_SEQUENCE = "jackielarkin";
const HEART_PULSE_DURATION_MS = 540;
const HEART_PULSE_COUNT = 7;
const HEART_DISMISS_DELAY_MS = HEART_PULSE_DURATION_MS * HEART_PULSE_COUNT + 300;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }

  return target.isContentEditable || target.closest('[contenteditable="true"]') !== null;
}

function isSingleLetterKey(key: string): boolean {
  return /^[a-z]$/u.test(key);
}

export function JackieLarkinHeart(): React.ReactElement | null {
  const [burstId, setBurstId] = useState<number | null>(null);
  const bufferRef = useRef("");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (!isSingleLetterKey(key)) return;

      bufferRef.current = `${bufferRef.current}${key}`.slice(-EASTER_EGG_SEQUENCE.length);
      if (bufferRef.current !== EASTER_EGG_SEQUENCE) return;

      bufferRef.current = "";
      setBurstId((current) => (current === null ? 1 : current + 1));
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (burstId === null) return undefined;

    const timeoutId = window.setTimeout(() => {
      setBurstId(null);
    }, HEART_DISMISS_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [burstId]);

  if (burstId === null) return null;

  return (
    <div
      key={burstId}
      aria-hidden="true"
      className="jackie-larkin-heart-overlay"
      data-testid="jackie-larkin-heart"
    >
      <div className="jackie-larkin-heart-burst">
        <div className="jackie-larkin-heart-ring" />
        <div className="jackie-larkin-heart-core" />
      </div>
    </div>
  );
}
