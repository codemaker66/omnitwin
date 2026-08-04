/** Coordinate provenance for persisted layout geometry. */
export const LEGACY_RENDER_COORDINATE_SPACE = "legacy_render_v0";
export const REAL_METRE_COORDINATE_SPACE = "real_m_v1";

export type LayoutCoordinateSpace =
  | typeof LEGACY_RENDER_COORDINATE_SPACE
  | typeof REAL_METRE_COORDINATE_SPACE;
