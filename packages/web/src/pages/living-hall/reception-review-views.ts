export type ReceptionReviewViewId =
  | "overview"
  | "timber-left"
  | "timber-right"
  | "floor-surface"
  | "ceiling-moulding"
  | "column-skirting";

export type ExperimentalReceptionReviewViewId = `experimental-e57:${string}`;

export type ReceptionReviewViewKey =
  | ReceptionReviewViewId
  | ExperimentalReceptionReviewViewId;

export interface ReceptionReviewView {
  readonly id: ReceptionReviewViewKey;
  readonly label: string;
  readonly featureClass: string;
  readonly camera: readonly [number, number, number];
  readonly lookAt: readonly [number, number, number];
  readonly up?: readonly [number, number, number];
  readonly verticalFovDegrees: number;
  readonly near: 0.1;
  readonly far: 120;
  /** Present only on a validated, development-only query camera. */
  readonly experimentalViewId?: string;
}

/**
 * The six historical Reception QA cameras, now made explicit so the real
 * Living Hall component and the diagnostic fixture can be compared without a
 * moving or approximately matched camera. Coordinates are post Z-up to Y-up
 * conversion and are not a metric E57 registration.
 */
export const RECEPTION_REVIEW_VIEWS = [
  {
    id: "overview",
    label: "Overview",
    featureClass: "room-scale consistency and broad edge stability",
    camera: [-2.408, 1.449, 9.752],
    lookAt: [-2.652, -5.022, -11.676],
    verticalFovDegrees: 48,
    near: 0.1,
    far: 120,
  },
  {
    id: "timber-left",
    label: "Timber left",
    featureClass: "dark timber doors, panels and glazing on the left",
    camera: [-2.408, 1.449, 9.752],
    lookAt: [-6.5, -3.5, -11.5],
    verticalFovDegrees: 25,
    near: 0.1,
    far: 120,
  },
  {
    id: "timber-right",
    label: "Timber right",
    featureClass: "dark timber doors, panels and glazing on the right",
    camera: [-2.408, 1.449, 9.752],
    lookAt: [0, -3.5, -11.5],
    verticalFovDegrees: 25,
    near: 0.1,
    far: 120,
  },
  {
    id: "floor-surface",
    label: "Floor surface",
    featureClass: "floorboard edge ghosting and replacement-level duplication",
    camera: [-2.408, 1.449, 9.752],
    lookAt: [-3, -5, -4],
    verticalFovDegrees: 28,
    near: 0.1,
    far: 120,
  },
  {
    id: "ceiling-moulding",
    label: "Ceiling moulding",
    featureClass: "ceiling moulding and high-frequency edge stability",
    camera: [-2.408, 1.449, 9.752],
    lookAt: [-3, 0, -11.5],
    verticalFovDegrees: 24,
    near: 0.1,
    far: 120,
  },
  {
    id: "column-skirting",
    label: "Column and skirting",
    featureClass: "column/skirting boundary and structural edge stability",
    camera: [-2.408, 1.449, 9.752],
    lookAt: [1, -3, -10],
    verticalFovDegrees: 24,
    near: 0.1,
    far: 120,
  },
] as const satisfies readonly ReceptionReviewView[];

export function findReceptionReviewView(
  id: string | null,
): ReceptionReviewView | null {
  return RECEPTION_REVIEW_VIEWS.find((view) => view.id === id) ?? null;
}
