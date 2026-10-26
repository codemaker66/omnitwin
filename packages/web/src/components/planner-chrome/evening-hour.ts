import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useClientEventSchedule } from "../../hooks/use-client-event-schedule.js";
import { useLinkedEvent } from "../../hooks/use-linked-event.js";
import { timedActs, type PhaseTiming } from "../../lib/evening-acts.js";
import { readRememberedHour } from "../../lib/evening-memory.js";
import { moodForSun } from "../../lib/evening-sky.js";
import { MINUTE_MS } from "../../lib/evening-window.js";
import { canReadInternalEventData, isCustomerRole } from "../../lib/event-access.js";
import { hallSkyRequested } from "../../lib/hall-sky-access.js";
import { sunPosition } from "../../lib/sky/ephemeris.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useHallTimeStore, type HallTimeMode } from "../../stores/hall-time-store.js";
import { useHallViewStore } from "../../stores/hall-view-store.js";
import { HALL_OBSERVER } from "../grand-hall/hall-site.js";
import { useEveningStore, type EveningSource } from "./evening-state.js";

// ---------------------------------------------------------------------------
// The hour's hooks (T-674, v2 slice 10; spec 6.2; findings D-10, D-11, D-17).
//
// - The hour as shown: the venue's clock while following it, read afresh as
//   each minute turns, else the moment chosen.
// - The event's evening: its acts with times, read once for the planner the
//   way the hall's opening hour reads them (staff from the event, a client
//   from their own schedule, a guest not at all), in this room or in none.
// - The hour a layout opens at: the one last chosen for it on this device,
//   failing that the event's first act, failing that now.
// - The light following the hour: where the real sky is not on (the `?sky=1`
//   gate), the hour sets the hall's mood by the sun's true altitude, so the
//   room follows the hour either way.
// ---------------------------------------------------------------------------

export interface ShownHour {
  readonly at: number;
  readonly mode: HallTimeMode;
}

/** The hour the hall shows: the clock (turning each minute) or the moment set. */
export function useShownHour(): ShownHour {
  const mode = useHallTimeStore((state) => state.mode);
  const chosen = useHallTimeStore((state) => state.at);
  const [now, setNow] = useState(() => Date.now());
  useLayoutEffect(() => {
    if (mode !== "now") return undefined;
    let timer = 0;
    const tick = (): void => {
      const time = Date.now();
      setNow(time);
      // The venue's offsets are whole hours, so its minutes turn with UTC's.
      timer = window.setTimeout(tick, MINUTE_MS - (time % MINUTE_MS));
    };
    tick();
    return () => { window.clearTimeout(timer); };
  }, [mode]);
  return { at: mode === "now" ? now : chosen, mode };
}

/** The event's acts in this room (or in none), read once, into the evening's store. */
export function useEveningSource(): EveningSource {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId")?.trim() ?? "";
  const configurationId = useEditorStore((state) => state.configId);
  const venueId = useEditorStore((state) => state.venueId);
  const spaceId = useEditorStore((state) => state.space?.id ?? null);
  const auth = useAuthStore();
  const staff = canReadInternalEventData(auth);
  const client = !staff && !auth.isLoading && auth.isAuthenticated && isCustomerRole(auth.user?.role);
  const linked = useLinkedEvent(venueId);
  const schedule = useClientEventSchedule(client && eventId.length > 0 ? eventId : null, {
    configurationId,
    expectedVenueId: venueId,
    enabled: client,
  });
  const graph = staff ? linked.graph : null;
  const shared = client ? schedule.data : null;

  const source = useMemo((): EveningSource => {
    const startsAt = graph?.event.startsAt ?? shared?.event.startsAt ?? null;
    const parsed = startsAt === null ? Number.NaN : Date.parse(startsAt);
    const eventStart = Number.isFinite(parsed) ? parsed : null;
    const here = (phaseSpace: string | null): boolean => phaseSpace === null || spaceId === null || phaseSpace === spaceId;
    const phases: PhaseTiming[] = graph !== null
      ? graph.phases.filter((phase) => here(phase.spaceId)).map((phase) => ({
        id: phase.id, name: phase.name, startsAt: phase.startsAt, durationMinutes: phase.durationMinutes, sortOrder: phase.sortOrder,
      }))
      : (shared?.phases ?? []).filter((phase) => here(phase.space?.id ?? null)).map((phase, index) => ({
        id: phase.id, name: phase.name, startsAt: phase.startsAt, durationMinutes: phase.durationMinutes, sortOrder: index,
      }));
    return { acts: timedActs(phases, eventStart), eventStart, eventLinked: eventId.length > 0 };
  }, [eventId, graph, shared, spaceId]);

  useEffect(() => { useEveningStore.getState().setSource(source); }, [source]);
  return source;
}

/**
 * Opens each layout at its hour: the one last chosen for it on this device
 * (applied once each time the layout opens), failing that the event's first
 * act, failing that now. An hour chosen in the meantime always stands.
 */
export function useLayoutOpeningHour(source: EveningSource): void {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId")?.trim() ?? "";
  const configId = useEditorStore((state) => state.configId);
  const applied = useRef<string | null>(null);
  const preferred = source.acts[0]?.start ?? source.eventStart;

  useEffect(() => {
    if (configId === null) return;
    // The hall-time store's own key for a plan, so its opening and this one agree.
    const plan = `${configId}|${eventId}`;
    const time = useHallTimeStore.getState();
    const remembered = readRememberedHour(configId);
    if (remembered !== null) {
      if (applied.current === plan) return;
      applied.current = plan;
      time.openFor(plan, remembered.mode === "set" ? remembered.at : null);
      // Chosen, so a late event start never moves it.
      if (remembered.mode === "set") time.setTime(remembered.at);
      else time.followNow();
      return;
    }
    applied.current = plan;
    time.openFor(plan, preferred);
  }, [configId, eventId, preferred]);
}

/**
 * Where the real sky does not light the room, the hour sets the hall's light
 * (daylight, evening, candlelight by the sun's true altitude); written only
 * when it changes. With the real sky on, the sky follows the hour itself.
 */
export function useHourSetsTheLight(at: number): void {
  const realSky = useMemo(() => typeof window !== "undefined" && hallSkyRequested(window.location.search), []);
  const mood = moodForSun(sunPosition(at, HALL_OBSERVER).trueAltitude);
  useEffect(() => {
    if (realSky) return;
    const view = useHallViewStore.getState();
    if (view.mood !== mood) view.setMood(mood);
  }, [mood, realSky]);
}
