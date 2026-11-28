import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { useEffect, type ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLANNER_SOUND_STORAGE_KEY,
  __resetPlannerSoundForTests,
  __setPlannerContextFactoryForTests,
  getPlannerSoundSettings,
} from "../../../lib/sound-registry.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePopoverState } from "../../planner-chrome/Popover.js";
import { SlateMenu, slateMenuRooms } from "../../planner-chrome/SlateMenu.js";
import { SoundControl } from "../../planner-chrome/SoundControl.js";
import { VerticalToolbox } from "../VerticalToolbox.js";

// ---------------------------------------------------------------------------
// Sound has a setting and no button (T-700; Blake's D1 of 27 Oct: no mute
// button stays on screen, for the look of the planner). The planner plays its
// set-downs on at Quiet; the choice, Off · Quiet · Full with the level, sits
// in three menus (the wide desktop's More menu, the phone's More sheet, v2's
// slate menu) and Shift M mutes. No speaker is ever on the screen: nothing a
// planner shows is named "Sound: quiet".
// ---------------------------------------------------------------------------

const media = vi.hoisted(() => ({ narrow: false, coarse: false }));

vi.mock("../../../hooks/use-media-query.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../hooks/use-media-query.js")>(),
  useIsNarrowViewport: () => media.narrow,
  useIsCoarsePointer: () => media.coarse,
}));
vi.mock("../../../hooks/use-trades-hall-venue.js", () => ({ useTradesHallVenue: () => true }));

// The cockpit hosts the planner's editor in its stage; the stand-in keeps the
// real toolbox (the menus under test) and leaves out the WebGL scene.
vi.mock("../../../App.js", async () => {
  const { VerticalToolbox: Toolbox } = await import("../VerticalToolbox.js");
  return {
    App: ({ compactDesktop = false }: { readonly compactDesktop?: boolean }): ReactElement => (
      <MemoryRouter><Toolbox compactDesktop={compactDesktop} /></MemoryRouter>
    ),
  };
});
vi.mock("../cockpit/ReferenceRoomHeader.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../cockpit/ReferenceRoomHeader.js")>(),
  ReferenceRoomHeader: () => <header data-testid="reference-room-header-mock" />,
}));
vi.mock("../cockpit/CockpitRightDock.js", () => ({ CockpitRightDock: () => <aside data-testid="cockpit-dock-mock" /> }));
vi.mock("../cockpit/CockpitBottom.js", () => ({ CockpitBottom: () => <footer data-testid="cockpit-bottom-mock" /> }));
vi.mock("../cockpit/LensSheet.js", () => ({ LensSheet: () => <div data-testid="lens-sheet-mock" /> }));
vi.mock("../cockpit/WhenRibbon.js", () => ({ WhenRibbon: () => <aside data-testid="when-ribbon-mock" /> }));
// The new chrome's room and bookkeeping are stood in for; its slate is real.
vi.mock("../../planner-chrome/RoomStage.js", () => ({ RoomStage: () => <div data-testid="room-stand-in" /> }));
vi.mock("../EditorBridge.js", () => ({ EditorBridge: () => null }));
vi.mock("../LayoutLiveLayer.js", () => ({ useLayoutLiveRoom: () => undefined }));

const { PlannerCockpit } = await import("../cockpit/PlannerCockpit.js");
const { PlannerChromeV2 } = await import("../../planner-chrome/PlannerChromeV2.js");

/** The speaker's name: "Sound: quiet". The setting's own names ("Sound", "Quiet") never begin like this. */
const SPEAKER_NAME = /^Sound: /u;

/** Everything on screen named like the speaker, by role, label, text or title. */
function speakers(): readonly HTMLElement[] {
  return [...new Set([
    ...screen.queryAllByRole("button", { name: SPEAKER_NAME, hidden: true }),
    ...screen.queryAllByLabelText(SPEAKER_NAME),
    ...screen.queryAllByText(SPEAKER_NAME),
    ...screen.queryAllByTitle(SPEAKER_NAME),
  ])];
}

