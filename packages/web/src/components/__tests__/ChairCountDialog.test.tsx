import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import {
  ChairCountDialog,
  initialChairCountForCapacity,
  type ChairCountRequest,
} from "../ChairCountDialog.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("initialChairCountForCapacity", () => {
  it("never starts above a scaled table's physical capacity", () => {
    expect(initialChairCountForCapacity("round", 4)).toBe(4);
    expect(initialChairCountForCapacity("rectangular", 1)).toBe(1);
  });

  it("allows table-only when no chair physically fits", () => {
    expect(initialChairCountForCapacity("rectangular", 0)).toBe(0);
  });
});

describe("ChairCountDialog scaled capacity", () => {
  it("submits table-only instead of inventing a seat for a tiny scaled table", () => {
    vi.useFakeTimers();
    const table = getCatalogueItemBySlug("trestle-6ft");
    if (table === undefined) throw new Error("trestle-6ft catalogue item missing");
    const request: ChairCountRequest = {
      catalogueItemId: table.id,
      x: 0,
      z: 0,
      rotationY: 0,
      tableShape: "rectangular",
      scale: 0.01,
    };
    const onConfirm = vi.fn<(count: number) => void>();

    render(
      <ChairCountDialog
        request={request}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText<HTMLInputElement>("Chair count").value).toBe("0");
    expect(screen.getByText("No chairs fit at this scale")).toBeDefined();
    fireEvent.click(screen.getByTestId("chair-count-confirm"));
    expect(onConfirm).toHaveBeenCalledWith(0);
  });
});
