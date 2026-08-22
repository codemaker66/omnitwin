import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findUnsupportedProposalClaim } from "@omnitwin/types";
import { useCallback, useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TagLayer } from "../TagLayer.js";
import {
  TAG_CLOSE_LABEL,
  TAG_EXAMPLE_BADGE,
  TAG_EXAMPLE_DISCLOSURE,
  TAG_GO_TO_BEST_VIEW,
  TAG_GROUP_LABEL,
} from "../tag-copy.js";
import {
  EXAMPLE_TAGS,
  tagCardClearBox,
  type TagCamera,
  type TagStage,
  type TwinTag,
} from "../tag-model.js";

// -----------------------------------------------------------------------------
// TagLayer, on trial for the four ways a note layer fails in a way nobody sees.
//
//   1. IT IS INVISIBLE. A component with no position:absolute renders in flow
//      and `.vv-twin-stage { overflow: hidden }` clips it away entirely — while
//      it stays in the tab order, so a keyboard user tabs into nothing. That bug
//      has shipped in this repo twice, so the stylesheet is read from disk and
//      asserted here rather than trusted.
//
//   2. IT EATS THE WALK. Click-anywhere travel is the primary movement
//      mechanic. A full-stage overlay that takes pointer events disables walking
//      across the whole view, and nothing about the screenshot looks wrong.
//
//   3. IT PRESENTS PLACEHOLDERS AS FACT. The example notes are prose we wrote,
//      rendered over a photograph of a real building. The badge and the
//      disclosure are the only things between that and a planner believing it,
//      so the tests below hold shut the route from example content to the DOM
//      without them.
//
//   4. IT SWALLOWS ESCAPE. A window key listener that outlives its card takes
//      Escape away from the fullscreen control and the enquiry modal.
// -----------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STAGE: TagStage = { widthPx: 1440, heightPx: 900 };

/** Straight ahead down three's −Z, which is where the fixtures below sit. */
const CAMERA: TagCamera = {
  positionThree: [0, 0, 0],
  forwardThree: [0, 0, -1],
  upThree: [0, 1, 0],
  fovYRad: Math.PI / 3,
  aspect: 16 / 9,
};

function makeTag(overrides: Partial<TwinTag> = {}): TwinTag {
  return {
    id: "t1",
    kind: "power",
    provenance: "venue-supplied",
    // E57 +Y is three −Z: dead ahead of CAMERA, mid-frame, clear of every HUD
    // rect (the model's own tests pin that the centre of the frame is free).
    anchorE57: [0, 10, 0],
    facingE57: null,
    title: "The north wall supply",
    body: "A sentence the venue wrote about this spot.",
    bestViewedFrom: "scan_028",
    visibleFrom: ["scan_028"],
    ...overrides,
  };
}

/** The layer with the props a host must supply, and a controlled open note. */
function Harness({
  tags,
  nodeId = "scan_028",
  onWalkTo,
  initialOpen = null,
}: {
  readonly tags: readonly TwinTag[];
  readonly nodeId?: string;
  readonly onWalkTo?: (nodeId: string) => void;
  readonly initialOpen?: string | null;
}): ReactElement {
  const [open, setOpen] = useState<string | null>(initialOpen);
  const onOpenChange = useCallback((id: string | null) => {
    setOpen(id);
  }, []);
  return (
    <TagLayer
      tags={tags}
      nodeId={nodeId}
      camera={CAMERA}
      stage={STAGE}
      openTagId={open}
      onOpenChange={onOpenChange}
      onWalkTo={onWalkTo}
    />
  );
}

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), "utf8");
}

const TAGS_CSS = readSource("src/twin/tags/tags.css");