beforeEach(() => {
  media.narrow = false;
  media.coarse = false;
  window.localStorage.clear();
  window.localStorage.setItem("omnitwin_onboarding_seen", "1");
  __resetPlannerSoundForTests();
  // The context is only stood in for: choosing a set arms it, and the engine has its own tests.
  __setPlannerContextFactoryForTests(() => null);
  useEditorStore.getState().reset();
  useCockpitStore.getState().reset();
});

afterEach(() => {
  cleanup();
  __setPlannerContextFactoryForTests(null);
  __resetPlannerSoundForTests();
  window.localStorage.clear();
  useAuthStore.getState().logout();
  useEditorStore.getState().reset();
  useCockpitStore.getState().reset();
});

/** Opens a disclosure the way the menu's own tests do: the element's open state, then its toggle event. */
function disclose(label: string): void {
  const details = screen.getByText(label, { selector: "summary" }).closest("details");
  if (details === null) throw new Error(`Missing disclosure: ${label}`);
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

/** Asserts the control is Off · Quiet · Full with Quiet chosen, and returns it. */
function expectQuietDefault(group: HTMLElement): HTMLElement {
  expect(within(group).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Off", "Quiet", "Full"]);
  expect(within(group).getByRole("radio", { name: "Quiet" }).getAttribute("aria-checked")).toBe("true");
  expect(within(group).getByRole("radio", { name: "Off" }).getAttribute("aria-checked")).toBe("false");
  expect(within(group).getByRole("radio", { name: "Full" }).getAttribute("aria-checked")).toBe("false");
  return group;
}

describe("the wide desktop's More menu", () => {
  function openMoreMenu(): HTMLElement {
    render(<MemoryRouter><VerticalToolbox compactDesktop /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "More planner tools" }));
    return screen.getByTestId("planner-toolbar");
  }

  it("holds Sound as a setting under More planner tools, Quiet chosen", () => {
    const menu = openMoreMenu();
    disclose("Sound");
    const group = within(menu).getByRole("radiogroup", { name: "Sound" });
    expectQuietDefault(group);
    expect(getPlannerSoundSettings().mode).toBe("quiet");
    expect(localStorage.getItem(PLANNER_SOUND_STORAGE_KEY)).toBeNull();
  });

  it("keeps a choice of Off on the device", () => {
    const menu = openMoreMenu();
    disclose("Sound");
    const group = within(menu).getByRole("radiogroup", { name: "Sound" });
    fireEvent.click(within(group).getByRole("radio", { name: "Off" }));
    expect(localStorage.getItem(PLANNER_SOUND_STORAGE_KEY)).toBe("off");
    expect(within(group).getByRole("radio", { name: "Off" }).getAttribute("aria-checked")).toBe("true");
    expect(within(menu).getByRole("slider", { name: "Level" })).toBeTruthy();
  });

  it("sits beside the scene settings, in the menu's own list of disclosures", () => {
    const menu = openMoreMenu();
    const scene = within(menu).getByTestId("reference-scene-settings");
    expect(within(scene).getByText("Sound", { selector: "summary" }).closest("details")?.parentElement).toBe(scene);
  });

  it("wears v1's own look, none of the new chrome's, and keeps a radio group's keys (T-671)", () => {
    const menu = openMoreMenu();
    disclose("Sound");
    const group = within(menu).getByRole("radiogroup", { name: "Sound" });
    expect(newChromeClassesAround(group)).toEqual([]);
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(getPlannerSoundSettings().mode).toBe("full");
    expect(document.activeElement).toBe(within(group).getByRole("radio", { name: "Full" }));
  });
});

/** The new chrome's class names (pc-*) on the sound setting that holds `group`, or on anything in it. */
function newChromeClassesAround(group: HTMLElement): string[] {
  const setting = group.closest(".menu-sound");
  if (!(setting instanceof HTMLElement)) throw new Error("the sound setting is not v1's");
  return [setting, ...setting.querySelectorAll("*")].flatMap((element) => [...element.classList]).filter((name) => name.startsWith("pc-"));
}

