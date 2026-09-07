import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InventoryPicture } from "../InventoryPicture.js";

afterEach(cleanup);

const turiniId = "7f1fb7a2-5210-57b1-9108-11255c059520";

describe("InventoryPicture supplied model", () => {
  it("shows the actual model preview by catalogue identity and labels its provenance", () => {
    render(<InventoryPicture name="Burgess Turini 18/3" assetId={turiniId} hero />);
    expect(screen.getByRole("img", { name: "Burgess Turini 18/3, 3d model preview" }).getAttribute("src"))
      .toBe("/models/furniture/burgess-turini-18-3/v1/preview.webp");
    expect(screen.getByText("3D model preview")).toBeDefined();
  });

  it("does not assign the model to another item sharing its display name", () => {
    render(<InventoryPicture name="Burgess Turini 18/3" assetId="another-catalogue-id" hero />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Equipment photo not added")).toBeDefined();
  });

  it("shows an honest unavailable state on failure and recovers for another image", () => {
    const { rerender } = render(<InventoryPicture name="Burgess Turini 18/3" assetId={turiniId} hero />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("Model preview unavailable")).toBeDefined();
    rerender(<InventoryPicture name="6ft Round Table" hero />);
    expect(screen.getByRole("img").getAttribute("src")).toContain("round-table.webp");
    expect(screen.getByText("Illustrative view")).toBeDefined();
  });
});
