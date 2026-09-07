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

function Kicker({ children }: { children: string }): ReactElement { return <p className="demo-kicker">{children}</p>; }

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
      <a href="/" className="demo-brand" aria-label="Venviewer home"><span className="demo-brand-mark">v</span><span>venviewer<span className="demo-brand-sub">A NEW PERSPECTIVE ON YOUR VENUE</span></span></a>
      <span className="demo-edition">TRADES HALL OF GLASGOW <span> / </span> A SHOWCASE FOR ELAINE</span>
      <div className="demo-header-actions"><a href="/demo/venviewer-elaine-showcase.pdf" download className="demo-icon-link"><ArrowDownToLine size={16} /><span>PDF deck</span></a><button type="button" onClick={() => void toggleFullscreen()} className="demo-present">{fullScreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}<span>{fullScreen ? "Exit" : "Present"}</span></button></div>
    </header>
    {fullScreenError && <p className="demo-fullscreen-error" role="status">{fullScreenError}</p>}
    <main className="demo-stage" aria-label="Venviewer presentation">
      <section data-slide="0" hidden={active !== 0} className="demo-slide demo-hero" aria-labelledby="demo-title-0">
        <img className="demo-cover" src={hero} alt="The Grand Hall dressed for dinner, beneath its gilded ceiling and chandeliers" fetchPriority="high" />
        <div className="demo-hero-shade" />
        <div className="demo-hero-content"><Kicker>A PLACE THIS EXTRAORDINARY</Kicker><h1 id="demo-title-0">Deserves an<br />extraordinary<br /><em>way to plan.</em></h1><p>The character of Trades Hall.<br />The possibility of every event.<br />Beautifully brought together.</p><button className="demo-cream-button" onClick={() => { move(1); }}>Step inside the story <ArrowRight size={18} /></button></div>
        <div className="demo-hero-seal"><img src="/images/venues/trades-hall-glasgow-crest.png" alt="Trades Hall crest" /><span>TRADES HALL<br />OF GLASGOW</span></div>
        <span className="demo-photo-caption">THE GRAND HALL / VENUE PHOTOGRAPH</span>
      </section>

      <section data-slide="1" hidden={active !== 1} className="demo-slide demo-split" aria-labelledby="demo-title-1">
        <div className="demo-copy"><Kicker>01 / THE PLACE</Kicker><h2 id="demo-title-1">Let the room<br />make the<br /><em>first impression.</em></h2><p>Give someone a feeling for the venue before they ever walk through the door.</p><p className="demo-small-copy">Captured spaces and room photography bring the atmosphere into the conversation, wherever your client happens to be.</p><div className="demo-bottom-note"><span className="demo-line" />A more inviting beginning to an enquiry.</div></div>
        <div className="demo-photo-composition"><img className="demo-room-tall" src="/images/venue/reception-wedding-opt.jpg" alt="A wedding ceremony arrangement in the Reception Room" /><div className="demo-room-label"><span>THE RECEPTION ROOM</span><strong>Imagine the occasion.</strong></div><img className="demo-room-inset" src="/images/venue/tour-door-1800.webp" alt="A captured three-dimensional view of Trades Hall" /><span className="demo-inset-label">CAPTURED VENUE / 3D VIEW</span></div>
      </section>

      <section data-slide="2" hidden={active !== 2} className="demo-slide demo-split demo-plan-slide" aria-labelledby="demo-title-2">
        <div className="demo-copy"><Kicker>02 / THE POSSIBILITIES</Kicker><h2 id="demo-title-2">One room.<br />So many<br /><em>possibilities.</em></h2><p>Bring an idea into the room. Explore furniture arrangements and make the plan something everyone can see.</p><div className="demo-layout-options" aria-label="Illustrative arrangement">{(["Dinner", "Conference", "Reception"] as const).map(option => <button key={option} aria-pressed={layout === option} onClick={() => { setLayout(option); }}>{option}</button>)}</div><p className="demo-small-copy">Try a different occasion. These illustrative layouts demonstrate the idea, without changing venue plans.</p></div>
        <div className="demo-plan-composition"><div className="demo-plan-paper"><div className="demo-paper-header"><span>THE GRAND HALL</span><span>LAYOUT STUDY</span></div><FloorPlan layout={layout} /><div className="demo-paper-footer"><strong>{layout} arrangement</strong><span>For discussion</span></div></div><div className="demo-floating-note"><span className="demo-tiny-star">✦</span><div><strong>The idea becomes visible.</strong><span>A shared picture before the setup begins.</span></div></div></div>
      </section>

      <section data-slide="3" hidden={active !== 3} className="demo-slide demo-split" aria-labelledby="demo-title-3">
        <div className="demo-copy"><Kicker>03 / THE WHOLE PICTURE</Kicker><h2 id="demo-title-3">A busy venue.<br /><em>A clearer day.</em></h2><p>Bring the diary, room plans and equipment into the same conversation.</p><div className="demo-feature-lines"><div><span>01</span><p><strong>See the week.</strong> Understand how the rooms fit together.</p></div><div><span>02</span><p><strong>See the detail.</strong> Open the event behind the booking.</p></div><div><span>03</span><p><strong>Keep the context.</strong> Connect the room with the setup.</p></div></div></div>
        <div className="demo-diary"><div className="demo-diary-top"><div><span className="demo-kicker">YOUR VENUE AT A GLANCE</span><h3>The week ahead</h3></div><span className="demo-tag">ILLUSTRATIVE</span></div><div className="demo-calendar"><div className="demo-calendar-head"><span>ROOM</span><span>MON</span><span>TUE</span><span>WED</span></div>{[{room:"Grand Hall",image:"Grand-Hall-scaled-opt",name:"Celebration dinner",time:"Setup to evening",day:1,tone:"sage"},{room:"Reception Room",image:"reception-wedding-opt",name:"Private reception",time:"Afternoon",day:2,tone:"copper"},{room:"Robert Adam Room",image:"robert-adam-wedding-opt",name:"Team gathering",time:"Morning",day:3,tone:"blue"}].map(item => <div className="demo-calendar-row" key={item.room}><div className="demo-calendar-room"><img src={`/images/venue/${item.image}.jpg`} alt="" /><span>{item.room}</span></div>{[1,2,3].map(day => <div className="demo-calendar-cell" key={day}>{day === item.day && <div className={`demo-booking demo-${item.tone}`}><span>{item.time}</span><strong>{item.name}</strong><small>Example event</small></div>}</div>)}</div>)}</div><div className="demo-diary-bottom"><Check size={16}/><p>Your team keeps authority over bookings and changes.</p></div></div>
      </section>

      <section data-slide="4" hidden={active !== 4} className="demo-slide demo-split demo-assistant-slide" aria-labelledby="demo-title-4">
        <div className="demo-copy"><Kicker>04 / THE NEXT CHAPTER</Kicker><h2 id="demo-title-4">A helping hand.<br /><em>Your judgement.</em></h2><p>The ambition: describe what you need, explore a prepared suggestion, then decide what works for your venue.</p><p className="demo-small-copy">Conversational planning is the vision. This scripted example shows the intended experience, with venue staff in control of the final decision.</p><span className="demo-vision-label">PRODUCT VISION / SCRIPTED EXAMPLE</span></div>
        <div className="demo-assistant"><div className="demo-assistant-heading"><span className="demo-assistant-symbol"><Sparkles size={20} /></span><div><strong>Planning, in conversation</strong><span>A future Venviewer experience</span></div></div><div className="demo-message-user">Could we turn the afternoon reception into a seated dinner?</div><div className="demo-message-assistant"><Sparkles size={18} /><div><p>Let’s work through the change.</p><p>We would compare the room layout, available furniture and the time needed for the reset.</p></div></div><div className="demo-suggestion"><span className="demo-kicker">A SUGGESTION TO REVIEW</span><h3>Reception to dinner</h3><div><Check size={15} /> Explore a seated arrangement</div><div><Check size={15} /> Identify equipment to check</div><div><Check size={15} /> Surface timing implications</div><span className="demo-suggestion-footer">VENUE REVIEW BEFORE ANY CHANGE</span></div><p className="demo-assistant-caption">Illustration only. No live AI request or booking action.</p></div>
      </section>

      <section data-slide="5" hidden={active !== 5} className="demo-slide demo-split" aria-labelledby="demo-title-5">
        <div className="demo-copy"><Kicker>05 / THE HANDOVER</Kicker><h2 id="demo-title-5">From the plan<br />to the people<br /><em>who make it happen.</em></h2><p>Carry the agreed room setup into the working day, with a layout and equipment sheet the team can take with them.</p><div className="demo-bottom-note"><span className="demo-line" />Less interpretation between the office and the floor.</div></div>
        <div className="demo-handover-composition"><div className="demo-handover-sheet"><div className="demo-handover-title"><img src="/images/venues/trades-hall-glasgow-crest.png" alt="" /><div><span>TRADES HALL OF GLASGOW</span><h3>The room, ready.</h3></div></div><div className="demo-sheet-rule"/><div className="demo-sheet-sub"><strong>Grand Hall / Dinner setup</strong><span>EXAMPLE SHEET</span></div><FloorPlan layout="Dinner"/><div className="demo-sheet-items"><div><span>01</span><strong>Agreed layout</strong><p>The arrangement everyone can refer to.</p></div><div><span>02</span><strong>Equipment list</strong><p>A clear companion to the visual plan.</p></div></div></div><div className="demo-handover-stamp">PLAN<br /><em>to place.</em></div></div>
      </section>

      <section data-slide="6" hidden={active !== 6} className="demo-slide demo-opportunity" aria-labelledby="demo-title-6">
        <div className="demo-opportunity-heading"><Kicker>06 / THE OPPORTUNITY</Kicker><h2 id="demo-title-6">More room for<br /><em>what matters.</em></h2><p>The business case starts with a better experience for the people on both sides of an event.</p></div><div className="demo-value-grid"><article><span>FOR YOUR CLIENTS</span><h3>A place they<br />can picture.</h3><p>Help a prospective client understand the space and have a more informed planning conversation.</p><div className="demo-value-line"/></article><article><span>FOR YOUR TEAM</span><h3>A plan they<br />can share.</h3><p>Bring visual layouts and operational detail together, with fewer separate explanations to reconcile.</p><div className="demo-value-line"/></article><article><span>FOR THE BUSINESS</span><h3>A foundation<br />that can grow.</h3><p>Develop the experience with Trades Hall, then explore how the approach could serve other venues.</p><div className="demo-value-line"/></article></div><p className="demo-opportunity-foot">Outcomes to validate together: enquiry quality, planning time, handover clarity and team confidence.</p>
      </section>

      <section data-slide="7" hidden={active !== 7} className="demo-slide demo-hero demo-finale" aria-labelledby="demo-title-7"><img className="demo-cover" src="/images/venue/grand-hall-room.jpg" alt="The architecture and chandeliers of the Grand Hall" /><div className="demo-hero-shade"/><div className="demo-hero-content"><Kicker>FOR ELAINE & THE TRADES HALL TEAM</Kicker><h2 id="demo-title-7">Your extraordinary place.<br /><em>Our shared possibility.</em></h2><p>Let’s shape a planning experience<br />worthy of the rooms you look after.</p><div className="demo-finale-actions"><a className="demo-cream-button" href="/venues/trades-hall/twin" target="_blank" rel="noreferrer">Explore the venue <MoveUpRight size={18}/></a><a className="demo-outline-button" href="/demo/venviewer-elaine-showcase.pdf" download>Keep the presentation <ArrowDownToLine size={17}/></a></div><p className="demo-finale-note">A Venviewer showcase. Prepared for conversation.<br />Illustrative examples throughout, with future ambitions identified.</p></div></section>
    </main>
    <footer className="demo-footer"><span className="demo-display-note">DISPLAY ONLY <span> / </span> SEPTEMBER 2026</span><nav className="demo-chapters" aria-label="Presentation chapters">{chapters.map((chapter, index) => <button key={chapter} onClick={() => { move(index); }} aria-label={`Chapter ${String(index + 1)}: ${chapter}`} aria-current={active === index ? "step" : undefined}><span /></button>)}</nav><div className="demo-navigation"><span className="demo-chapter-count" aria-live="polite" aria-label={`Chapter ${String(active + 1)} of 8: ${chapters[active] ?? ""}`}>{String(active + 1).padStart(2,"0")} <span>/ 08</span></span><button onClick={() => { move(active - 1); }} disabled={active === 0} aria-label="Previous chapter"><ArrowLeft size={19}/></button><button onClick={() => { move(active + 1); }} disabled={active === 7} aria-label="Next chapter"><ArrowRight size={19}/></button></div></footer>
  </div>;
}
