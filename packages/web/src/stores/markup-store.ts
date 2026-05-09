import { create } from "zustand";
import { z } from "zod";

export const MARKUP_COLOR_VALUES = ["gold", "ivory", "ruby", "cyan"] as const;
export type MarkupColor = typeof MARKUP_COLOR_VALUES[number];

export interface MarkupPoint {
  readonly x: number;
  readonly z: number;
}

export interface MarkupStroke {
  readonly id: string;
  readonly color: MarkupColor;
  readonly width: number;
  readonly points: readonly MarkupPoint[];
  readonly createdAtMs: number;
}

export interface MarkupState {
  readonly active: boolean;
  readonly strokes: readonly MarkupStroke[];
  readonly draftStroke: MarkupStroke | null;
  readonly selectedColor: MarkupColor;
  readonly selectedWidth: number;
  readonly nextStrokeIndex: number;
  readonly setActive: (active: boolean) => void;
  readonly setColor: (color: MarkupColor) => void;
  readonly setWidth: (width: number) => void;
  readonly beginStroke: (point: MarkupPoint) => void;
  readonly appendPoint: (point: MarkupPoint) => void;
  readonly commitStroke: () => void;
  readonly cancelStroke: () => void;
  readonly undoStroke: () => void;
  readonly clearStrokes: () => void;
  readonly loadStrokes: (strokes: readonly MarkupStroke[]) => void;
}

const MIN_POINT_DISTANCE = 0.06;
const MIN_STROKE_POINTS = 2;
const MAX_STROKES = 160;
const MAX_POINTS_PER_STROKE = 900;
const MIN_WIDTH = 0.012;
const MAX_WIDTH = 0.08;

const markupPointSchema = z.object({
  x: z.number().finite(),
  z: z.number().finite(),
});

const markupStrokeSchema = z.object({
  id: z.string().min(1),
  color: z.enum(MARKUP_COLOR_VALUES),
  width: z.number().finite().min(MIN_WIDTH).max(MAX_WIDTH),
  points: z.array(markupPointSchema).min(MIN_STROKE_POINTS).max(MAX_POINTS_PER_STROKE),
  createdAtMs: z.number().finite().nonnegative(),
});

const persistedMarkupSchema = z.object({
  version: z.literal(1),
  strokes: z.array(markupStrokeSchema).max(MAX_STROKES),
});

function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

function isMeaningfulPoint(next: MarkupPoint, previous: MarkupPoint | undefined): boolean {
  if (previous === undefined) return true;
  return Math.hypot(next.x - previous.x, next.z - previous.z) >= MIN_POINT_DISTANCE;
}

function createStrokeId(index: number): string {
  return `markup-${String(index)}`;
}

function nextIndexAfter(strokes: readonly MarkupStroke[]): number {
  let maxIndex = 0;
  for (const stroke of strokes) {
    const parsed = /^markup-(\d+)$/.exec(stroke.id);
    if (parsed?.[1] === undefined) continue;
    maxIndex = Math.max(maxIndex, Number.parseInt(parsed[1], 10));
  }
  return maxIndex + 1;
}

export function serializePlannerMarkup(strokes: readonly MarkupStroke[]): string {
  return JSON.stringify({
    version: 1,
    strokes: strokes.slice(-MAX_STROKES),
  });
}

export function parsePlannerMarkup(raw: string | null): readonly MarkupStroke[] {
  if (raw === null || raw.trim().length === 0) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  const parsed = persistedMarkupSchema.safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.strokes;
}

export const useMarkupStore = create<MarkupState>()((set, get) => ({
  active: false,
  strokes: [],
  draftStroke: null,
  selectedColor: "gold",
  selectedWidth: 0.034,
  nextStrokeIndex: 1,

  setActive: (active) => {
    set((state) => ({
      active,
      draftStroke: active ? state.draftStroke : null,
    }));
  },

  setColor: (color) => {
    set({ selectedColor: color });
  },

  setWidth: (width) => {
    set({ selectedWidth: clampWidth(width) });
  },

  beginStroke: (point) => {
    const state = get();
    if (!state.active) return;
    set({
      draftStroke: {
        id: createStrokeId(state.nextStrokeIndex),
        color: state.selectedColor,
        width: state.selectedWidth,
        points: [point],
        createdAtMs: Date.now(),
      },
    });
  },

  appendPoint: (point) => {
    const draft = get().draftStroke;
    if (draft === null) return;
    if (draft.points.length >= MAX_POINTS_PER_STROKE) return;
    const previous = draft.points[draft.points.length - 1];
    if (!isMeaningfulPoint(point, previous)) return;
    set({
      draftStroke: {
        ...draft,
        points: [...draft.points, point],
      },
    });
  },

  commitStroke: () => {
    const state = get();
    const draft = state.draftStroke;
    if (draft === null) return;
    if (draft.points.length < MIN_STROKE_POINTS) {
      set({ draftStroke: null });
      return;
    }
    set({
      strokes: [...state.strokes, draft].slice(-MAX_STROKES),
      draftStroke: null,
      nextStrokeIndex: state.nextStrokeIndex + 1,
    });
  },

  cancelStroke: () => {
    set({ draftStroke: null });
  },

  undoStroke: () => {
    const state = get();
    if (state.draftStroke !== null) {
      set({ draftStroke: null });
      return;
    }
    set({ strokes: state.strokes.slice(0, -1) });
  },

  clearStrokes: () => {
    set({ strokes: [], draftStroke: null });
  },

  loadStrokes: (strokes) => {
    const safeStrokes = persistedMarkupSchema.shape.strokes.safeParse(strokes);
    const loaded = safeStrokes.success ? safeStrokes.data : [];
    set({
      strokes: loaded,
      draftStroke: null,
      nextStrokeIndex: nextIndexAfter(loaded),
    });
  },
}));
