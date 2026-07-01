import { useCallback, useEffect, useRef, useState } from "react";

// -----------------------------------------------------------------------------
// useRoomTone — the acoustic of the empty hall, synthesised.
//
// No audio asset ships with the page. On the first toggle we build the sound
// from nodes: looped brown noise (the air of a large room) through a low-pass
// at 220 Hz (stone walls swallow the highs), a high-pass at 40 Hz (no rumble),
// and a 0.07 Hz LFO breathing ±20 % across the master gain — the hall
// inhaling. Volume is deliberately low: room tone is felt, not heard.
//
// OFF by default, never autoplay, fades in/out over ~1.2 s, suspends the
// AudioContext when silent so no thread runs for a muted page.
// -----------------------------------------------------------------------------

const TONE_VOLUME = 0.055;
const FADE_SECONDS = 1.2;

interface ToneGraph {
  readonly context: AudioContext;
  readonly master: GainNode;
}

function buildToneGraph(): ToneGraph {
  const context = new AudioContext();

  // Two seconds of brown noise, looped. Brown (integrated white) reads as
  // air-in-a-large-volume rather than static.
  const sampleRate = context.sampleRate;
  const buffer = context.createBuffer(1, sampleRate * 2, sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 220;

  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 40;

  // The hall breathes: a very slow LFO swings the tone gain ±20 %.
  const breath = context.createGain();
  breath.gain.value = 1;
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoDepth = context.createGain();
  lfoDepth.gain.value = 0.2;
  lfo.connect(lfoDepth);
  lfoDepth.connect(breath.gain);

  const master = context.createGain();
  master.gain.value = 0;

  source.connect(lowpass);
  lowpass.connect(highpass);
  highpass.connect(breath);
  breath.connect(master);
  master.connect(context.destination);

  source.start();
  lfo.start();

  return { context, master };
}

export interface RoomTone {
  /** False when the environment has no Web Audio (toggle hidden). */
  readonly supported: boolean;
  readonly playing: boolean;
  readonly toggle: () => void;
}

export function useRoomTone(): RoomTone {
  const supported =
    typeof window !== "undefined" && typeof window.AudioContext === "function";
  const [playing, setPlaying] = useState<boolean>(false);
  const graphRef = useRef<ToneGraph | null>(null);
  // Pending fade-out suspend; cleared when a toggle-on supersedes it so a
  // stale timeout can never mute a tone the visitor just re-enabled.
  const suspendTimerRef = useRef<number | null>(null);

  const toggle = useCallback((): void => {
    if (!supported) {
      return;
    }
    if (graphRef.current === null) {
      try {
        graphRef.current = buildToneGraph();
      } catch {
        return; // Audio blocked by the environment — stay silent, stay calm.
      }
    }
    const { context, master } = graphRef.current;
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    if (suspendTimerRef.current !== null) {
      window.clearTimeout(suspendTimerRef.current);
      suspendTimerRef.current = null;
    }
    if (playing) {
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
      suspendTimerRef.current = window.setTimeout(() => {
        suspendTimerRef.current = null;
        // Suspend only if still silent when the fade lands.
        if (graphRef.current !== null) {
          void graphRef.current.context.suspend();
        }
      }, FADE_SECONDS * 1000 + 50);
      setPlaying(false);
    } else {
      void context.resume();
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(TONE_VOLUME, now + FADE_SECONDS);
      setPlaying(true);
    }
  }, [supported, playing]);

  useEffect(() => {
    return () => {
      if (suspendTimerRef.current !== null) {
        window.clearTimeout(suspendTimerRef.current);
        suspendTimerRef.current = null;
      }
      if (graphRef.current !== null) {
        void graphRef.current.context.close();
        graphRef.current = null;
      }
    };
  }, []);

  return { supported, playing, toggle };
}