describe("the stylesheet contract that has shipped broken twice", () => {
  it("positions the layer absolutely, so it is not clipped away by the stage", () => {
    // Without this the layer is laid out a full viewport BELOW the view and
    // clipped by `.vv-twin-stage { overflow: hidden }` — invisible, but still in
    // the tab order.
    const frame = /\.vv-twin-tags\s*\{([^}]*)\}/.exec(TAGS_CSS);
    expect(frame, ".vv-twin-tags must have its own rule").not.toBeNull();
    expect(frame?.[1]).toMatch(/position:\s*absolute/);
    expect(frame?.[1]).toMatch(/inset:\s*0/);
  });

  it("leaves the frame click-through so the walk still works underneath it", () => {
    // A full-stage overlay taking pointer events would silently disable
    // click-anywhere travel across the entire view.
    const frame = /\.vv-twin-tags\s*\{([^}]*)\}/.exec(TAGS_CSS);
    expect(frame?.[1]).toMatch(/pointer-events:\s*none/);
    // …and the pins take it back, or nothing would be pressable at all.
    const pin = /\.vv-twin-tag-pin\s*\{([^}]*)\}/.exec(TAGS_CSS);
    expect(pin?.[1]).toMatch(/pointer-events:\s*auto/);
  });

  it("keeps the pin's hit target a constant 44px so distance never costs a tap", () => {
    // The scale rides the disc INSIDE the button. If it ever moves onto the
    // button itself, a far note becomes unpressable — see tag-model's note on
    // why the scale floor may sit as low as it does.
    const pin = /\.vv-twin-tag-pin\s*\{([^}]*)\}/.exec(TAGS_CSS);
    expect(pin?.[1]).toMatch(/width:\s*44px/);
    expect(pin?.[1]).toMatch(/height:\s*44px/);
    expect(pin?.[1]).not.toMatch(/--vv-tag-scale/);
    const disc = /\.vv-twin-tag-disc\s*\{([^}]*)\}/.exec(TAGS_CSS);
    expect(disc?.[1]).toMatch(/transform:\s*scale\(var\(--vv-tag-scale/);
  });

  it("cancels every animation under prefers-reduced-motion", () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}/.exec(TAGS_CSS);
    expect(reduced, "a reduced-motion block must exist").not.toBeNull();
    expect(reduced?.[1]).toMatch(/animation:\s*none/);
    expect(reduced?.[1]).toMatch(/\.vv-twin-tag-halo/);
  });
});

