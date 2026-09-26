import type { TruthModeTokenCategory } from "./truth-mode.js";

// ---------------------------------------------------------------------------
// Design tokens — single source of truth for brand, severity, and sheet
// typography + spacing values.
//
// Before this module existed, the web palette (`ui-palette.ts`) had
// `GOLD = "#c9a84c"` while the PDF renderer declared `GOLD = "#b8982f"`
// as a local const — different values for the same brand accent in two
// places. This module collapses that drift and gives both renderers
// (web HallkeeperPage + pdfkit sheet) a shared vocabulary for:
//
//   - Brand accents (gold, navy, green)
//   - Severity palette (critical / warning / info / success) for
//     callouts, banners, email highlights
//   - Sheet typography scale + spacing scale so the PDF and tablet
//     render identical hierarchies
//
// Tokens are plain data — no JSX, no style objects, no platform-specific
// units. Renderers translate them at the site they're consumed (React
// CSSProperties vs pdfkit fontSize). That keeps this module usable from
// Node (PDF) and browser (React) without any bundler trickery.
//
// NOTE on the "two golds": the paper gold (`goldPrint`) is a slightly
// warmer variant that prints better under typical office-paper
// reflectance. On-screen rendering should use `gold`. A renderer is
// free to pick either — they're both "brand gold", visually close
// enough that a viewer reading paper + screen side-by-side will see
// them as the same colour.
// ---------------------------------------------------------------------------

export const BRAND = {
  /** On-screen accent — web panels, tablet highlights, editor overlays. */
  gold: "#c9a84c",
  /** Paper-toned accent — PDF gold for sheets printed on white stock. */
  goldPrint: "#b8982f",
  /** Hover / lit variant of gold — used sparingly for emphasis. */
  goldLight: "#d4b84a",
  /** Primary brand navy — email header, dark-theme chrome. */
  navy: "#1a1a2e",
  /** Success / completion accent. */
  green: "#5ba870",
  /** Deep green reserved for "approved" status pills + banners. */
  greenDeep: "#0b6b2c",
} as const;

export const INK = {
  /** Strong text on white — headings, body copy. */
  onPaper: "#1a1a1a",
  /** Secondary text on white — subtitles, captions. */
  onPaperDim: "#555555",
  /** Tertiary text on white — placeholders, caption meta. */
  onPaperFaint: "#999999",
  /** Muted rule between paper sections. */
  paperRule: "#d0c8b0",
  /** Alternating row shade on paper tables. */
  paperRowShade: "#f7f5f0",
} as const;

export const DARK = {
  /** Full page background on dark UIs (hallkeeper tablet). */
  pageBg: "#111",
  /** Slightly-lifted surface — panels, cards, headers. */
  cardBg: "#1a1a1d",
  /** Inline input background inside a card. */
  inputBg: "#111",
  /** Hairline border between cards / inputs. */
  border: "#2a2824",
  /** Secondary text on dark. */
  textSec: "#9a9690",
  /** Muted text on dark — placeholders, disabled. */
  textMut: "#5c5955",
} as const;

// ---------------------------------------------------------------------------
// Severity palette — the four tones used by accessibility callouts,
// email banners, dashboard status pills, and review lifecycle alerts.
// Each tone defines background + border + foreground. Renderers pick
// the visible triplet appropriate for their surface (light card vs
// dark row vs paper page).
// ---------------------------------------------------------------------------

export interface SeverityPaletteEntry {
  /** Light-surface background (email, web card, PDF callout). */
  readonly background: string;
  /** Border / left-rule accent. */
  readonly border: string;
  /** Foreground text on the background. */
  readonly foreground: string;
}

export const SEVERITY_PALETTE: Readonly<Record<"critical" | "warning" | "info" | "success", SeverityPaletteEntry>> = {
  critical: { background: "#fef2f2", border: "#ef4444", foreground: "#a02020" },
  warning:  { background: "#fffbeb", border: "#d97706", foreground: "#8c5a00" },
  info:     { background: "#f9f9f6", border: "#d0c8b0", foreground: "#555555" },
  success:  { background: "#f0fdf4", border: "#059669", foreground: "#065f2b" },
};

// ---------------------------------------------------------------------------
// Sheet typography scale — one set of sizes, weights, and tracking for
// both PDF and tablet renderers.
//
// Size units are POINTS (1pt = 1/72 inch). Web renderers can treat
// them as CSS `px` — at standard 96dpi the mismatch is small enough
// that the visual hierarchy is preserved. If pixel-exactness is ever
// required, a renderer converts via `pt * 96 / 72`.
//
// Letter spacing (`tracking`) uses EM units; the PDF renderer converts
// to character-spacing at render time. A null tracking entry means
// "use renderer default".
// ---------------------------------------------------------------------------

