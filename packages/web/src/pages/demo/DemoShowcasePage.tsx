import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, Maximize2, Minimize2, MoveUpRight, Sparkles } from "lucide-react";
import "./demo-showcase.css";

const chapters = ["The welcome", "The place", "The possibilities", "The whole picture", "A helping hand", "The handover", "The opportunity", "Built around you"];
const hero = "/images/venue/Grand-Hall-scaled-opt.jpg";
type Layout = "Dinner" | "Conference" | "Reception";

function FloorPlan({ layout }: { layout: Layout }): ReactElement {
  const id = useId().replace(/:/g, "");
  return <svg className="demo-floorplan" viewBox="0 0 620 410" role="img" aria-label={`Illustrative ${layout.toLowerCase()} arrangement, not a measured or approved room plan`}>
    <defs><pattern id={`${id}-grid`} width="22" height="22" patternUnits="userSpaceOnUse"><path d="M22 0H0V22" fill="none" stroke="#c7c4b3" strokeWidth=".45" /></pattern><filter id={`${id}-shadow`}><feDropShadow dx="0" dy="4" stdDeviation="3" floodOpacity=".12" /></filter></defs>
    <rect x="0" y="0" width="620" height="410" fill={`url(#${id}-grid)`} />
    <rect x="70" y="45" width="480" height="320" fill="#faf7ef" /><path d="M70 45H550V365H365M255 365H70V45" fill="none" stroke="#315349" strokeWidth="7" />
    {[110, 200, 290].map(y => <g key={y}><path d={`M65 ${String(y)}v35M555 ${String(y)}v35`} stroke="#c29369" strokeWidth="11" /></g>)}
    <path d="M255 365v-55a55 55 0 0 1 55 55M365 365v-55a55 55 0 0 0-55 55" fill="none" stroke="#a6b1a5" strokeWidth="1.5" />
    <rect x="230" y="58" width="160" height="32" rx="3" fill="#294d42" /><text x="310" y="79" textAnchor="middle" fill="#fff" fontSize="11" letterSpacing="2">{layout === "Conference" ? "PRESENTATION" : "FOCAL POINT"}</text>
    {layout === "Dinner" && [145, 310, 475].flatMap(x => [153, 269].map(y => <g key={`${String(x)}-${String(y)}`} filter={`url(#${id}-shadow)`}>{Array.from({length:8}, (_, i) => {const angle = i * Math.PI / 4; return <circle key={i} cx={x + Math.cos(angle) * 41} cy={y + Math.sin(angle) * 41} r="7" fill="#c39575" />;})}<circle cx={x} cy={y} r="30" fill="#ece7d9" stroke="#b6ab95" /><circle cx={x} cy={y} r="8" fill="#8c9e7b" /></g>))}
    {layout === "Conference" && [130, 167, 204, 241, 379, 416, 453, 490].flatMap(x => [135, 173, 211, 249, 287].map(y => <rect key={`${String(x)}-${String(y)}`} x={x-10} y={y} width="22" height="24" rx="5" fill="#b78468" stroke="#986e58" />))}
    {layout === "Reception" && [145, 310, 475].flatMap(x => [160, 270].map(y => <g key={`${String(x)}-${String(y)}`}><circle cx={x} cy={y} r="20" fill="#c2cbb3" stroke="#64806b" /><circle cx={x} cy={y} r="7" fill="#315349" /><path d={`M${String(x+35)} ${String(y-20)}q20 20 0 40`} stroke="#bf9577" fill="none" strokeDasharray="3 5" /></g>))}
    <text x="310" y="400" textAnchor="middle" fill="#657367" fontSize="10" letterSpacing="2">ILLUSTRATIVE ARRANGEMENT · NOT TO SCALE</text>
  </svg>;
}


