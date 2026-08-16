import { useMemo, type ReactElement } from "react";
import { History } from "lucide-react";
import { LensPanel, LensPanelSection } from "../components/editor/cockpit/LensPanel.js";
import { TimeMachinePanel } from "../components/editor/TimeMachinePanel.js";
import { changeHistoryRows } from "../lib/change-history-model.js";
import type { AuditLogEntry } from "../api/action-log.js";
import "./TimeMachineFixturePage.css";

// ---------------------------------------------------------------------------
// Dev fixture route (/dev/time-machine) — the Time Machine inside real lens
// chrome, with a seeded trail. Sibling of /dev/evidence-chips.
//
// Why this exists: the Change history section only populates for an
// AUTHENTICATED operator on a configuration that already carries a recorded
// trail, so the populated state is unreachable from a guest draft. This
// mounts the SAME components the Evidence lens composes (LensPanel >
// LensPanelSection > TimeMachinePanel) against a fixed trail, so the
// populated rendering can be reviewed and screenshotted deterministically.
//
// It also shows the anchor fix side by side. The trail below records only the
// gestures made SINCE the layout loaded — exactly like production, where
// loadConfiguration writes a saved layout's objects into the store and emits
// no Action for them. The left panel is handed the live room and
// reverse-replays the trail to recover what the layout was loaded with; the
// right panel is not, so it reconstructs from an empty floor. The missing top
// table and dancefloor on the right ARE the defect fe6b4c3a fixed.
//
// Dev diagnostic surface: synthetic data, no API calls, no network.
// ---------------------------------------------------------------------------

/** A `type`, never an `interface`: interfaces carry no implicit index
 *  signature, so they satisfy neither JsonValue nor ReplayObject even when
 *  every member is JSON-safe. */
type PlanObject = {
  readonly id: string;
  readonly kind: string;
  readonly positionX: number;
  readonly positionZ: number;
};

const TOP_TABLE: PlanObject = { id: "top-table", kind: "top-table", positionX: -6, positionZ: -4 };
const DANCEFLOOR: PlanObject = { id: "dancefloor", kind: "dancefloor", positionX: 0, positionZ: 6 };
const TABLE_A: PlanObject = { id: "table-a", kind: "table-round", positionX: -3, positionZ: 0 };
const TABLE_B_BEFORE: PlanObject = { id: "table-b", kind: "table-round", positionX: 3, positionZ: 0 };
const TABLE_B_AFTER: PlanObject = { id: "table-b", kind: "table-round", positionX: 5, positionZ: 2 };
const CHAIR: PlanObject = { id: "chair-1", kind: "chair", positionX: -3, positionZ: 2 };
const TABLE_C: PlanObject = { id: "table-c", kind: "table-round", positionX: 0, positionZ: -2 };

/** The room as it stands NOW, after every recorded gesture below. The room it
 *  was LOADED with — the top table and the dancefloor — is deliberately absent
 *  from the trail, because loadConfiguration records no Action for it. */
const LIVE: readonly PlanObject[] = [TOP_TABLE, DANCEFLOOR, TABLE_A, TABLE_B_AFTER, TABLE_C];

interface Delta {
  readonly label: string;
  readonly added?: readonly { readonly object: PlanObject; readonly index: number }[];
  readonly removed?: readonly { readonly object: PlanObject; readonly index: number }[];
  readonly updated?: readonly {
    readonly id: string;
    readonly before: Record<string, number>;
    readonly after: Record<string, number>;
  }[];
}

function entry(
  ordinal: number,
  intent: string,
  payload: Delta,
  inverse: Delta,
  minute: number,
): AuditLogEntry {
  const clock = `2026-07-25T14:${String(minute).padStart(2, "0")}:00.000Z`;
  return {
    ordinal,
    id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    batchId: "0d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e",
    revision: 3,
    submittedBy: "00000000-0000-4000-8000-000000000099",
    actor: { kind: "operator", ref: "coordinator" },
    intent,
    payload: { added: [], removed: [], updated: [], ...payload },
    inverse: { added: [], removed: [], updated: [], ...inverse },
    provenance: { surface: "planner", tool: "catalogue" },
    recordedTs: clock,
    receivedAt: clock,
  };
}