export interface TypeStep {
  readonly size: number;
  readonly weight: 400 | 500 | 600 | 700 | 800;
  readonly tracking?: number;
  readonly uppercase?: boolean;
  /**
   * True when the value renders in tabular-nums. Quantity columns on the
   * sheet MUST use this so "×1" and "×100" line up visually.
   */
  readonly tabular?: boolean;
}

export const SHEET_TYPE: Readonly<Record<
  | "label"     // tiny uppercase label at the top of a header/section
  | "h1"        // event name
  | "h2"        // phase titles
  | "h3"        // zone titles
  | "body"      // row names, paragraph text
  | "caption"   // footer, metadata
  | "quantity", // big gold qty in row lines
  TypeStep
>> = {
  label:    { size: 7,  weight: 700, tracking: 0.12, uppercase: true },
  h1:       { size: 24, weight: 800, tracking: -0.5 },
  h2:       { size: 14, weight: 700 },
  h3:       { size: 11, weight: 700, tracking: 0.04, uppercase: true },
  body:     { size: 10, weight: 400 },
  caption:  { size: 9,  weight: 400 },
  quantity: { size: 13, weight: 800, tabular: true },
};

// ---------------------------------------------------------------------------
// Spacing scale — 2/4/8/14/22/36-pt rhythm. Renderers pick token values
// for gaps between sections so the PDF and tablet visually breathe at
// the same cadence. Values are POINTS (PDF) / pixels (web) — see the
// typography note above.
// ---------------------------------------------------------------------------

export const SHEET_SPACING = {
  xs: 2,
  sm: 4,
  md: 8,
  lg: 14,
  xl: 22,
  xxl: 36,
} as const;

// ---------------------------------------------------------------------------
// Truth Mode visual tokens. These are semantic trust-state categories, not
// component styles. Runtime surfaces choose how to render them, but every
// token carries at least one non-color hook so Truth Mode never relies on
// color alone.
// ---------------------------------------------------------------------------

export type TruthModeNonColorEncoding = "hatch" | "stipple" | "outline" | "badge" | "label";

export interface TruthModeVisualToken {
  readonly background: string;
  readonly border: string;
  readonly foreground: string;
  readonly accent: string;
  readonly nonColorEncodings: readonly TruthModeNonColorEncoding[];
  readonly badge: string;
  readonly label: string;
}

export const TRUTH_MODE_TOKENS: Readonly<Record<TruthModeTokenCategory, TruthModeVisualToken>> = {
  observed: {
    background: "#edf6ff",
    border: "#2f80ed",
    foreground: "#123a62",
    accent: "#2f80ed",
    nonColorEncodings: ["outline", "label"],
    badge: "OBS",
    label: "Observed",
  },
  fused: {
    background: "#eaf8f6",
    border: "#0f8b8d",
    foreground: "#114548",
    accent: "#0f8b8d",
    nonColorEncodings: ["outline", "badge"],
    badge: "FUS",
    label: "Fused",
  },
  inferred: {
    background: "#fff7e6",
    border: "#d49a2a",
    foreground: "#5f3f0e",
    accent: "#d49a2a",
    nonColorEncodings: ["stipple", "label"],
    badge: "INF",
    label: "Inferred",
  },
  "ai-generated": {
    background: "#f2eefc",
    border: "#7c5cc4",
    foreground: "#3d2b63",
    accent: "#7c5cc4",
    nonColorEncodings: ["hatch", "badge"],
    badge: "AI",
    label: "AI generated",
  },
  "human-edited": {
    background: "#fbf1e8",
    border: "#b26b2f",
    foreground: "#5a3114",
    accent: "#b26b2f",
    nonColorEncodings: ["outline", "badge"],
    badge: "EDIT",
    label: "Human edited",
  },
  "artist-proxy": {
    background: "#fbeef1",
    border: "#b65a6a",
    foreground: "#5e2631",
    accent: "#b65a6a",
    nonColorEncodings: ["hatch", "label"],
    badge: "PROXY",
    label: "Artist proxy",
  },
  verified: {
    background: "#eefaf2",
    border: "#2f8f5b",
    foreground: "#15502f",
    accent: "#2f8f5b",
    nonColorEncodings: ["outline", "badge"],
    badge: "VER",
    label: "Verified",
  },
  contested: {
    background: "#fdf0f0",
    border: "#b84a4a",
    foreground: "#682323",
    accent: "#b84a4a",
    nonColorEncodings: ["stipple", "badge"],
    badge: "!",
    label: "Contested",
  },
  stale: {
    background: "#f5f0e8",
    border: "#7a6a58",
    foreground: "#40362b",
    accent: "#7a6a58",
    nonColorEncodings: ["outline", "label"],
    badge: "OLD",
    label: "Stale",
  },
  "known-unknown": {
    background: "#f0f2f5",
    border: "#4f5661",
    foreground: "#242a33",
    accent: "#4f5661",
    nonColorEncodings: ["hatch", "stipple", "label"],
    badge: "?",
    label: "Known unknown",
  },
} as const;