describe("the phone's More sheet", () => {
  it.each([
    { device: "a phone", narrow: true, coarse: true },
    { device: "a tablet, whose wide screen still takes touch", narrow: false, coarse: true },
  ])("holds Sound after the tools on $device, Quiet chosen", ({ narrow, coarse }) => {
    media.narrow = narrow;
    media.coarse = coarse;
    render(<MemoryRouter><VerticalToolbox /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const sheet = screen.getByTestId("mobile-more-sheet");
    const group = within(sheet).getByRole("radiogroup", { name: "Sound" });
    expectQuietDefault(group);
    // A title in the sheet's own words, below the Tools grid it follows.
    const title = within(sheet).getByText("Sound");
    const walls = within(sheet).getByRole("button", { name: "Walls" });
    expect(walls.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(group).getByRole("radio", { name: "Full" }));
    expect(localStorage.getItem(PLANNER_SOUND_STORAGE_KEY)).toBe("full");
    expect(within(group).getByRole("radio", { name: "Full" }).getAttribute("aria-checked")).toBe("true");
  });

  it("wears v1's own look there too, none of the new chrome's (T-671)", () => {
    media.narrow = true;
    media.coarse = true;
    render(<MemoryRouter><VerticalToolbox /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(newChromeClassesAround(within(screen.getByTestId("mobile-more-sheet")).getByRole("radiogroup", { name: "Sound" }))).toEqual([]);
  });

  it("keeps the sheet open while Sound is chosen", () => {
    media.narrow = true;
    render(<MemoryRouter><VerticalToolbox /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const sheet = screen.getByTestId("mobile-more-sheet");
    fireEvent.click(within(within(sheet).getByRole("radiogroup", { name: "Sound" })).getByRole("radio", { name: "Off" }));
    expect(screen.getByTestId("mobile-more-sheet")).toBe(sheet);
    expect(getPlannerSoundSettings().mode).toBe("off");
  });
});

describe("the v2 slate's menu", () => {
  function Open(): ReactElement {
    const state = usePopoverState();
    const { toggle } = state;
    useEffect(() => { toggle(); }, [toggle]);
    return (
      <>
        <button ref={state.triggerRef} type="button">St Andrew's Night dinner</button>
        <SlateMenu
          state={state}
          rooms={slateMenuRooms()}
          currentRoomSlug="grand-hall"
          onRoom={vi.fn()}
          layoutName="8 round tables of 10"
          otherLayouts={[]}
          acts={[]}
          actsSettable
          onUseForAct={vi.fn()}
          actBusy={null}
          actWaitsOn={null}
          actProblem={null}
          eventHref={null}
          diaryHref={null}
          wallsFull={false}
          onWalls={vi.fn()}
        />
      </>
    );
  }

  it("holds Sound as its own group, Quiet chosen", () => {
    render(<MemoryRouter><Open /></MemoryRouter>);
    const panel = screen.getByRole("dialog", { name: "The event and the room" });
    const section = within(panel).getByRole("group", { name: "Sound" });
    expectQuietDefault(within(section).getByRole("radiogroup", { name: "Sound" }));
    fireEvent.click(within(section).getByRole("radio", { name: "Off" }));
    expect(localStorage.getItem(PLANNER_SOUND_STORAGE_KEY)).toBe("off");
    // The menu stays open: it is a setting, set without leaving the room.
    expect(screen.getByRole("dialog", { name: "The event and the room" })).toBe(panel);
  });
});

describe("no button on screen", () => {
  it("finds the speaker where it is mounted, so the checks below mean something", () => {
    render(<SoundControl />);
    expect(speakers().map((speaker) => speaker.getAttribute("aria-label"))).toEqual(["Sound: quiet, Shift M"]);
  });

  it("puts no speaker in v1's desktop planner, with its More menu and Sound open", () => {
    render(<PlannerCockpit />);
    expect(speakers()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "More planner tools" }));
    disclose("Sound");
    expect(screen.getByRole("radiogroup", { name: "Sound" })).toBeTruthy();
    expect(speakers()).toEqual([]);
  });

  it("puts no speaker in v1's phone planner, with its More sheet open", () => {
    media.narrow = true;
    media.coarse = true;
    render(<PlannerCockpit mobile />);
    expect(speakers()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("radiogroup", { name: "Sound" })).toBeTruthy();
    expect(speakers()).toEqual([]);
  });

  it("puts no speaker in v2's chrome, with the slate's menu open", () => {
    render(<MemoryRouter><PlannerChromeV2 /></MemoryRouter>);
    expect(speakers()).toEqual([]);
    // The slate's title is the menu's key: the one button in the zone that opens a dialog.
    const title = screen.getByTestId("planner-chrome-v2").querySelector<HTMLElement>("[data-pc-zone='slate'] button[aria-haspopup='dialog']");
    if (title === null) throw new Error("no slate title");
    fireEvent.click(title);
    const panel = screen.getByRole("dialog", { name: "The event and the room" });
    expect(within(panel).getByRole("radiogroup", { name: "Sound" })).toBeTruthy();
    expect(speakers()).toEqual([]);
  });
});

// The checks above render the planners with some regions stood in for, where a
// speaker could hide. This one reads the source instead: SoundControl, the
// speaker, is named only where it is defined and on the chrome's fixture page.
// SoundSettings, the menus' content from the same module, is free to use, and
// tests may mount the speaker to check it.

/** Every .ts and .tsx file under `dir`, leaving out tests. */
function appSources(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      found.push(...appSources(path));
    } else if (/\.(ts|tsx)$/u.test(name) && !/\.test\.(ts|tsx)$/u.test(name)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * The speaker named as a value: `<SoundControl`, an import or re-export of it
 * (`{ SoundControl }`, `SoundControl as Speaker`), or `module.SoundControl`.
 * Not the module's path (`…/SoundControl.js`), not SoundControlProps, and not
 * SoundSettings.
 */
const SPEAKER_USE = /(?<![\w/])SoundControl(?![\w])(?!\.(?:js|jsx|ts|tsx)\b)(?!["'`])/u;

/** The module that defines the speaker, and the one page that mounts it. */
const SPEAKER_ALLOWED: ReadonlySet<string> = new Set([
  "components/planner-chrome/SoundControl.tsx",
  "pages/PlannerChromeFixturePage.tsx",
]);

function speakerUsers(srcRoot: string): string[] {
  return appSources(srcRoot)
    .map((file) => relative(srcRoot, file).split(sep).join("/"))
    .filter((file) => SPEAKER_USE.test(readFileSync(join(srcRoot, file), "utf8")));
}

describe("no speaker in the source", () => {
  const srcRoot = join(__dirname, "..", "..", "..");

  it("the scan recognises every way a file could mount the speaker, and leaves the menus' setting alone", () => {
    for (const line of [
      "return <SoundControl />;",
      "<SoundControl align=\"start\" tooltipSide=\"above\" />",
      "import { SoundControl } from \"../planner-chrome/SoundControl.js\";",
      "import { SoundSettings, SoundControl } from \"./SoundControl.js\";",
      "import { SoundControl as Speaker } from \"./SoundControl.js\";",
      "export { SoundControl } from \"./SoundControl.js\";",
      "const Speaker = lazy(() => import(\"./SoundControl.js\").then((module) => ({ default: module.SoundControl })));",
    ]) expect(SPEAKER_USE.test(line), line).toBe(true);
    for (const line of [
      "import { SoundSettings } from \"../../planner-chrome/SoundControl.js\";",
      "import { SoundSettings } from \"./SoundControl\";",
      "<div><SoundSettings /></div>",
      "const props: SoundControlProps = { align: \"end\" };",
    ]) expect(SPEAKER_USE.test(line), line).toBe(false);
  });

  it("finds the speaker named only where it is defined and on the fixture page", () => {
    expect(speakerUsers(srcRoot).filter((file) => !SPEAKER_ALLOWED.has(file))).toEqual([]);
  });

  it("names no allowed file that no longer has the speaker", () => {
    const users = new Set(speakerUsers(srcRoot));
    expect([...SPEAKER_ALLOWED].filter((file) => !users.has(file))).toEqual([]);
  });
});
