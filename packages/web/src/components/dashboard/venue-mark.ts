import { WORKSPACE_COLOURS } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// The venue mark in Venue settings: the venue's initials on its own colour.
// The colour is whatever the venue chose, so the letters take whichever house
// ink reads better on it (WCAG relative luminance, as the register's own
// contrast audit measures it).
// ---------------------------------------------------------------------------

const HEX_COLOUR = /^#[0-9a-f]{6}$/iu;

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => channel(Number.parseInt(hex.slice(start, start + 2), 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [light = 0, dark = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Dark house ink on the venue's colour, unless paper reads better on it. */
export function markInk(colour: string): "dark" | "light" {
  if (!HEX_COLOUR.test(colour)) return "dark";
  return contrast(WORKSPACE_COLOURS["ink-1"], colour) >= contrast(WORKSPACE_COLOURS.paper, colour) ? "dark" : "light";
}

/** "Trades Hall Glasgow" → "TH"; a single word gives its first two letters. */
export function markInitials(name: string): string {
  const words = name.trim().split(/\s+/u).filter((word) => word.length > 0);
  const initials = words.length >= 2
    ? `${words[0]?.charAt(0) ?? ""}${words[1]?.charAt(0) ?? ""}`
    : (words[0] ?? "").slice(0, 2);
  return initials.toUpperCase() || "V";
}
