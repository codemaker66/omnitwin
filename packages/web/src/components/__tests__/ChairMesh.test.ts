import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import {
  computeBanquetChairVisualSpec,
  createBanquetChairBackRimShape,
  createBanquetChairBackShape,
  TRADES_HALL_CHAIR_COLORS,
} from "../meshes/ChairMesh.js";

function banquetChair() {
  const item = getCatalogueItemBySlug("banquet-chair");
  if (item === undefined) {
    throw new Error("Banquet chair catalogue item missing");
  }
  return item;
}

describe("ChairMesh visual spec", () => {
  it("keeps the chair inside its placement footprint while adding a slimmer padded silhouette", () => {
    const spec = computeBanquetChairVisualSpec(banquetChair());

    expect(spec.seatWidth).toBeLessThan(spec.renderWidth);
    expect(spec.seatDepth).toBeLessThan(spec.renderDepth);
    expect(spec.legX).toBeLessThan(spec.renderWidth / 2);
    expect(Math.abs(spec.frontLegZ)).toBeLessThan(spec.renderDepth / 2);
    expect(Math.abs(spec.rearLegZ)).toBeLessThan(spec.renderDepth / 2);
  });

  it("uses the Trades Hall chair palette rather than a single red placeholder material", () => {
    const spec = computeBanquetChairVisualSpec(banquetChair());

    expect(spec.upholsteryColor).toBe(TRADES_HALL_CHAIR_COLORS.upholstery);
    expect(spec.cushionShadowColor).toBe(TRADES_HALL_CHAIR_COLORS.cushionShadow);
    expect(spec.backPanelColor).toBe(TRADES_HALL_CHAIR_COLORS.backPanel);
    expect(spec.edgeColor).toBe(TRADES_HALL_CHAIR_COLORS.edge);
    expect(spec.frameColor).toBe(TRADES_HALL_CHAIR_COLORS.frame);
  });

  it("still lets placement ghosts override the entire chair colour", () => {
    const override = "#33cc66";
    const spec = computeBanquetChairVisualSpec(banquetChair(), override);

    expect(spec.upholsteryColor).toBe(override);
    expect(spec.cushionShadowColor).toBe(override);
    expect(spec.backPanelColor).toBe(override);
    expect(spec.edgeColor).toBe(override);
    expect(spec.frameColor).toBe(override);
  });

  it("builds a rounded-back shape for the black inset and red edge", () => {
    const shape = createBanquetChairBackShape(0.6, 0.42);
    const points = shape.getPoints(24);
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));

    expect(minX).toBeCloseTo(-0.3);
    expect(maxX).toBeCloseTo(0.3);
    expect(minY).toBeCloseTo(-0.21);
    expect(maxY).toBeCloseTo(0.21);
  });

  it("cuts the red backrest edge into a rim so the dark insert stays visible", () => {
    const rim = createBanquetChairBackRimShape(0.6, 0.42, 0.46, 0.32, -0.02);

    expect(rim.holes).toHaveLength(1);
  });
});
