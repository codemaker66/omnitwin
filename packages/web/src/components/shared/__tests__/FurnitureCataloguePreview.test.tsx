import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { FurnitureCataloguePreview } from "../FurnitureCataloguePreview.js";

afterEach(cleanup);

describe("FurnitureCataloguePreview", () => {
  it("uses the imported preview and recovers from a missing image to a silhouette", () => {
    const item = getCatalogueItemBySlug("checked-banquet-chair");
    if (!item) throw new Error("Missing checked chair");
    const { container, rerender } = render(<FurnitureCataloguePreview item={item} />);
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe(item.thumbnailUrl);
    expect(image?.getAttribute("draggable")).toBe("false");
    if (!image) throw new Error("Missing preview");
    fireEvent.error(image);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    rerender(<FurnitureCataloguePreview item={{ ...item, thumbnailUrl: "/replacement.webp" }} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/replacement.webp");
  });
});
