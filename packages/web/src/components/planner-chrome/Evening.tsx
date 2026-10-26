import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { actAt, actWords, nearStop, stepStop, type TimedAct } from "../../lib/evening-acts.js";
import { moonRiseAfter, skyAt, skySentence, skySpoken } from "../../lib/evening-sky.js";
import {
  HOUR_MS,
  MINUTE_MS,
  actsOnDayOf,
  clampToWindow,
  eveningWindow,
  sameVenueDay,
  timeAtX,
  toMinute,
  venueDayOf,
  type TimeWindow,
} from "../../lib/evening-window.js";
import { letter, useEscapeLayer, usePlannerKeyBindings } from "../../lib/planner-keys.js";
import { sunTimes } from "../../lib/sky/ephemeris.js";
import { SPRING_PRESETS } from "../../lib/springs.js";
import { createSpringDriver, type SpringDriver } from "../../lib/use-spring-value.js";
import { formatWallTime } from "../../pages/diary/lib/board-time.js";
import { useHallTimeStore } from "../../stores/hall-time-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { LIDAR_CREDIT, OGL_URL } from "../editor/cockpit/HallSunDial.js";
import { HALL_OBSERVER } from "../grand-hall/hall-site.js";
import { hallDay, hallDayStart } from "../grand-hall/hall-sun-times.js";
import { feelTheHour, sunTurnsOn } from "./evening-feedback.js";
import { useShownHour } from "./evening-hour.js";
import { heldHour, restoreHour, useEveningStore, type HeldHour } from "./evening-state.js";
import { EveningDate, dayWords } from "./EveningDate.js";
import { EveningSky, type DayStop } from "./EveningSky.js";
import { EVENING_KEY_PRIORITY, EVENING_PANEL_ID, hourChipElement } from "./HourChip.js";
import { Kbd } from "./Kbd.js";
import { CreamKey, QuietKey } from "./Keys.js";
import "./chrome.css";
import "./evening.css";

// ---------------------------------------------------------------------------
// The evening (T-674, v2 slice 10; spec 6.2, 8, 11, 12; frames 03 and 11).
//
// The hour rises from its chip as a lacquer panel as wide as the dock: the
// hour in Newsreader 300 at 48 px, the act with its copper square, one plain
// sentence about the sky, the date, Now and Whole day; the sky over its
// horizon, and on the ground below it the running order. Sky and line are one
// slider: drag anywhere and the hour follows the pointer one to one; let go
// within 6 minutes of a stop and it glides there on dialGlide. It never snaps
// back. The room follows the hour while it is held (the hall-time store
// lights it); the panel never darkens the room.
//
// Keys: ← → 5 min, Shift 1 h; [ ] the acts; N now; Home and End sunrise and
// sunset; Enter keeps; Esc returns to the hour from before it opened (one
// layer of the planner's one Escape order). A click that selects or places a
// piece moves on and keeps the hour; orbiting the room leaves it open.
//
// Under 768 px it is a sheet over the dock (frame 11): the hour, the act, the
// sky in short and Done; the sky; the line; the acts as 44 px chips in a row
// under a fade; the date, Now and "Back to 19:30"; the credit. A sideways
// drag anywhere on the sheet scrubs.
//
// The hour is presentation only: it never changes the layout. It cannot join
// the layout's undo yet (requested); the evening's own way back is Esc.
// ---------------------------------------------------------------------------

const PHONE_QUERY = "(max-width: 767px)";
const DESKTOP_SKY_PX = 128;
const PHONE_SKY_PX = 112;
/** A sideways drag on the sheet must travel this far, and more across than down, before it scrubs. */
const SHEET_SCRUB_PX = 8;

function useNarrow(): boolean {
  const query = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;
  const [narrow, setNarrow] = useState(query);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const list = window.matchMedia(PHONE_QUERY);
    const changed = (): void => { setNarrow(list.matches); };
    list.addEventListener("change", changed);
    return () => { list.removeEventListener("change", changed); };
  }, []);
  return narrow;
}