describe("pins", () => {
  it("draws a pin for a note authored at this viewpoint", () => {
    render(<Harness tags={[makeTag()]} />);
    expect(screen.getByTestId("twin-tag-pin-t1")).toBeTruthy();
    expect(screen.getByRole("group", { name: TAG_GROUP_LABEL })).toBeTruthy();
  });

  it("draws each pin as a real button carrying its own name", () => {
    // Keyboard reachability is the whole point: a div with an onClick is not a
    // control, however it looks.
    render(<Harness tags={[makeTag()]} />);
    const pin = screen.getByTestId("twin-tag-pin-t1");
    expect(pin.tagName).toBe("BUTTON");
    expect(pin.getAttribute("type")).toBe("button");
    expect(pin.getAttribute("aria-label")).toContain("The north wall supply");
    expect(pin.getAttribute("aria-label")).toContain("Power");
    expect(pin.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders nothing at all when no note is visible here", () => {
    // Not an empty labelled group: a screen reader would announce "Room notes"
    // and then find nothing inside it.
    const { container } = render(<Harness tags={[makeTag({ visibleFrom: ["scan_999"] })]} />);
    expect(container.firstChild).toBeNull();
  });

  it("does not draw a note that is behind the camera", () => {
    // The lie this whole feature must not tell. E57 −Y is three +Z — directly
    // behind a camera looking along −Z.
    render(<Harness tags={[makeTag({ anchorE57: [0, -10, 0] })]} />);
    expect(screen.queryByTestId("twin-tag-pin-t1")).toBeNull();
  });

  it("carries the model's scale and fade onto the element, not a guess", () => {
    render(<Harness tags={[makeTag()]} />);
    const style = screen.getByTestId("twin-tag-pin-t1").getAttribute("style") ?? "";
    expect(style).toContain("--vv-tag-scale");
    expect(style).toContain("--vv-tag-opacity");
    expect(style).toMatch(/left:\s*\d/);
    expect(style).toMatch(/top:\s*\d/);
  });

  it("paints a near pin over a far one by emitting it later", () => {
    // DOM order is paint order. Reversed, the note beside you hides behind the
    // note across the room.
    render(
      <Harness
        tags={[
          makeTag({ id: "near", anchorE57: [0, 3, 0] }),
          makeTag({ id: "far", anchorE57: [0, 20, 0] }),
        ]}
      />,
    );
    const pins = screen.getAllByTestId(/^twin-tag-pin-/);
    expect(pins.map((p) => p.getAttribute("data-testid"))).toEqual([
      "twin-tag-pin-far",
      "twin-tag-pin-near",
    ]);
  });
});

describe("opening and closing a note", () => {
  it("opens the card on a press and shows what the note says", () => {
    render(<Harness tags={[makeTag()]} />);
    fireEvent.click(screen.getByTestId("twin-tag-pin-t1"));
    expect(screen.getByTestId("twin-tag-title").textContent).toBe("The north wall supply");
    expect(screen.getByText("A sentence the venue wrote about this spot.")).toBeTruthy();
    expect(screen.getByTestId("twin-tag-pin-t1").getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on Escape", () => {
    render(<Harness tags={[makeTag()]} />);
    fireEvent.click(screen.getByTestId("twin-tag-pin-t1"));
    expect(screen.getByTestId("twin-tag-card")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("twin-tag-card")).toBeNull();
  });

  it("closes on the close control", () => {
    render(<Harness tags={[makeTag()]} />);
    fireEvent.click(screen.getByTestId("twin-tag-pin-t1"));
    fireEvent.click(screen.getByLabelText(TAG_CLOSE_LABEL));
    expect(screen.queryByTestId("twin-tag-card")).toBeNull();
  });

  it("closes when the open note's own pin is pressed again", () => {
    render(<Harness tags={[makeTag()]} />);
    const pin = screen.getByTestId("twin-tag-pin-t1");
    fireEvent.click(pin);
    fireEvent.click(pin);
    expect(screen.queryByTestId("twin-tag-card")).toBeNull();
  });

  it("stops listening for Escape once the card is closed", () => {
    // The failure mode: a listener that outlives its card silently takes Escape
    // away from the fullscreen control and the enquiry modal. Asserted by
    // observing the removal rather than by hoping.
    const removeSpy = vi.spyOn(window, "removeEventListener");
    render(<Harness tags={[makeTag()]} />);
    fireEvent.click(screen.getByTestId("twin-tag-pin-t1"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      removeSpy.mock.calls.some(([type]) => type === "keydown"),
      "the keydown listener must be removed when the card closes",
    ).toBe(true);
    removeSpy.mockRestore();
  });

  it("never steals focus when a pin is merely drawn", () => {
    // Ambient chrome over a live view must not take focus on arrival.
    render(<Harness tags={[makeTag()]} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("keeps the card open when its pin stops being drawable", () => {
    // The pin going is a placement decision; the card going would be the
    // interface forgetting what was asked of it. Here the note is open but
    // behind the camera, so no pin renders — the card must survive.
    render(<Harness tags={[makeTag({ anchorE57: [0, -10, 0] })]} initialOpen="t1" />);
    expect(screen.queryByTestId("twin-tag-pin-t1")).toBeNull();
    expect(screen.getByTestId("twin-tag-card")).toBeTruthy();
  });
});

describe("the card sits inside the box proven clear of the HUD", () => {
  it("clamps a note pressed at the edge of the frame back into the clear box", () => {
    // A naive anchor would put this card off the stage and under the chrome.
    // The rendered left/top are read back and checked against the very box the
    // model's disjointness test asserts about.
    const box = tagCardClearBox(STAGE);
    // Far to the right and low: three +X is the camera's right.
    render(<Harness tags={[makeTag({ anchorE57: [0, 4, -6] })]} initialOpen="t1" />);
    const style = screen.getByTestId("twin-tag-card").getAttribute("style") ?? "";
    const left = Number(/left:\s*([\d.]+)px/.exec(style)?.[1]);
    const top = Number(/top:\s*([\d.]+)px/.exec(style)?.[1]);
    const width = Number(/width:\s*([\d.]+)px/.exec(style)?.[1]);
    expect(Number.isFinite(left) && Number.isFinite(top)).toBe(true);
    expect(left).toBeGreaterThanOrEqual(box.xPx);
    expect(top).toBeGreaterThanOrEqual(box.yPx);
    expect(left + width).toBeLessThanOrEqual(box.xPx + box.widthPx + 1e-6);
  });
});

describe("example notes are never mistakable for venue fact", () => {
  it("renders the badge and the disclosure for an example note", () => {
    render(<Harness tags={[makeTag({ provenance: "example" })]} initialOpen="t1" />);
    expect(screen.getByText(TAG_EXAMPLE_BADGE)).toBeTruthy();
    expect(screen.getByTestId("twin-tag-disclosure").textContent).toBe(TAG_EXAMPLE_DISCLOSURE);
  });

  it("renders neither for a note the venue actually wrote", () => {
    // The badge must mean something. On real content it would be a lie in the
    // other direction.
    render(<Harness tags={[makeTag({ provenance: "venue-supplied" })]} initialOpen="t1" />);
    expect(screen.queryByText(TAG_EXAMPLE_BADGE)).toBeNull();
    expect(screen.queryByTestId("twin-tag-disclosure")).toBeNull();
  });

  it("carries the badge and disclosure on every note we actually ship", () => {
    // The shipped set, driven through the real component rather than inspected
    // as data — this is the assertion that would catch an example note reaching
    // a guest unmarked.
    for (const tag of EXAMPLE_TAGS) {
      cleanup();
      render(<Harness tags={[tag]} initialOpen={tag.id} />);
      expect(screen.getByText(TAG_EXAMPLE_BADGE), `${tag.id} badge`).toBeTruthy();
      expect(screen.getByTestId("twin-tag-disclosure"), `${tag.id} disclosure`).toBeTruthy();
    }
  });
});

describe("the walk offer is real or absent", () => {
  it("offers no walk button without a handler", () => {
    render(<Harness tags={[makeTag({ bestViewedFrom: "scan_046" })]} initialOpen="t1" />);
    expect(screen.queryByTestId("twin-tag-walk")).toBeNull();
  });

  it("offers no walk button when we are already at the best view", () => {
    // A control that would do nothing is worse than a missing one.
    render(
      <Harness
        tags={[makeTag({ bestViewedFrom: "scan_028" })]}
        nodeId="scan_028"
        initialOpen="t1"
        onWalkTo={() => undefined}
      />,
    );
    expect(screen.queryByTestId("twin-tag-walk")).toBeNull();
  });

  it("walks to the note's own best viewpoint when pressed", () => {
    const onWalkTo = vi.fn();
    render(
      <Harness
        tags={[makeTag({ bestViewedFrom: "scan_046", visibleFrom: ["scan_028"] })]}
        nodeId="scan_028"
        initialOpen="t1"
        onWalkTo={onWalkTo}
      />,
    );
    fireEvent.click(screen.getByText(TAG_GO_TO_BEST_VIEW));
    expect(onWalkTo).toHaveBeenCalledWith("scan_046");
  });
});

describe("media", () => {
  it("renders an image with the alt text the author supplied", () => {
    render(
      <Harness
        tags={[makeTag({ media: { kind: "image", src: "/x.jpg", alt: "The wall in question" } })]}
        initialOpen="t1"
      />,
    );
    const image = screen.getByTestId("twin-tag-image");
    expect(image.getAttribute("alt")).toBe("The wall in question");
    expect(image.getAttribute("loading")).toBe("lazy");
  });

  it("renders a link that cannot reach back through window.opener", () => {
    render(
      <Harness
        tags={[makeTag({ media: { kind: "link", href: "https://e.x/spec", label: "The spec" } })]}
        initialOpen="t1"
      />,
    );
    const link = screen.getByTestId("twin-tag-link");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });
});

describe("reduced motion resolves instantly to the final state", () => {
  it("renders the card with no animation when the preference is set", () => {
    // Not a shortened animation — none. The stylesheet cancels the keyframes
    // too; both halves are needed, because script alone would still leave the
    // CSS animation to run.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    render(<Harness tags={[makeTag()]} initialOpen="t1" />);
    const style = screen.getByTestId("twin-tag-card").getAttribute("style") ?? "";
    expect(style).toMatch(/animation:\s*none/);
  });
});

describe("the claim guard, over what actually reached the DOM", () => {
  it("finds no unsupported certainty claim in the rendered layer", () => {
    // Swept over the DOM rather than over the copy list: a component can render
    // a string the copy list never heard of, and that is exactly the string that
    // would hurt.
    for (const tag of EXAMPLE_TAGS) {
      cleanup();
      const { container } = render(<Harness tags={[tag]} initialOpen={tag.id} />);
      const text = container.textContent ?? "";
      expect(text.length).toBeGreaterThan(0);
      expect(findUnsupportedProposalClaim(text), text).toBeNull();
    }
  });
});
