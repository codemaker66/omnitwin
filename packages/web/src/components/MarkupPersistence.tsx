import { useEffect, useMemo, useRef } from "react";
import { useEditorStore } from "../stores/editor-store.js";
import { parsePlannerMarkup, serializePlannerMarkup, useMarkupStore } from "../stores/markup-store.js";

const STORAGE_PREFIX = "venviewer:planner-markup:v1:";

function storageKeyForConfig(configId: string | null): string {
  return `${STORAGE_PREFIX}${configId ?? "anonymous"}`;
}

export function MarkupPersistence(): null {
  const configId = useEditorStore((state) => state.configId);
  const strokes = useMarkupStore((state) => state.strokes);
  const key = useMemo(() => storageKeyForConfig(configId), [configId]);
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(key);
    useMarkupStore.getState().loadStrokes(parsePlannerMarkup(stored));
    loadedKeyRef.current = key;
  }, [key]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loadedKeyRef.current !== key) return;
    window.localStorage.setItem(key, serializePlannerMarkup(strokes));
  }, [key, strokes]);

  return null;
}
