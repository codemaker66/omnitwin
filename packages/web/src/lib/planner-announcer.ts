// ---------------------------------------------------------------------------
// The planner's polite voice for its keys (approved spec §12): one visually
// hidden status region on the page, made on first use and shared by both
// chromes, so what a key did is heard without moving focus. Each line goes
// in as a new node, so the same words twice are read twice. Refusals and
// receipts keep their own channel (stores/placement-notice-store.ts).
// ---------------------------------------------------------------------------

const REGION_ID = "planner-announcer";

function region(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const found = document.getElementById(REGION_ID);
  if (found !== null) return found;
  const made = document.createElement("div");
  made.id = REGION_ID;
  made.className = "vv-sr-only";
  made.setAttribute("role", "status");
  made.setAttribute("aria-live", "polite");
  made.setAttribute("aria-atomic", "true");
  made.dataset.testid = REGION_ID;
  document.body.appendChild(made);
  return made;
}

/** Says `words` politely, after whatever the screen reader is reading. */
export function announcePolitely(words: string): void {
  const text = words.trim();
  const live = text === "" ? null : region();
  if (live === null) return;
  const line = document.createElement("div");
  line.textContent = text;
  live.replaceChildren(line);
}

/** The last words said, for tests. */
export function lastAnnouncement(): string {
  return typeof document === "undefined" ? "" : document.getElementById(REGION_ID)?.textContent ?? "";
}
