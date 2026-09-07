import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { DashboardLayout } from "../../components/dashboard/DashboardLayout.js";
import walkthrough from "./hallkeeper-walkthrough.html?raw";
import "./hallkeeper-walkthrough.css";

// An opaque-origin sandbox keeps the fictional demonstration separate from
// authenticated venue data, storage and navigation. No messages cross it.
const documentSource = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>Hallkeeper workflow walkthrough — fictional example</title><style>html,body{margin:0;background:#faf8f3}body{padding:12px}*{box-sizing:border-box}@media(max-width:560px){body{padding:0}}</style></head><body>${walkthrough}</body></html>`;

export function HallkeeperWalkthroughPage(): ReactElement {
  const [session, setSession] = useState(0);
  return (
    <DashboardLayout mainLabel="Hallkeeper workflow walkthrough">
      <section className="hk-walkthrough">
        <header className="hk-walkthrough-header">
          <div>
            <h1>Hallkeeper walkthrough</h1>
            <p>Fictional demonstration · resets when you leave.</p>
          </div>
          <nav aria-label="Walkthrough controls">
            <Link to="/hallkeeper/today">Open live Day Board</Link>
            <button type="button" onClick={() => { setSession((value) => value + 1); }}>
              <RotateCcw size={16} aria-hidden="true" /> Restart walkthrough
            </button>
          </nav>
        </header>
        <iframe
          key={session}
          title="Interactive fictional hallkeeper day, including setup, client care and handover"
          srcDoc={documentSource}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
        />
      </section>
    </DashboardLayout>
  );
}