/** The evening: nothing while it is closed. */
export function Evening(): ReactElement | null {
  const open = useEveningStore((state) => state.open);
  const narrow = useNarrow();
  if (!open) return null;
  return <EveningOpen phone={narrow} />;
}

interface SliderDrag {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly from: HeldHour;
  last: number;
}

interface SheetDrag {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly x: number;
  readonly y: number;
  readonly startAt: number;
  readonly from: HeldHour;
  last: number;
  scrubbing: boolean;
}

/** The day's own stops without an event: sunrise, noon, sunset, and moonrise within the window. */
function dayStopsFor(span: TimeWindow, at: number, moonrises: readonly number[]): DayStop[] {
  const turns = sunTurnsOn(at);
  const day = venueDayOf(at);
  const noon = toMinute(sunTimes(hallDayStart(day.start), HALL_OBSERVER).solarNoon);
  const stops: DayStop[] = [];
  if (turns.sunrise !== null) stops.push({ at: turns.sunrise, name: "Sunrise" });
  stops.push({ at: noon, name: "Noon" });
  if (turns.sunset !== null) stops.push({ at: turns.sunset, name: "Sunset" });
  for (const rise of moonrises) stops.push({ at: rise, name: "Moonrise" });
  return stops.filter((stop) => stop.at >= span.start && stop.at <= span.end).sort((a, b) => a.at - b.at);
}

