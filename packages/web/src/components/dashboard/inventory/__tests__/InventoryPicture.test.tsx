import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { imageSize, srcSetRungs } from "../../../../test/image-header.js";
import { INVENTORY_ILLUSTRATIONS, InventoryPicture, inventoryPictureSizes } from "../InventoryPicture.js";

afterEach(cleanup);

// Vite serves imported assets at their source path in tests.
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const asset = (url: string): Buffer => readFileSync(resolve(webRoot, url.replace(/^\//u, "").replace(/\?.*$/u, "")));

describe("InventoryPicture illustrations", () => {
  it("offers display-sized copies under the lossless full-size WebP, sized to the drawn box", () => {
    render(<InventoryPicture name="6ft Round Table" />);
    const thumbnail = screen.getByRole("img");
    expect(thumbnail.getAttribute("src")).toContain("round-table.webp");
    expect(thumbnail.getAttribute("srcset")).toBe(INVENTORY_ILLUSTRATIONS.table.srcSet);
    // A 96 px tall box holds the 3:2 table at most 144 px wide.
    expect(thumbnail.getAttribute("sizes")).toBe("144px");
    cleanup();
    render(<InventoryPicture name="Chiavari chair" hero />);
    expect(screen.getByRole("img").getAttribute("sizes")).toBe("240px");
    expect(inventoryPictureSizes(1.5, true)).toBe("540px");
  });

  it("cuts every copy from the same picture, at its stated width, without upscaling", () => {
    for (const [name, art] of Object.entries(INVENTORY_ILLUSTRATIONS)) {
      const rungs = srcSetRungs(art.srcSet);
      expect(rungs.map((rung) => rung.width), name).toEqual([...rungs.map((rung) => rung.width)].sort((a, b) => a - b));
      const widest = rungs.at(-1);
      expect(widest?.path, name).toBe(art.src);
      const full = imageSize(asset(art.src));
      expect(widest?.width, name).toBe(full.width);
      expect(full.width / full.height, name).toBeCloseTo(art.aspect, 6);
      // Sharp on a 3x screen in the featured box, or the full picture.
      expect(Math.min(3 * Number.parseInt(inventoryPictureSizes(art.aspect, true), 10), full.width), name)
        .toBeLessThanOrEqual(widest?.width ?? 0);
      for (const rung of rungs) {
        const bytes = asset(rung.path);
        expect(bytes.toString("ascii", 8, 12), rung.path).toBe("WEBP");
        const size = imageSize(bytes);
        expect(size.width, rung.path).toBe(rung.width);
        expect(Math.abs(size.height - rung.width / art.aspect), rung.path).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it("gives supplied model previews no ladder", () => {
    render(<InventoryPicture name="Burgess Turini 18/3" assetId="7f1fb7a2-5210-57b1-9108-11255c059520" hero />);
    expect(screen.getByRole("img").hasAttribute("srcset")).toBe(false);
    expect(screen.getByRole("img").hasAttribute("sizes")).toBe(false);
  });
});

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