// ---------------------------------------------------------------------------
// Workspace register — T-635 (docs/design/platform-2026-09-26/design-system.md §2)
//
// The colours of the Enquiries desk Blake judged on 26 September 2026: the
// ivory register (sage ground, ivory sheet, copper plane) and the forest
// register (decision panels, confirmations). The web app declares each one as
// `--house-<key>` in packages/web/src/styles/house-tokens.css, and
// packages/web/src/__tests__/workspace-tokens.test.ts keeps the two identical
// and audits every allowed pairing for contrast. Renderers that are not CSS —
// email, PDF — read the same values from here, so a client's documents are in
// the same family as the tools that made them.
//
// Tones appear with a word, never as colour alone: `*-text` sits on the ivory
// sheet, `*-chip` on its own `*-wash`, `*-dot` beside a label, `*-lit` on
// forest. Amber means "pending elsewhere" (in review, a 1st option, awaiting
// the client); it is a status tone, not decoration.
// ---------------------------------------------------------------------------

export const WORKSPACE_COLOURS = {
  // Planes
  "ground": "#819087",
  "ground-plane": "#97a597",
  "sheet": "#f2eddd",
  "sheet-hover": "#ebe5d3",
  "sheet-selected": "#e5dec9",
  "paper": "#faf8f1",
  "overlay": "#f7f3e6",
  "plane": "#deb599",
  "plane-hover": "#d7aa8b",
  "forest": "#264337",
  "forest-deep": "#1f3a2f",
  "forest-field": "#2b4a3d",
  "cream": "#efe7cf",
  "cream-hover": "#f7f1de",
  // Ink
  "ink-1": "#14302a",
  "ink-2": "#42584e",
  "ink-3": "#55655c",
  "plane-ink": "#3e3528",
  "forest-ink-1": "#f2eee1",
  "forest-ink-2": "#d0d9cd",
  "forest-ink-3": "#a9bdb0",
  // Lines
  "rule": "#d9d4c2",
  "rule-strong": "#bfc0ac",
  "edge": "#747f6f",
  "forest-rule": "#4d6c5c",
  "forest-edge": "#86a192",
  // Tones
  "copper-text": "#94491f", "copper-chip": "#8a4119", "copper-wash": "#f3dcc9", "copper-dot": "#c1703f", "copper-lit": "#f0b68f",
  "amber-text": "#6f500f", "amber-chip": "#664a0c", "amber-wash": "#efe0b8", "amber-dot": "#c3952b", "amber-mark": "#a07614", "amber-lit": "#f0cf8f",
  "sage-text": "#2f5a3a", "sage-chip": "#2c5537", "sage-wash": "#dbe5d3", "sage-dot": "#5d8963", "sage-lit": "#9fc7ae",
  "brick-text": "#8a3522", "brick-strong": "#6f2616", "brick-chip": "#83311f", "brick-wash": "#f1d8cf", "brick-dot": "#b4513a", "brick-lit": "#ffcdb7",
  "slate-text": "#545e59", "slate-wash": "#e3e3db", "slate-dot": "#8e9992", "slate-lit": "#c9d1cb",
  // On the copper plane
  "plane-attention": "#7e2d1b",
  "plane-dot-new": "#9a4a25",
  "plane-dot-review": "#77581a",
  "plane-dot-approved": "#3d6b47",
  "plane-dot-declined": "#8a3522",
  "plane-dot-withdrawn": "#5d6862",
} as const;

export type WorkspaceColour = keyof typeof WORKSPACE_COLOURS;

export const WORKSPACE_FONTS = {
  /** Meaning: titles, names, lede sentences, quotations, date numerals. */
  serif: "\"Newsreader\", Georgia, \"Times New Roman\", serif",
  /** Operation: UI text, labels, numerals, controls. */
  sans: "Inter, ui-sans-serif, system-ui, sans-serif",
  /** Reference codes only. */
  mono: "\"Geist Mono\", ui-monospace, monospace",
} as const;
