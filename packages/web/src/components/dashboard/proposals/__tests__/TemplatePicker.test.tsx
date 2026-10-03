import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ProposalTemplate } from "@omnitwin/types";
import { TemplatePicker } from "../TemplatePicker.js";
import type { TemplateEvent } from "../template-format.js";

// ---------------------------------------------------------------------------
// The picker puts a priced template in with the composer as it is when the
// prices arrive: the latest onUse, and nothing at all once the composer is
// held. The desk holds every such action while a template prices, so these
// guards are reached only here, rendered on their own.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  listProposalTemplates: vi.fn(),
  listPricingRules: vi.fn(),
}));
vi.mock("../../../../api/proposal-templates.js", () => ({
  listProposalTemplates: mocks.listProposalTemplates,
  removeProposalTemplate: vi.fn(),
  restoreProposalTemplate: vi.fn(),
}));
vi.mock("../../../../api/pricing.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../api/pricing.js")>(),
  listPricingRules: mocks.listPricingRules,
}));

const TEMPLATE: ProposalTemplate = {
  id: "00000000-0000-4000-8000-0000000000f1", venueId: "00000000-0000-4000-8000-000000000001", spaceId: null, roomName: null, roomListed: true,
  occasion: null, name: "House style", message: "Our house words.", lines: [{ kind: "typed", description: "Flowers", quantity: 10 }],
  readable: true, createdAt: "2026-09-29T10:00:00.000Z", updatedAt: "2026-09-29T10:00:00.000Z", updatedByName: null,
};
const EVENT: TemplateEvent = { spaceId: null, eventDate: "2026-11-20", guestCount: 120, roomName: null, occasion: null };
const EMPTY = { message: "", capacityNote: "", lines: [] };

function held<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("a template priced while the composer changes", () => {
  it("is put in through the composer's latest onUse, with where focus was when Use was pressed", async () => {
    mocks.listProposalTemplates.mockResolvedValue([TEMPLATE]);
    const prices = held<unknown[]>();
    mocks.listPricingRules.mockReturnValueOnce(prices.promise);
    const first = vi.fn();
    const latest = vi.fn();
    const props = { venueId: "v1", event: EVENT, eventStatus: "ready" as const, onNeedEvent: vi.fn(), draft: EMPTY, nowMs: Date.parse("2026-10-02T10:00:00Z"), onBusy: vi.fn() };
    const { rerender } = render(<TemplatePicker {...props} disabled={false} onUse={first} />);
    fireEvent.click(screen.getByTestId("template-toggle"));
    const use = await screen.findByRole("button", { name: "Use House style" });
    use.focus();
    fireEvent.click(use);
    rerender(<TemplatePicker {...props} disabled={false} onUse={latest} />);
    await act(async () => { prices.resolve([]); await Promise.resolve(); });
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith(TEMPLATE, [], "replace", use);
  });

  it("is not put in once the composer is held, and says why", async () => {
    mocks.listProposalTemplates.mockResolvedValue([TEMPLATE]);
    const prices = held<unknown[]>();
    mocks.listPricingRules.mockReturnValueOnce(prices.promise);
    const onUse = vi.fn();
    const props = { venueId: "v1", event: EVENT, eventStatus: "ready" as const, onNeedEvent: vi.fn(), draft: EMPTY, nowMs: Date.parse("2026-10-02T10:00:00Z"), onBusy: vi.fn(), onUse };
    const { rerender } = render(<TemplatePicker {...props} disabled={false} />);
    fireEvent.click(screen.getByTestId("template-toggle"));
    fireEvent.click(await screen.findByRole("button", { name: "Use House style" }));
    rerender(<TemplatePicker {...props} disabled={true} />);
    await act(async () => { prices.resolve([]); await Promise.resolve(); });
    expect(onUse).not.toHaveBeenCalled();
    expect(screen.getByTestId("templates-said").textContent)
      .toBe("House style was not used, as the proposal began to be saved, sent, withdrawn or archived while it was priced. Use it again to put it in.");
  });
});
