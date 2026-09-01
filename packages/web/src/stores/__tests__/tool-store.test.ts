import { beforeEach, describe, expect, it } from "vitest";
import { useToolStore } from "../tool-store.js";
import { useMeasurementStore } from "../measurement-store.js";

// ---------------------------------------------------------------------------
// One authoritative tool mode, composed with the measurement store's own
// active flag. The contract under test: whichever side flips first — the
// pill, the M key, or a legacy toolbox path writing the measurement store
// directly — both stores agree afterwards, with no feedback loop.
// ---------------------------------------------------------------------------

beforeEach(() => {
  useToolStore.setState({ activeTool: "select", liveValue: null });
  useMeasurementStore.setState({ active: false, pendingPoint: null });
});

describe("tool-store", () => {
  it("starts holding Select", () => {
    expect(useToolStore.getState().activeTool).toBe("select");
    expect(useToolStore.getState().liveValue).toBeNull();
  });

  it("switching tools clears the live readout", () => {
    useToolStore.getState().setLiveValue("135°");
    useToolStore.getState().setTool("rotate");
    expect(useToolStore.getState().liveValue).toBeNull();
  });

  it("selecting Measure arms the tape; leaving it disarms", () => {
    useToolStore.getState().setTool("measure");
    expect(useMeasurementStore.getState().active).toBe(true);

    useToolStore.getState().setTool("select");
    expect(useMeasurementStore.getState().active).toBe(false);
  });

  it("legacy path: arming the tape directly pulls the pill to Measure", () => {
    useMeasurementStore.getState().activate();
    expect(useToolStore.getState().activeTool).toBe("measure");
  });

  it("legacy path: disarming the tape returns the pill to Select", () => {
    useToolStore.getState().setTool("measure");
    useMeasurementStore.getState().deactivate();
    expect(useToolStore.getState().activeTool).toBe("select");
  });

  it("leaving Measure clears a pending tape point (no orphaned first click)", () => {
    useToolStore.getState().setTool("measure");
    useMeasurementStore.getState().placePoint([1, 0, 1]);
    expect(useMeasurementStore.getState().pendingPoint).not.toBeNull();
    useToolStore.getState().setTool("move");
    expect(useMeasurementStore.getState().pendingPoint).toBeNull();
  });

  it("re-setting the same tool is a no-op (no store churn)", () => {
    let notifications = 0;
    const unsubscribe = useToolStore.subscribe(() => { notifications += 1; });
    useToolStore.getState().setTool("select");
    unsubscribe();
    expect(notifications).toBe(0);
  });

  it("setLiveValue dedupes identical values", () => {
    useToolStore.getState().setLiveValue("×1.25");
    let notifications = 0;
    const unsubscribe = useToolStore.subscribe(() => { notifications += 1; });
    useToolStore.getState().setLiveValue("×1.25");
    unsubscribe();
    expect(notifications).toBe(0);
  });
});
