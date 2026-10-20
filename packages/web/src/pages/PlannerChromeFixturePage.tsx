import { useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, Pen, Plus, Redo2, Ruler, Search, Send, Undo2, Volume1 } from "lucide-react";
import { Field, Segmented, Stepper, Switch } from "../components/planner-chrome/Controls.js";
import { LayOutGlyph } from "../components/planner-chrome/glyphs.js";
import { Kbd } from "../components/planner-chrome/Kbd.js";
import { CreamKey, Key, KeyRow, KeySeparator, QuietKey } from "../components/planner-chrome/Keys.js";
import { Chip, Lacquer, MarkLabel, Notice, StatusDot } from "../components/planner-chrome/Surfaces.js";
import { TooltipHost } from "../components/planner-chrome/Tooltip.js";
import "./PlannerChromeFixturePage.css";

// ---------------------------------------------------------------------------
// /dev/planner-chrome (development builds only): every shared primitive of the
// planner's new chrome (T-671, slice 4) in context, over a room. `?bg=` names a
// same-origin image to sit behind them, so the evidence capture can put the
// real day and night frames of the production room underneath and run the
// contrast audit on what a person would see.
// ---------------------------------------------------------------------------

type View = "plan" | "room" | "walk";
type Tool = "add" | "layout" | "measure" | "draw";
type Cloth = "bare" | "white" | "black";

const VIEWS: readonly View[] = ["plan", "room", "walk"];
const VIEW_LABELS: Readonly<Record<View, string>> = { plan: "Plan", room: "Room", walk: "Walk" };

/** Only a path on this site may be the backdrop. */
function backdropFrom(search: URLSearchParams): string | null {
  const asked = search.get("bg");
  if (asked === null || !asked.startsWith("/") || asked.startsWith("//")) return null;
  return asked;
}

