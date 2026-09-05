import { useState, type ReactElement } from "react";
import type { InventoryWindow } from "@omnitwin/types";
import { ActivityIndicator } from "../../shared/Activity.js";
import { inventoryClockLabel, inventoryWindowInput, type InventoryWindowDraft } from "./inventory-window.js";

interface Props {
  readonly initial: InventoryWindowDraft;
  readonly onAssess: (window: InventoryWindow) => void;
  readonly onChange: () => void;
  readonly disabled: boolean;
  readonly busy: boolean;
}

export function InventoryWindowForm({ initial, onAssess, onChange, disabled, busy }: Props): ReactElement {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const change = (field: keyof InventoryWindowDraft, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value })); setError(null); onChange();
  };
  return <form className="inventory-window" onSubmit={(event) => {
    event.preventDefault();
    if (disabled || busy) return;
    const result = inventoryWindowInput(draft);
    if (!result.success) { setError(result.message); return; }
    setError(null); onAssess(result.data);
  }}>
    <div className="inventory-window-fields">
      <label className="inventory-field"><span>From</span><input type="datetime-local" value={draft.startsAt}
        disabled={disabled} onChange={(event) => { change("startsAt", event.target.value); }} /></label>
      <label className="inventory-field"><span>Until</span><input type="datetime-local" value={draft.endsAt}
        disabled={disabled} onChange={(event) => { change("endsAt", event.target.value); }} /></label>
      <button className="inventory-button" type="submit" disabled={disabled || busy} aria-busy={busy}>
        {busy ? <ActivityIndicator size={18} /> : null}{busy ? "Assessing…" : "Assess demand"}</button>
    </div>
    <p className="inventory-muted inventory-small">Dates and times use your browser clock: {inventoryClockLabel()}.</p>
    {error !== null ? <p role="alert" className="inventory-error">{error}</p> : null}
  </form>;
}