function EveningOpen({ phone }: { readonly phone: boolean }): ReactElement {
  const { at, mode } = useShownHour();
  const from = useEveningStore((state) => state.from);
  const wholeDay = useEveningStore((state) => state.wholeDay);
  const source = useEveningStore((state) => state.source);
  const sectionRef = useRef<HTMLElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(phone ? 361 : 868);
  const [shown, setShown] = useState(false);

  const line = eveningWindow({ acts: source.acts, at, wholeDay });
  const { start: windowStart, end: windowEnd, kind } = line;
  const acts = useMemo(() => actsOnDayOf(source.acts, at), [source.acts, at]);
  const day = venueDayOf(at);
  const turns = sunTurnsOn(at);
  const reading = skyAt(at);
  const minute = Math.floor(at / MINUTE_MS);
  const moonrise = useMemo(
    () => (reading.moon.up || reading.sun.up ? null : moonRiseAfter(minute * MINUTE_MS)),
    [minute, reading.moon.up, reading.sun.up],
  );
  const moonrisesInWindow = useMemo(() => {
    const rises: number[] = [];
    let cursor = windowStart;
    for (let guard = 0; guard < 3; guard += 1) {
      const rise = moonRiseAfter(cursor);
      if (rise === null || rise > windowEnd) break;
      rises.push(rise);
      cursor = rise + HOUR_MS;
    }
    return rises;
  }, [windowStart, windowEnd]);
  const dayStops = useMemo(
    () => dayStopsFor({ start: windowStart, end: windowEnd }, windowStart, moonrisesInWindow),
    [windowStart, windowEnd, moonrisesInWindow],
  );
  const dayKey = hallDayStart(at);
  const floorSpans = useMemo(() => (reading.sun.up ? hallDay(dayKey).sunOnFloor : []), [dayKey, reading.sun.up]);
  const floor = floorSpans.find((span) => span.end > at) ?? null;

  const place = actAt(acts, at);
  const words = actWords(place);
  const clock = formatWallTime(at);
  const sentence = skySentence(reading, { moonrise, floor, compact: phone });
  const spoken = `${clock}, ${words === null ? "" : `${words}, `}${skySpoken(reading, { moonrise })}`;
  const fromWords = from === null ? clock
    : from.mode === "now" ? "now"
      : sameVenueDay(from.at, at) ? formatWallTime(from.at) : `${formatWallTime(from.at)} on ${dayWords(from.at, false)}`;

  // Stops the hour glides to, and the ones [ ] step through.
  const glideStops = useMemo(() => {
    const marks = [turns.sunrise, turns.sunset, ...moonrisesInWindow].filter((time): time is number => time !== null);
    return acts.length > 0 ? [...acts.map((act) => act.start), ...marks] : dayStops.map((stop) => stop.at);
  }, [acts, dayStops, moonrisesInWindow, turns.sunrise, turns.sunset]);
  const keyStops = acts.length > 0 ? acts.map((act) => act.start) : dayStops.map((stop) => stop.at);

  const latest = useRef({ at, line, acts, glideStops, keyStops, width });
  latest.current = { at, line, acts, glideStops, keyStops, width };

  // -- the glide --------------------------------------------------------------
  const glide = useRef<SpringDriver | null>(null);
  const stopGlide = useCallback((): void => {
    glide.current?.dispose();
    glide.current = null;
  }, []);
  useEffect(() => stopGlide, [stopGlide]);

  /** Moves the hour to `target`: gliding on dialGlide within the window (a pointer's jump), at once outside it. */
  const glideTo = useCallback((target: number, after?: () => void): void => {
    stopGlide();
    const time = useHallTimeStore.getState();
    const base = latest.current.at;
    const span = latest.current.line;
    const finish = (): void => {
      glide.current = null;
      useHallTimeStore.getState().setTime(target);
      useHallTimeStore.getState().endScrub();
      after?.();
    };
    if (target === base || target < span.start || target > span.end || base < span.start || base > span.end) {
      finish();
      return;
    }
    const goal = (target - base) / MINUTE_MS;
    const driver = createSpringDriver({
      initial: 0,
      config: SPRING_PRESETS.dialGlide,
      epsilon: 0.02,
      write: (value) => {
        if (value === goal) finish();
        else time.setTime(base + value * MINUTE_MS, true);
      },
    });
    glide.current = driver;
    driver.setTarget(goal);
  }, [stopGlide]);

  // -- what each key does ------------------------------------------------------
  const keep = useCallback((): void => {
    stopGlide();
    useEveningStore.getState().keepEvening();
    hourChipElement()?.focus({ preventScroll: true });
  }, [stopGlide]);
  const giveBack = useCallback((): void => {
    stopGlide();
    useEveningStore.getState().returnEvening();
  }, [stopGlide]);
  const setNow = (): void => {
    stopGlide();
    useHallTimeStore.getState().followNow();
  };
  const stepAct = (direction: 1 | -1): void => {
    const stop = stepStop(latest.current.keyStops, latest.current.at, direction);
    if (stop === null) return;
    stopGlide();
    useHallTimeStore.getState().setTime(stop);
  };

  usePlannerKeyBindings([
    { keys: [{ key: "[" }], priority: EVENING_KEY_PRIORITY, run: () => { stepAct(-1); } },
    { keys: [{ key: "]" }], priority: EVENING_KEY_PRIORITY, run: () => { stepAct(1); } },
    { keys: letter("n"), priority: EVENING_KEY_PRIORITY, run: setNow },
    { keys: [{ code: "Enter" }, { code: "NumpadEnter" }], priority: EVENING_KEY_PRIORITY, run: keep },
  ]);

  // Esc: a drag in progress first (back to where the hand took it), then the evening (back to where it opened).
  const sliderDrag = useRef<SliderDrag | null>(null);
  const sheetDrag = useRef<SheetDrag | null>(null);
  useEscapeLayer("operation", {
    open: () => sliderDrag.current !== null || sheetDrag.current?.scrubbing === true,
    onEscape: () => {
      const held = sliderDrag.current ?? sheetDrag.current;
      sliderDrag.current = null;
      sheetDrag.current = null;
      if (held === null) return;
      restoreHour(held.from);
      useHallTimeStore.getState().endScrub();
    },
  });
  useEscapeLayer("panel", { open: true, onEscape: giveBack, returnFocusTo: hourChipElement });

  // A click that selects or places a piece moves on: the hour stays as it is.
  useEffect(() => {
    const offSelection = useSelectionStore.subscribe((state, previous) => {
      if (state.selectedIds !== previous.selectedIds && state.selectedIds.size > 0) useEveningStore.getState().keepEvening();
    });
    const offPlacement = usePlacementStore.subscribe((state, previous) => {
      if (state.placedItems.length > previous.placedItems.length) useEveningStore.getState().keepEvening();
    });
    return () => {
      offSelection();
      offPlacement();
    };
  }, []);

  // -- size, place and arrival ---------------------------------------------------
  useLayoutEffect(() => {
    const slider = sliderRef.current;
    const section = sectionRef.current;
    if (slider === null || section === null) return undefined;
    // Layout widths, not the box on screen: the panel opens from 0.96 of its size.
    const measure = (): void => {
      const measured = slider.clientWidth;
      if (measured > 0) setWidth(measured);
    };
    const chip = hourChipElement();
    // As wide as the dock (its stack, with the rail), rising from the chip.
    const dock = chip?.closest<HTMLElement>("[data-testid='planner-dock-stack']") ?? chip?.closest<HTMLElement>(".pc-dock") ?? null;
    const place = (): void => {
      if (!phone && dock !== null && dock.offsetWidth > 0) section.style.setProperty("--pc-evening-width", `${String(dock.offsetWidth)}px`);
      if (chip !== null) {
        const chipBox = chip.getBoundingClientRect();
        const box = section.getBoundingClientRect();
        section.style.setProperty("--pc-evening-origin", `${String(Math.round(chipBox.left + chipBox.width / 2 - box.left))}px`);
      }
      measure();
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(slider);
    if (dock !== null) observer?.observe(dock);
    return () => { observer?.disconnect(); };
  }, [phone]);

  useLayoutEffect(() => {
    sliderRef.current?.focus({ preventScroll: true });
    const frame = globalThis.requestAnimationFrame(() => { setShown(true); });
    return () => { globalThis.cancelAnimationFrame(frame); };
  }, []);

  // The current act's chip stays in view on the phone, whole.
  useLayoutEffect(() => {
    const row = chipsRef.current;
    const current = row?.querySelector<HTMLElement>("[aria-current='true']") ?? null;
    if (row === null || current === null) return;
    const left = current.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft + 16) row.scrollLeft = Math.max(0, left - 16);
    else if (left + current.offsetWidth > row.scrollLeft + row.clientWidth - 16) row.scrollLeft = left + current.offsetWidth - row.clientWidth + 16;
  });

  // -- the slider: the sky and the line ------------------------------------------
  const hourAtPointer = (event: ReactPointerEvent<HTMLElement>): number => {
    const box = event.currentTarget.getBoundingClientRect();
    return toMinute(timeAtX(latest.current.line, box.width, event.clientX - box.left));
  };
  const moveHourTo = (next: number, held: { last: number; readonly pointerType: string }): void => {
    if (next === held.last) return;
    feelTheHour(held.last, next, latest.current.acts, held.pointerType);
    held.last = next;
    useHallTimeStore.getState().setTime(next, true);
  };
  const letGo = (last: number): void => {
    const stop = nearStop(latest.current.glideStops, last);
    if (stop !== null && stop !== last) glideTo(stop);
    else {
      useHallTimeStore.getState().setTime(last);
      useHallTimeStore.getState().endScrub();
    }
  };

  const onSliderDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    stopGlide();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
    const held: SliderDrag = { pointerId: event.pointerId, pointerType: event.pointerType, from: heldHour(), last: latest.current.at };
    sliderDrag.current = held;
    moveHourTo(hourAtPointer(event), held);
  };
  const onSliderMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const held = sliderDrag.current;
    if (held?.pointerId !== event.pointerId) return;
    moveHourTo(hourAtPointer(event), held);
  };
  const onSliderUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const held = sliderDrag.current;
    if (held?.pointerId !== event.pointerId) return;
    sliderDrag.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone.
    }
    letGo(held.last);
  };

  const onSliderKeys = (event: KeyboardEvent<HTMLDivElement>): void => {
    const now = latest.current.at;
    const step = event.shiftKey ? HOUR_MS : 5 * MINUTE_MS;
    let next: number | null = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp": next = now + step; break;
      case "ArrowLeft":
      case "ArrowDown": next = now - step; break;
      case "PageUp": next = now + HOUR_MS; break;
      case "PageDown": next = now - HOUR_MS; break;
      case "Home": next = turns.sunrise ?? day.start; break;
      case "End": next = turns.sunset ?? day.end - MINUTE_MS; break;
      case "[": stepAct(-1); event.preventDefault(); return;
      case "]": stepAct(1); event.preventDefault(); return;
      case "n":
      case "N": setNow(); event.preventDefault(); return;
      case "Enter": keep(); event.preventDefault(); return;
      default: return;
    }
    event.preventDefault();
    stopGlide();
    // Keys move at once: no glide, no sound.
    useHallTimeStore.getState().setTime(toMinute(next));
  };

  // -- the phone's sheet: a sideways drag anywhere scrubs -------------------------
  const swallowClick = useRef(false);
  const onSheetDown = (event: ReactPointerEvent<HTMLElement>): void => {
    swallowClick.current = false;
    if (!phone || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (event.target instanceof Element && event.target.closest("[role='slider'], a, input") !== null) return;
    sheetDrag.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      x: event.clientX,
      y: event.clientY,
      startAt: latest.current.at,
      from: heldHour(),
      last: latest.current.at,
      scrubbing: false,
    };
  };
  const onSheetMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const held = sheetDrag.current;
    if (held?.pointerId !== event.pointerId) return;
    const dx = event.clientX - held.x;
    if (!held.scrubbing) {
      if (Math.abs(dx) < SHEET_SCRUB_PX || Math.abs(dx) <= Math.abs(event.clientY - held.y)) return;
      held.scrubbing = true;
      stopGlide();
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
    }
    const span = latest.current.line;
    const perPixel = (span.end - span.start) / Math.max(1, latest.current.width);
    moveHourTo(toMinute(clampToWindow(span, held.startAt + dx * perPixel)), held);
  };
  const onSheetUp = (event: ReactPointerEvent<HTMLElement>): void => {
    const held = sheetDrag.current;
    if (held?.pointerId !== event.pointerId) return;
    sheetDrag.current = null;
    if (!held.scrubbing) return;
    swallowClick.current = true;
    letGo(held.last);
  };

  // -- the words ------------------------------------------------------------------
  const firstAct: TimedAct | undefined = source.acts[0];
  const title: ReactNode = acts.length > 0 && words !== null ? (
    <p className="pc-title pc-evening__act">
      <i className={place.kind === "in" ? "pc-evening__square" : "pc-evening__square is-open"} aria-hidden="true" />
      <span>{words}</span>
    </p>
  ) : firstAct !== undefined ? (
    <QuietKey
      label={`Go to ${dayWords(firstAct.start, false)}`}
      className="pc-evening__title-key"
      onPress={() => { stopGlide(); useHallTimeStore.getState().setTime(firstAct.start); }}
    />
  ) : (
    <QuietKey
      label="Add your timings"
      className="pc-evening__title-key"
      onPress={() => { usePlannerChromeStore.getState().open("left", "event-details"); }}
    />
  );
  const wholeDayReason = acts.length === 0 ? "No timings yet, so the whole day shows" : undefined;
  const credit = (
    <p className="pc-evening__credit">
      {LIDAR_CREDIT}, <a href={OGL_URL} target="_blank" rel="noopener noreferrer">OGL v3.0</a>
    </p>
  );

  const slider = (
    <div
      ref={sliderRef}
      className="pc-evening__slider"
      role="slider"
      tabIndex={0}
      aria-label="The hour"
      aria-valuemin={0}
      aria-valuemax={Math.round((windowEnd - windowStart) / MINUTE_MS)}
      aria-valuenow={Math.round((clampToWindow(line, at) - windowStart) / MINUTE_MS)}
      aria-valuetext={spoken}
      data-testid="planner-evening-slider"
      onPointerDown={onSliderDown}
      onPointerMove={onSliderMove}
      onPointerUp={onSliderUp}
      onPointerCancel={onSliderUp}
      onKeyDown={onSliderKeys}
    >
      <EveningSky
        span={line}
        width={width}
        skyHeight={phone ? PHONE_SKY_PX : DESKTOP_SKY_PX}
        at={at}
        acts={acts}
        dayStops={dayStops}
        compact={phone}
      />
    </div>
  );

  const classes = ["pc-lacquer", "pc-lacquer--raised", "pc-evening", phone ? "pc-evening--sheet" : "", shown ? "is-shown" : ""].filter(Boolean).join(" ");

  if (phone) {
    const chips: readonly { readonly key: string; readonly name: string; readonly at: number; readonly current: boolean }[] = acts.length > 0
      ? acts.map((act, index) => ({ key: act.id, name: act.name, at: act.start, current: place.kind === "in" && place.index === index }))
      : dayStops.map((stop) => ({ key: `${stop.name}-${String(stop.at)}`, name: stop.name, at: stop.at, current: false }));
    return (
      <section
        ref={sectionRef}
        id={EVENING_PANEL_ID}
        className={classes}
        role="dialog"
        aria-label="The evening"
        data-testid="planner-evening"
        data-pc-window={kind}
        onPointerDown={onSheetDown}
        onPointerMove={onSheetMove}
        onPointerUp={onSheetUp}
        onPointerCancel={onSheetUp}
        onClickCapture={(event) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          event.stopPropagation();
          event.preventDefault();
        }}
      >
        <div className="pc-evening__grab" aria-hidden="true" />
        <header className="pc-evening__sheet-head">
          <div className="pc-evening__sheet-words">
            <time className="pc-hour pc-evening__hour" dateTime={new Date(at).toISOString()}>{clock}</time>
            {title}
            <p className="pc-meta pc-evening__sky-words">{sentence}</p>
          </div>
          <CreamKey label="Done" touch className="pc-evening__done" onPress={keep} />
        </header>
        {slider}
        <div ref={chipsRef} className="pc-evening__chips" role="group" aria-label={acts.length > 0 ? "The acts" : "Sun and moon"}>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={chip.current ? "pc-evening__chip is-current" : "pc-evening__chip"}
              aria-current={chip.current ? "true" : undefined}
              onClick={() => { glideTo(chip.at); }}
            >
              <b>{chip.name}</b>
              <span className="pc-num">{formatWallTime(chip.at)}</span>
            </button>
          ))}
        </div>
        <div className="pc-evening__sheet-tools">
          <EveningDate at={at} eventStart={source.eventStart} compact />
          <QuietKey label="Now" className="pc-evening__touch" aria-pressed={mode === "now"} onPress={() => { glideTo(Date.now(), () => { useHallTimeStore.getState().followNow(); }); }} />
          <button type="button" className="pc-evening__back" onClick={giveBack}>{`Back to ${fromWords}`}</button>
        </div>
        {credit}
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      id={EVENING_PANEL_ID}
      className={classes}
      role="dialog"
      aria-label="The evening"
      data-testid="planner-evening"
      data-pc-window={kind}
    >
      <header className="pc-evening__head">
        <div className="pc-evening__when">
          <time className="pc-hour pc-evening__hour" dateTime={new Date(at).toISOString()}>{clock}</time>
          <div className="pc-evening__what">
            {title}
            <p className="pc-meta pc-evening__sky-words">{sentence}</p>
          </div>
        </div>
        <div className="pc-evening__tools">
          <EveningDate at={at} eventStart={source.eventStart} compact={false} />
          <QuietKey label="Now" aria-pressed={mode === "now"} onPress={() => { glideTo(Date.now(), () => { useHallTimeStore.getState().followNow(); }); }} />
          <QuietKey
            label="Whole day"
            aria-pressed={kind === "day"}
            disabledReason={wholeDayReason}
            onPress={() => { useEveningStore.getState().setWholeDay(!wholeDay); }}
          />
        </div>
      </header>
      {slider}
      <footer className="pc-evening__foot">
        <p className="pc-evening__keys">
          <span className="pc-evening__chord"><Kbd>[</Kbd><Kbd>]</Kbd></span>
          <span>{acts.length > 0 ? "the acts" : "sun and moon"}</span>
          <i className="pc-evening__dot" aria-hidden="true" />
          <Kbd>Enter</Kbd>
          <span>keeps <b className="pc-num">{clock}</b></span>
          <i className="pc-evening__dot" aria-hidden="true" />
          <Kbd>Esc</Kbd>
          <span>returns to <b className="pc-num">{fromWords}</b></span>
        </p>
        {credit}
      </footer>
    </section>
  );
}