export function PlannerChromeFixturePage(): ReactElement {
  const [search] = useSearchParams();
  const stageRef = useRef<HTMLDivElement>(null);
  const backdrop = backdropFrom(search);
  const [view, setView] = useState<View>("room");
  const [tool, setTool] = useState<Tool | null>(null);
  const [cloth, setCloth] = useState<Cloth>("white");
  const [seats, setSeats] = useState(10);
  const [canChange, setCanChange] = useState(true);
  const [fromFireplace, setFromFireplace] = useState(8.34);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    if (backdrop === null) stage.style.removeProperty("--pcf-backdrop");
    else stage.style.setProperty("--pcf-backdrop", `url("${encodeURI(backdrop)}")`);
  }, [backdrop]);

  const toggleTool = (next: Tool): void => { setTool(tool === next ? null : next); };

  return (
    <div ref={stageRef} className="pcf-stage pc-root" data-testid="planner-chrome-fixture">
      <h1 className="pcf-visually-hidden">The planner&apos;s chrome: shared primitives</h1>

      <Lacquer className="pcf-dock" role="toolbar" aria-label="View, time and tools" data-pc-chrome="dock">
        <Key label="Design" trailing={<ChevronDown className="pc-icon" />} aria-haspopup="menu" />
        <KeySeparator />
        <KeyRow role="radiogroup" label="View" activeKey={view}>
          {VIEWS.map((each, index) => (
            <Key key={each} label={VIEW_LABELS[each]} radio on={view === each} rowKey={each} shortcut={[String(index + 1)]} onPress={() => { setView(each); }} />
          ))}
        </KeyRow>
        <KeySeparator />
        <KeyRow role="group" label="Tools" activeKey={tool}>
          <Key label="Add" icon={<Plus className="pc-icon" />} toggle on={tool === "add"} rowKey="add" shortcut={["A"]} onPress={() => { toggleTool("add"); }} />
          <Key label="Lay out" icon={<LayOutGlyph />} toggle on={tool === "layout"} rowKey="layout" shortcut={["L"]} onPress={() => { toggleTool("layout"); }} />
          <Key label="Measure" icon={<Ruler className="pc-icon" />} toggle on={tool === "measure"} rowKey="measure" shortcut={["M"]} onPress={() => { toggleTool("measure"); }} />
          <Key label="Draw" icon={<Pen className="pc-icon" />} toggle on={tool === "draw"} rowKey="draw" shortcut={["D"]} onPress={() => { toggleTool("draw"); }} />
        </KeyRow>
        <KeySeparator />
        <Key label="Undo" tip="Undo Move Table 8" icon={<Undo2 className="pc-icon" />} iconOnly shortcut={["Ctrl", "Z"]} tooltipImmediate />
        <Key label="Redo" icon={<Redo2 className="pc-icon" />} iconOnly disabledReason="Nothing to redo" />
      </Lacquer>

      <Lacquer className="pcf-next" aria-label="Next step" data-pc-chrome="next">
        <CreamKey label="Send to the client" icon={<Send className="pc-icon" />} />
      </Lacquer>

      <Lacquer className="pcf-utilities" role="toolbar" aria-label="Present, find and sound" data-pc-chrome="utilities">
        <Key label="Find" icon={<Search className="pc-icon" />} iconOnly small shortcut={["Ctrl", "K"]} tooltipSide="below" />
        <Key label="Sound: quiet" icon={<Volume1 className="pc-icon" />} iconOnly small shortcut={["Shift", "M"]} tooltipSide="below" />
      </Lacquer>

      <Lacquer raised className="pcf-panel" role="region" aria-label="Details" data-pc-chrome="panel">
        <div className="pcf-panel__head">
          <span className="pc-caps pcf-ink-3">Details · 6 of 8</span>
          <span className="pc-title">Table 6</span>
          <span className="pc-meta pcf-ink-2">Round Table (White Cloth) · 1.83 m</span>
        </div>
        <div className="pcf-panel__sec">
          <span className="pc-caps pcf-ink-3">Seats</span>
          <Segmented
            label="Seats"
            value={String(seats)}
            options={["6", "7", "8", "9", "10", "11", "12"].map((count) => ({ value: count, label: count }))}
            onChange={(next) => { setSeats(Number(next)); }}
          />
        </div>
        <div className="pcf-panel__sec">
          <span className="pc-caps pcf-ink-3">Dressing</span>
          <Segmented
            label="Cloth"
            value={cloth}
            options={[
              { value: "bare", label: "Bare" },
              { value: "white", label: "White cloth" },
              { value: "black", label: "Black cloth" },
            ]}
            onChange={setCloth}
          />
        </div>
        <div className="pcf-panel__sec">
          <Field label="From the fireplace wall" value={fromFireplace} unit="m" format={(n) => n.toFixed(2)} onCommit={setFromFireplace} />
        </div>
        <div className="pcf-panel__sec">
          <Switch label="She can change the layout" checked={canChange} onChange={setCanChange} />
        </div>
        <div className="pcf-panel__sec pcf-row">
          <Stepper label="Seats at Table 8" value={seats} min={6} max={12} unit="seats" onChange={setSeats} />
          <QuietKey label="Copy the link instead" />
        </div>
      </Lacquer>

      <div className="pcf-states">
        <Lacquer className="pcf-line" data-pc-chrome="slate-line">
          <Chip tone="hold">1st option</Chip>
          <span className="pcf-state"><StatusDot tone="saved" /><b>Saved</b> 21:41</span>
          <Chip tone="sample">Sample</Chip>
        </Lacquer>
        <Lacquer className="pcf-line">
          <span className="pcf-state"><StatusDot tone="offline" /><b>Offline</b> · 3 changes kept on this device</span>
        </Lacquer>
        <Notice
          lead="Not saved"
          urgency="alert"
          body="The last save did not reach Venviewer. Your changes are kept on this device."
          actions={<QuietKey label="Try again" />}
        />
        <Lacquer className="pcf-line">
          <span>Duplicate</span><Kbd>Ctrl</Kbd><Kbd>D</Kbd>
        </Lacquer>
      </div>

      <div className="pcf-marks" aria-hidden="true">
        <MarkLabel>Table 8 · 10 seats · fits</MarkLabel>
        <MarkLabel tone="copper">1.42 m</MarkLabel>
        <MarkLabel tone="sage">1.4 m · comfortable</MarkLabel>
        <MarkLabel tone="amber">1.0 m · tight</MarkLabel>
        <MarkLabel tone="brick">Would overlap by 0.9 m</MarkLabel>
      </div>

      <div className="pc-paper pc-surface pcf-paper">
        <span className="pc-caps pcf-copper">Add to the room</span>
        <span className="pc-title">Furniture</span>
        <div className="pcf-row">
          <QuietKey label="Chair: Burgess Turini 18/3" />
          <Chip tone="sample">Sample</Chip>
          <Kbd>/</Kbd>
        </div>
      </div>

      <TooltipHost />
    </div>
  );
}
