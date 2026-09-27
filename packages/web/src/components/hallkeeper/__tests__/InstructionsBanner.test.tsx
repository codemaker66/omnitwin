import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EventInstructionsSchema } from "@omnitwin/types";
import { InstructionsBanner } from "../InstructionsBanner.js";

// ---------------------------------------------------------------------------
// A phase deadline reads in the venue's zone and British 24-hour time
// (roadmap N4), whatever language the reader's phone is set to.
// ---------------------------------------------------------------------------

afterEach(cleanup);

describe("InstructionsBanner", () => {
  it("gives a phase deadline in the venue's zone and 24-hour time", () => {
    const instructions = EventInstructionsSchema.parse({
      // Saturday 19 September 2026, 18:30 in Glasgow (BST).
      phaseDeadlines: [{ phase: "furniture", deadline: "2026-09-19T17:30:00.000Z", reason: "" }],
    });
    render(<InstructionsBanner instructions={instructions} timezone="Europe/London" />);
    expect(screen.getByText("18:30")).toBeTruthy();
  });
});
