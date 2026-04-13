import { useEffect } from "react";
import { useBookmarkStore } from "../stores/bookmark-store.js";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: "absolute",
  left: 20,
  bottom: 20,
  display: "flex",
  flexDirection: "row",
  gap: 6,
  zIndex: 10,
  pointerEvents: "auto",
  userSelect: "none",
};

const bookmarkButtonBase: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 12,
  fontFamily: "system-ui, -apple-system, sans-serif",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 6,
  background: "rgba(30, 30, 30, 0.85)",
  color: "#e0e0e0",
  cursor: "pointer",
  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
  transition: "background 0.15s, border-color 0.15s",
  whiteSpace: "nowrap" as const,
  lineHeight: 1.4,
};

const keyHintStyle: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.5,
  marginLeft: 4,
  fontFamily: "monospace",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Camera bookmark bar — bottom-left overlay.
 *
 * Displays saved camera positions as clickable buttons.
 * Number keys 1-9 jump to the corresponding bookmark.
 * Clicking a bookmark sets `pendingNavigationId` in the store,
 * which CameraRig consumes in its useFrame loop to start the transition.
 */
export function BookmarkPanel(): React.ReactElement {
  const bookmarks = useBookmarkStore((s) => s.bookmarks);
  const requestNavigation = useBookmarkStore((s) => s.requestNavigation);

  // Number key shortcuts (1-9)
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // Ignore if typing in an input
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

      const match = /^Digit([1-9])$/.exec(event.code);
      if (match === null) return;
      const index = Number(match[1]) - 1;
      const bookmark = useBookmarkStore.getState().bookmarks[index];
      if (bookmark !== undefined) {
        useBookmarkStore.getState().requestNavigation(bookmark.id);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, []);

  if (bookmarks.length === 0) return <div />;

  return (
    <div style={panelStyle} role="toolbar" aria-label="Camera bookmarks">
      {bookmarks.map((bookmark, index) => (
        <button
          key={bookmark.id}
          type="button"
          style={bookmarkButtonBase}
          onClick={() => { requestNavigation(bookmark.id); }}
          title={`${bookmark.name} (${String(index + 1)})`}
          aria-label={`Navigate to ${bookmark.name} camera view`}
        >
          {bookmark.name}
          {index < 9 && <span style={keyHintStyle} aria-hidden="true">{String(index + 1)}</span>}
        </button>
      ))}
    </div>
  );
}