export function DemoShowcasePage(): ReactElement {
  const [active, setActive] = useState(0);
  const [layout, setLayout] = useState<Layout>("Dinner");
  const [fullScreen, setFullScreen] = useState(false);
  const [fullScreenError, setFullScreenError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const move = useCallback((index: number) => { setActive(Math.max(0, Math.min(chapters.length - 1, index))); }, []);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Trades Hall, beautifully connected | Venviewer showcase";
    const onKey = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
      if (["ArrowRight", "PageDown"].includes(event.key)) { event.preventDefault(); setActive(value => Math.min(chapters.length - 1, value + 1)); }
      if (["ArrowLeft", "PageUp"].includes(event.key)) { event.preventDefault(); setActive(value => Math.max(0, value - 1)); }
      if (event.key === "Home") { event.preventDefault(); move(0); }
      if (event.key === "End") { event.preventDefault(); move(chapters.length - 1); }
    };
    const onFullscreen = (): void => { setFullScreen(document.fullscreenElement === root.current); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => { document.title = previousTitle; document.removeEventListener("keydown", onKey); document.removeEventListener("fullscreenchange", onFullscreen); };
  }, [move]);
  useEffect(() => { root.current?.querySelector<HTMLElement>(`[data-slide="${String(active)}"]`)?.scrollTo(0, 0); }, [active]);
  const toggleFullscreen = async (): Promise<void> => {
    setFullScreenError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (root.current?.requestFullscreen) await root.current.requestFullscreen();
      else setFullScreenError("Use your browser’s full-screen control to present.");
    } catch { setFullScreenError("Full screen is unavailable here. You can still use the chapter controls."); }
  };
  const dark = active === 0 || active === 7;
  return <div ref={root} className={`demo-showcase ${dark ? "demo-dark" : ""}`}>
    <header className="demo-header">
      <a href="/" className="demo-brand" aria-label="Venviewer home"><span className="demo-brand-mark">v</span><span>venviewer</span></a>
      <span className="demo-edition">TRADES HALL OF GLASGOW <span> / </span> A SHOWCASE FOR ELAINE</span>
      <div className="demo-header-actions"><a href="/demo/venviewer-elaine-showcase.pdf" download className="demo-icon-link"><ArrowDownToLine size={16} /><span>PDF deck</span></a><button type="button" onClick={() => void toggleFullscreen()} className="demo-present">{fullScreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}<span>{fullScreen ? "Exit" : "Present"}</span></button></div>
    </header>
    {fullScreenError && <p className="demo-fullscreen-error" role="status">{fullScreenError}</p>}
    <main className="demo-stage" aria-label="Venviewer presentation">
      <section data-slide="0" hidden={active !== 0} className="demo-slide demo-hero" aria-labelledby="demo-title-0">
        <img className="demo-cover" src={hero} alt="The Grand Hall dressed for dinner, beneath its gilded ceiling and chandeliers" fetchPriority="high" />
        <div className="demo-hero-shade" />
        <div className="demo-hero-content"><h1 id="demo-title-0">Plan your event.<br /><em>See it in the room.</em></h1><button className="demo-cream-button" onClick={() => { move(1); }}>Begin showcase <ArrowRight size={18} /></button></div>
        <div className="demo-hero-seal"><img src="/images/venues/trades-hall-glasgow-crest.png" alt="Trades Hall crest" /><span>TRADES HALL<br />OF GLASGOW</span></div>
        <span className="demo-photo-caption">THE GRAND HALL / VENUE PHOTOGRAPH</span>
      </section>

      <section data-slide="1" hidden={active !== 1} className="demo-slide demo-split" aria-labelledby="demo-title-1">
        <div className="demo-copy"><h2 id="demo-title-1">Explore<br /><em>Trades Hall.</em></h2><p>Explore captured rooms and venue photography before a visit.</p></div>
        <div className="demo-photo-composition"><img className="demo-room-tall" src="/images/venue/reception-wedding-opt.jpg" alt="A wedding ceremony arrangement in the Reception Room" /><div className="demo-room-label"><span>THE RECEPTION ROOM</span></div><img className="demo-room-inset" src="/images/venue/tour-door-1800.webp" alt="A captured three-dimensional view of Trades Hall" /><span className="demo-inset-label">CAPTURED VENUE / 3D VIEW</span></div>
      </section>

      <section data-slide="2" hidden={active !== 2} className="demo-slide demo-split demo-plan-slide" aria-labelledby="demo-title-2">
        <div className="demo-copy"><h2 id="demo-title-2">Arrange<br /><em>the room.</em></h2><p>Compare furniture arrangements for each occasion.</p><div className="demo-layout-options" aria-label="Illustrative arrangement">{(["Dinner", "Conference", "Reception"] as const).map(option => <button key={option} aria-pressed={layout === option} onClick={() => { setLayout(option); }}>{option}</button>)}</div><p className="demo-small-copy">Illustrative layouts. Venue plans are unchanged.</p></div>
        <div className="demo-plan-composition"><div className="demo-plan-paper"><div className="demo-paper-header"><span>THE GRAND HALL</span><span>LAYOUT STUDY</span></div><FloorPlan layout={layout} /><div className="demo-paper-footer"><strong>{layout} arrangement</strong><span>For discussion</span></div></div></div>
      </section>

      <section data-slide="3" hidden={active !== 3} className="demo-slide demo-split" aria-labelledby="demo-title-3">
        <div className="demo-copy"><h2 id="demo-title-3">Your rooms.<br /><em>Your diary.</em></h2><p>Bookings, room plans and equipment in one workspace.</p><div className="demo-feature-lines"><div><span>01</span><p><strong>Week overview</strong></p></div><div><span>02</span><p><strong>Event details</strong></p></div><div><span>03</span><p><strong>Linked room layouts</strong></p></div></div></div>
        <div className="demo-diary"><div className="demo-diary-top"><div><h3>The week ahead</h3></div><span className="demo-tag">ILLUSTRATIVE</span></div><div className="demo-calendar"><div className="demo-calendar-head"><span>ROOM</span><span>MON</span><span>TUE</span><span>WED</span></div>{[{room:"Grand Hall",image:"Grand-Hall-scaled-opt",name:"Celebration dinner",time:"Setup to evening",day:1,tone:"sage"},{room:"Reception Room",image:"reception-wedding-opt",name:"Private reception",time:"Afternoon",day:2,tone:"copper"},{room:"Robert Adam Room",image:"robert-adam-wedding-opt",name:"Team gathering",time:"Morning",day:3,tone:"blue"}].map(item => <div className="demo-calendar-row" key={item.room}><div className="demo-calendar-room"><img src={`/images/venue/${item.image}.jpg`} alt="" /><span>{item.room}</span></div>{[1,2,3].map(day => <div className="demo-calendar-cell" key={day}>{day === item.day && <div className={`demo-booking demo-${item.tone}`}><span>{item.time}</span><strong>{item.name}</strong><small>Example event</small></div>}</div>)}</div>)}</div><div className="demo-diary-bottom"><Check size={16}/><p>Your team keeps authority over bookings and changes.</p></div></div>
      </section>

      <section data-slide="4" hidden={active !== 4} className="demo-slide demo-split demo-assistant-slide" aria-labelledby="demo-title-4">
        <div className="demo-copy"><h2 id="demo-title-4">A helping hand.<br /><em>Your judgement.</em></h2><p>Describe a change, review a suggestion and decide.</p><p className="demo-small-copy">A scripted vision of conversational planning, subject to venue approval.</p><span className="demo-vision-label">PRODUCT VISION / SCRIPTED EXAMPLE</span></div>
        <div className="demo-assistant"><div className="demo-assistant-heading"><span className="demo-assistant-symbol"><Sparkles size={20} /></span><div><strong>Planning, in conversation</strong><span>A future Venviewer experience</span></div></div><div className="demo-message-user">Could we turn the afternoon reception into a seated dinner?</div><div className="demo-message-assistant"><Sparkles size={18} /><div><p>We would compare the room layout, available furniture and the time needed for the reset.</p></div></div><div className="demo-suggestion"><h3>Reception to dinner</h3><div><Check size={15} /> Explore a seated arrangement</div><div><Check size={15} /> Identify equipment to check</div><div><Check size={15} /> Surface timing implications</div><span className="demo-suggestion-footer">VENUE REVIEW BEFORE ANY CHANGE</span></div><p className="demo-assistant-caption">Illustration only. No live AI request or booking action.</p></div>
      </section>

      <section data-slide="5" hidden={active !== 5} className="demo-slide demo-split" aria-labelledby="demo-title-5">
        <div className="demo-copy"><h2 id="demo-title-5">The plan.<br /><em>The handover.</em></h2><p>Give the team the agreed layout and equipment sheet.</p></div>
        <div className="demo-handover-composition"><div className="demo-handover-sheet"><div className="demo-handover-title"><img src="/images/venues/trades-hall-glasgow-crest.png" alt="" /><div><span>TRADES HALL OF GLASGOW</span><h3>The room, ready.</h3></div></div><div className="demo-sheet-rule"/><div className="demo-sheet-sub"><strong>Grand Hall / Dinner setup</strong><span>EXAMPLE SHEET</span></div><FloorPlan layout="Dinner"/><div className="demo-sheet-items"><div><span>01</span><strong>Agreed layout</strong></div><div><span>02</span><strong>Equipment list</strong></div></div></div><div className="demo-handover-stamp">PLAN<br /><em>to place.</em></div></div>
      </section>

      <section data-slide="6" hidden={active !== 6} className="demo-slide demo-opportunity" aria-labelledby="demo-title-6">
        <div className="demo-opportunity-heading"><h2 id="demo-title-6">The opportunity</h2></div><div className="demo-value-grid"><article><span>FOR YOUR CLIENTS</span><h3>A place they<br />can picture.</h3><p>Help clients understand the space.</p><div className="demo-value-line"/></article><article><span>FOR YOUR TEAM</span><h3>A plan they<br />can share.</h3><p>Share layouts and operational details.</p><div className="demo-value-line"/></article><article><span>FOR THE BUSINESS</span><h3>A foundation<br />that can grow.</h3><p>Develop with Trades Hall, then explore other venues.</p><div className="demo-value-line"/></article></div><p className="demo-opportunity-foot">Outcomes to validate together: enquiry quality, planning time, handover clarity and team confidence.</p>
      </section>

      <section data-slide="7" hidden={active !== 7} className="demo-slide demo-hero demo-finale" aria-labelledby="demo-title-7"><img className="demo-cover" src="/images/venue/grand-hall-room.jpg" alt="The architecture and chandeliers of the Grand Hall" /><div className="demo-hero-shade"/><div className="demo-hero-content"><h2 id="demo-title-7">Explore<br /><em>Trades Hall.</em></h2><div className="demo-finale-actions"><a className="demo-cream-button" href="/venues/trades-hall/twin" target="_blank" rel="noreferrer">Explore the venue <MoveUpRight size={18}/></a><a className="demo-outline-button" href="/demo/venviewer-elaine-showcase.pdf" download>Keep the presentation <ArrowDownToLine size={17}/></a></div><p className="demo-finale-note">Illustrative showcase · future ambitions identified.</p></div></section>
    </main>
    <footer className="demo-footer"><span className="demo-display-note">DISPLAY ONLY <span> / </span> SEPTEMBER 2026</span><nav className="demo-chapters" aria-label="Presentation chapters">{chapters.map((chapter, index) => <button key={chapter} onClick={() => { move(index); }} aria-label={`Chapter ${String(index + 1)}: ${chapter}`} aria-current={active === index ? "step" : undefined}><span /></button>)}</nav><div className="demo-navigation"><span className="demo-chapter-count" aria-live="polite" aria-label={`Chapter ${String(active + 1)} of 8: ${chapters[active] ?? ""}`}>{String(active + 1).padStart(2,"0")} <span>/ 08</span></span><button onClick={() => { move(active - 1); }} disabled={active === 0} aria-label="Previous chapter"><ArrowLeft size={19}/></button><button onClick={() => { move(active + 1); }} disabled={active === 7} aria-label="Next chapter"><ArrowRight size={19}/></button></div></footer>
  </div>;
}
