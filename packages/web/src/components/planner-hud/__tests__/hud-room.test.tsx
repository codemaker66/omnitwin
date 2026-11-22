import { cleanup, render, screen } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlateCrest } from "../../planner-chrome/SlateCrest.js";
import { HudRoom } from "../HudRoom.js";

// ---------------------------------------------------------------------------
// What the HUD takes of the room, and of the second chrome's slate, since that
// chrome grew (#357, 16 Nov 2026).
//
// The HUD used to mount the second chrome's frame for the room. That frame now
// carries that chrome's caption over a chosen piece and the anchors it follows,
// and the HUD showed both: a piece's verbs said twice, once on the shelf and
// once over the room. The HUD frames the scene itself now.
//
// The slate, which the HUD reuses whole as its plaque, gained a crest that is
// that chrome's switch for hiding its own tools, with a note beside it, in a
// seat of their own. The HUD has neither those tools nor that key, and had put
// the crest away already: the seat is put away now, and the note with it.
//
// The stylesheets are read as text: a test's page lays nothing out.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const handedToTheScene: Record<string, unknown>[] = [];
  return { keepRoomSize: vi.fn(), handedToTheScene };
});

vi.mock("../../editor/PlannerScene.js", () => ({
  PlannerScene: (props: Record<string, unknown>) => {
    mocks.handedToTheScene.push(props);
    return <div data-testid="the-scene" />;
  },
}));
vi.mock("../../MarkupPersistence.js", () => ({ MarkupPersistence: () => <div data-testid="the-strokes" /> }));
vi.mock("../../../hooks/use-planner-room-dimensions.js", () => ({ usePlannerRoomDimensions: mocks.keepRoomSize }));

afterEach(() => {
  cleanup();
  mocks.keepRoomSize.mockClear();
  mocks.handedToTheScene.length = 0;
});

async function stylesheet(name: string): Promise<string> {
  return (await readFile(resolve("src/components/planner-hud", name), "utf-8")).replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("the room under the HUD", () => {
  it("is the planner's scene in the screen's own frame, with nothing over it", () => {
    render(<HudRoom />);
    const frame = screen.getByTestId("planner-hud-room");
    expect(frame.classList.contains("hud-room-stage")).toBe(true);
    // The planner shell's class too: the scene's own rules, and the HUD's rule for where the picture ends, read it.
    expect(frame.classList.contains("venviewer-planner-shell")).toBe(true);
    // The scene and the keeper of the drawn strokes, and no caption over a chosen piece.
    expect(Array.from(frame.children, (child) => child.getAttribute("data-testid"))).toEqual(["the-scene", "the-strokes"]);
    // Nothing is handed into the canvas either (the second chrome hands in the anchors its caption follows).
    expect(mocks.handedToTheScene).toEqual([{}]);
    // And the room's size is kept in step with the loaded space, as the editor keeps it.
    expect(mocks.keepRoomSize).toHaveBeenCalled();
  });

  it("is a stacking context of its own, by a rule that outranks the planner shell's whichever stylesheet comes later", async () => {
    const css = await stylesheet("hud.css");
    const rule = /\.hud-room \.hud-room-stage\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/position:\s*absolute;/);
    expect(rule).toMatch(/isolation:\s*isolate;/);
    // Its foot is the shelf's top, from the rule the lab's room reads too: this one leaves the foot alone.
    expect(rule).not.toMatch(/\b(?:inset|bottom):/);
    expect(css).toMatch(/\.hud-room \.venviewer-planner-shell\s*\{\s*bottom:\s*var\(--hud-shelf-h\);\s*\}/);
  });
});

describe("the second chrome's crest, in the HUD's plaque", () => {
  it("has its switch and its note in one seat", () => {
    render(<SlateCrest logoUrl={null} onLogoError={() => undefined} />);
    const seat = document.querySelector(".pc-slate__crest-seat");
    expect(seat).not.toBeNull();
    expect(seat?.querySelector("button.pc-slate__crest")).not.toBeNull();
    expect(seat?.querySelector(".pc-crest-note")).not.toBeNull();
  });

  it("is put away whole: the plaque's stylesheet takes the seat off the page, and the switch and the note with it", async () => {
    const css = await stylesheet("hud-plaque.css");
    const away = /\.hud-root :is\(([^)]*)\)\s*\{\s*display:\s*none;\s*\}/.exec(css)?.[1] ?? "";
    expect(away.split(",").map((one) => one.trim())).toContain(".pc-slate__crest-seat");
  });
});