/** Six gestures on a room that already held a top table and a dancefloor. */
const TRAIL: readonly AuditLogEntry[] = [
  entry(1, "object.place",
    { label: "Place", added: [{ object: TABLE_A, index: 2 }] },
    { label: "Place", removed: [{ object: TABLE_A, index: 2 }] }, 2),
  entry(2, "object.place",
    { label: "Place", added: [{ object: TABLE_B_BEFORE, index: 3 }] },
    { label: "Place", removed: [{ object: TABLE_B_BEFORE, index: 3 }] }, 5),
  entry(3, "object.place",
    { label: "Place", added: [{ object: CHAIR, index: 4 }] },
    { label: "Place", removed: [{ object: CHAIR, index: 4 }] }, 9),
  entry(4, "object.update",
    { label: "Move", updated: [{ id: "table-b", before: { positionX: 3, positionZ: 0 }, after: { positionX: 5, positionZ: 2 } }] },
    { label: "Move", updated: [{ id: "table-b", before: { positionX: 5, positionZ: 2 }, after: { positionX: 3, positionZ: 0 } }] }, 14),
  entry(5, "object.remove",
    { label: "Remove", removed: [{ object: CHAIR, index: 4 }] },
    { label: "Remove", added: [{ object: CHAIR, index: 4 }] }, 18),
  entry(6, "object.place",
    { label: "Place", added: [{ object: TABLE_C, index: 4 }] },
    { label: "Place", removed: [{ object: TABLE_C, index: 4 }] }, 23),
];

function HistoryRows({ entries }: { readonly entries: readonly AuditLogEntry[] }): ReactElement {
  const rows = useMemo(() => changeHistoryRows(entries), [entries]);
  return (
    <>
      {rows.map((row) => (
        <div key={row.ordinal} className="lens-panel__row" data-testid="change-history-row">
          <div className="lens-panel__row-head">
            <span className="lens-panel__row-title">{row.title}</span>
            <span className="lens-panel__chip lens-panel__chip--info">{row.when}</span>
          </div>
          <div className="lens-panel__row-meta">{row.origin}</div>
        </div>
      ))}
    </>
  );
}

export function TimeMachineFixturePage(): ReactElement {
  return (
    <main className="tm-fixture" data-testid="time-machine-fixture">
      <header className="tm-fixture__head">
        <h1>Time machine — recorded trail</h1>
        <p>
          The same components the Evidence lens composes, against a fixed six-gesture
          trail on a room that was loaded with a top table and a dancefloor. Synthetic
          data for review — no network, no API.
        </p>
      </header>

      <div className="tm-fixture__grid">
        <section className="tm-fixture__col" data-testid="fixture-anchored">
          <h2 className="tm-fixture__col-head">Anchored — given the live room</h2>
          <LensPanel
            eyebrow="Evidence lens"
            title="Layout evidence"
            icon={<History size={18} />}
            source="6 changes"
            testId="fixture-lens-anchored"
            footer="Times are the operator's clock as recorded, never server-verified. Restoring appends a reversible change; it never erases history."
          >
            <LensPanelSection label="Change history">
              <div className="lens-panel__row tm-fixture__mount">
                <TimeMachinePanel entries={TRAIL} live={LIVE} />
              </div>
              <HistoryRows entries={TRAIL} />
            </LensPanelSection>
          </LensPanel>
        </section>

        <section className="tm-fixture__col" data-testid="fixture-unanchored">
          <h2 className="tm-fixture__col-head">Unanchored — the defect this fixes</h2>
          <LensPanel
            eyebrow="Evidence lens"
            title="Layout evidence"
            icon={<History size={18} />}
            source="6 changes"
            testId="fixture-lens-unanchored"
            footer="Without the live room the trail replays from an empty floor, so the top table and dancefloor the layout was loaded with are missing at every point."
          >
            <LensPanelSection label="Change history">
              <div className="lens-panel__row tm-fixture__mount">
                <TimeMachinePanel entries={TRAIL} />
              </div>
            </LensPanelSection>
          </LensPanel>
        </section>
      </div>
    </main>
  );
}
