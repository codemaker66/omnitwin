import { Maximize } from "lucide-react";
import { type ReactElement } from "react";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { Segmented } from "./Controls.js";
import { Key } from "./Keys.js";
import { chooseRegister, drawingRefusal, usePhoneWidth, usePlanDrawingStore, usePlanView, type PlanRegister } from "./plan-drawing-mode.js";
import "./chrome.css";
import "./plan-drawing.css";

// ---------------------------------------------------------------------------
// Plan's Model / Drawing switch (T-674; approved spec §4.1, §6.3, frame 02):
// a small lacquer plate at top centre, only while the view is Plan. Model is
// the captured room from above; Drawing sets the same layout on paper. While
// the drawing is zoomed in, Fit sets the whole room on the page again.
// ---------------------------------------------------------------------------

export function PlanDrawingSwitch(): ReactElement | null {
  const plan = usePlanView();
  const phone = usePhoneWidth();
  const register = usePlanDrawingStore((state) => state.register);
  const zoomed = usePlanDrawingStore((state) => state.zoomed);
  const previewing = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  if (!plan || phone) return null;
  const refusal = drawingRefusal(previewing);
  const options = [
    { value: "model" as const, label: "Model" },
    { value: "drawing" as const, label: "Drawing", ...(refusal === null ? {} : { disabledReason: refusal }) },
  ];
  return (
    <div className="pc-lacquer pc-plan-switch" data-testid="planner-plan-switch">
      <Segmented<PlanRegister> label="Plan as" value={register} options={options} onChange={chooseRegister} />
      {register === "drawing" && zoomed ? (
        <Key
          small
          label="Fit"
          tip="Fit the room on the page"
          icon={<Maximize className="pc-icon" aria-hidden="true" />}
          shortcut={["Shift", "1"]}
          onPress={() => { usePlanDrawingStore.getState().requestFit(); }}
        />
      ) : null}
    </div>
  );
}
