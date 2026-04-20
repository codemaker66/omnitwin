import { useEffect, useRef, type ReactElement } from "react";
import { Link } from "react-router-dom";
import "./LandingPage.css";

// ---------------------------------------------------------------------------
// LandingPage — the public marketing homepage for Trades Hall Glasgow +
// OmniTwin. Ported from the Claude Design handoff bundle
// (trades-house-landing-page/project/Landing Page.html), converted from
// vanilla HTML to a React component. Styles live in LandingPage.css,
// scoped to `.th-landing` so nothing leaks to the rest of the app.
// ---------------------------------------------------------------------------

const PAGE_TITLE = "Plan your event — Trades Hall Glasgow";
const PAGE_DESCRIPTION = "Pick a room at Trades Hall Glasgow, lay out tables, stages and dancefloors to scale, and get a costed quote from our events team within 24 hours.";

export function LandingPage(): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Set document title + meta description so the landing renders with the
  // right browser tab and link preview even when it's the user's entry
  // point (e.g. a link from trades-hall-glasgow.com). Restored on unmount
  // so the tab title reverts when navigating to the editor.
  useEffect(() => {
    const previousTitle = document.title;
    document.title = PAGE_TITLE;
    const metaDescEl = ensureMeta("description");
    const previousDesc = metaDescEl.getAttribute("content");
    metaDescEl.setAttribute("content", PAGE_DESCRIPTION);
    const ogTitleEl = ensureMeta("og:title", "property");
    const previousOgTitle = ogTitleEl.getAttribute("content");
    ogTitleEl.setAttribute("content", PAGE_TITLE);
    const ogDescEl = ensureMeta("og:description", "property");
    const previousOgDesc = ogDescEl.getAttribute("content");
    ogDescEl.setAttribute("content", PAGE_DESCRIPTION);
    return () => {
      document.title = previousTitle;
      if (previousDesc === null) metaDescEl.removeAttribute("content");
      else metaDescEl.setAttribute("content", previousDesc);
      if (previousOgTitle === null) ogTitleEl.removeAttribute("content");
      else ogTitleEl.setAttribute("content", previousOgTitle);
      if (previousOgDesc === null) ogDescEl.removeAttribute("content");
      else ogDescEl.setAttribute("content", previousOgDesc);
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return undefined;
    const elements = root.querySelectorAll<HTMLElement>(".rise");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) e.target.classList.add("in");
        }
      },
      { threshold: 0.12 },
    );
    elements.forEach((el) => { io.observe(el); });
    const fallback = window.setTimeout(() => {
      elements.forEach((el) => { el.classList.add("in"); });
    }, 80);
    return () => {
      window.clearTimeout(fallback);
      io.disconnect();
    };
  }, []);

  return (
    <div ref={rootRef} className="th-landing" data-mode="light" data-accent="oxblood" data-display="newsreader">
      <Nav />
      <Hero />
      <Marquee />
      <HowItWorks />
      <Rooms />
      <Features />
      <Quote />
      <FinalCta />
      <Footer />
    </div>
  );
}

function Nav(): ReactElement {
  return (
    <nav className="top">
      <div className="wrap row">
        <Link className="brand" to="/">
          <span className="crest">Th</span>
          <span className="lockup">
            <small>Est. 1791 · Glasgow</small>
            <b>Trades Hall</b>
          </span>
        </Link>
        <ul />
        <div className="actions">
          <Link className="btn ghost" to="/login">Sign in</Link>
          <Link className="btn primary" to="/editor">Open planner →</Link>
        </div>
      </div>
    </nav>
  );
}

function Hero(): ReactElement {
  return (
    <header className="hero">
      <div className="wrap">
        <div className="hero-grid">
          <div className="hero-left rise">
            <div className="eyebrow">Plan your event — live, to scale</div>
            <h1>See your event <em>in the room</em> before you book it.</h1>
            <p className="lede">
              Pick a room at Trades Hall Glasgow, drop in your tables, stage and bar,
              and send us a plan we can quote against. No guesswork, no surprises on
              the day.
            </p>
            <div className="ctas">
              <a href="#rooms" className="btn primary big">
                Choose a room <span className="arrow">→</span>
              </a>
              <a href="#how" className="btn big">How it works</a>
            </div>
            <div className="trust-row">
              <span>✓ Free to plan</span>
              <span>✓ 4 rooms, 1–400 guests</span>
              <span>✓ Quote in 24h</span>
            </div>
          </div>

          <div className="hero-right rise" id="planner-preview" style={{ transitionDelay: ".12s" }}>
            <PlannerPreview />
            <div className="planner-caption">
              <span>↑ Live preview · scaled floor plan</span>
              <span>Open the real thing →</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function PlannerPreview(): ReactElement {
  return (
    <div className="planner">
      <div className="chrome">
        <div className="dots"><i /><i /><i /></div>
        <div className="title"><b>Grand Hall</b> · Banquet layout · Draft</div>
        <div className="right">SAVED 2m ago</div>
      </div>
      <div className="body">
        <aside className="sidebar">
          <div className="field">
            <label>Room</label>
            <div className="input">Grand Hall <span className="caret">▾</span></div>
          </div>
          <div className="field">
            <label>Event type</label>
            <div className="pill-row">
              <button type="button" className="pill on">Wedding</button>
              <button type="button" className="pill">Gala</button>
              <button type="button" className="pill">Conference</button>
            </div>
          </div>
          <div className="field">
            <label>Guests</label>
            <div className="input">180 <span className="caret">—</span></div>
          </div>
          <div>
            <h4>Drag &amp; drop</h4>
            <div className="pill-row" style={{ marginTop: 10 }}>
              <button type="button" className="pill">◯ Round 10</button>
              <button type="button" className="pill">▭ Long 12</button>
              <button type="button" className="pill">■ Stage</button>
              <button type="button" className="pill">Ⅱ Bar</button>
              <button type="button" className="pill">❋ Dancefloor</button>
            </div>
          </div>
        </aside>

        <div className="stage" id="stage">
          <PlannerSvg />

          <div className="topbar">
            <div className="tool-group">
              <div className="tool on" title="Select">⌖</div>
              <div className="tool" title="Pan">✥</div>
              <div className="tool" title="Rotate">↻</div>
              <div className="tool" title="Measure">⟷</div>
            </div>
            <div className="coord">X 420 · Y 210 · 1:50</div>
          </div>

          <div className="furn" style={{ left: "22%", top: "10%", width: "22%", height: "7%" }}>
            <span className="tag">STAGE · 8×3m</span>
            Stage
          </div>
          <div className="furn dark" style={{ left: "56%", top: "10%", width: "20%", height: "6%" }}>
            <span className="tag dark">BAR · 6m</span>
            Bar
          </div>
          <div className="furn dark" style={{ left: "66%", top: "24%", width: "24%", height: "18%" }}>
            <span className="tag dark">DANCEFLOOR · 6×4m</span>
            Parquet
          </div>

          {[5, 17, 29, 41, 53].map((left) => (
            <div
              key={`row1-${String(left)}`}
              className={`furn round${left === 29 ? " selected" : ""}`}
              style={{ left: `${String(left)}%`, top: "32%", width: "8.5%", aspectRatio: "1" }}
            >
              10
            </div>
          ))}
          {[5, 17, 29, 41, 53].map((left) => (
            <div
              key={`row2-${String(left)}`}
              className="furn round"
              style={{ left: `${String(left)}%`, top: "50%", width: "8.5%", aspectRatio: "1" }}
            >
              10
            </div>
          ))}

          <div className="furn" style={{ left: "36%", top: "74%", width: "24%", height: "6%" }}>
            <span className="tag">TOP TABLE · 14</span>
            Top table
          </div>

          <div className="summary">
            <div className="chips">
              <div className="chip">Seats <b>114</b></div>
              <div className="chip">Rounds <b>10</b></div>
              <div className="chip">Egress <b style={{ color: "oklch(0.55 0.15 145)" }}>✓</b></div>
            </div>
            <button type="button" className="cta-in">
              Send for quote <span>→</span>
            </button>
          </div>
        </div>

        <aside className="rightcol">
          <h5>Round table · 10</h5>
          <div className="kv"><span>Diameter</span><span>1.8 m · 6 ft</span></div>
          <div className="kv"><span>Seats</span><span>10</span></div>
          <div className="kv"><span>Linen</span><span>Ivory</span></div>
          <div className="kv"><span>Centrepiece</span><span>Low floral</span></div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--rule)", fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--muted)" }}>
            10 / 12 placed
          </div>
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
            <h5>Fire &amp; safety</h5>
            <div className="kv"><span>Egress</span><span style={{ color: "oklch(0.55 0.15 145)" }}>✓ Clear</span></div>
            <div className="kv"><span>Capacity</span><span>180 max</span></div>
            <div className="kv"><span>Aisles</span><span>1.2 m</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PlannerSvg(): ReactElement {
  const hatchPath = "M 30 40 L 810 40 L 810 325 L 800 335 L 810 345 L 810 385 L 780 385 L 780 405 L 660 405 L 660 385 L 580 385 L 580 405 L 500 405 L 500 430 L 340 430 L 340 405 L 260 405 L 260 385 L 180 385 L 180 405 L 60 405 L 60 385 L 30 385 Z";
  const wallPath = "M 30 40 L 85 40 M 155 40 L 395 40 M 455 40 L 695 40 M 765 40 L 810 40 L 810 325 L 800 335 L 810 345 L 810 385 L 780 385 L 780 405 L 660 405 L 660 385 L 580 385 L 580 405 L 500 405 L 500 430 L 340 430 L 340 405 L 260 405 L 260 385 L 180 385 L 180 405 L 60 405 L 60 385 L 30 385 L 30 40";
  return (
    <svg className="room-svg" viewBox="0 0 840 470" preserveAspectRatio="none">
      <defs>
        <pattern id="th-hatch-room" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="currentColor" strokeWidth={0.8} opacity={0.55} />
        </pattern>
      </defs>
      <g style={{ color: "var(--ink-3)" }}>
        <path d={hatchPath} fill="url(#th-hatch-room)" stroke="none" />
        <path
          d={wallPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinejoin="miter"
          vectorEffect="non-scaling-stroke"
        />
        <g fill="none" stroke="currentColor" strokeWidth={1} opacity={0.55} vectorEffect="non-scaling-stroke">
          <path d="M 85 40 A 35 35 0 0 1 155 40" />
          <path d="M 395 40 A 30 30 0 0 1 455 40" />
          <path d="M 695 40 A 35 35 0 0 1 765 40" />
        </g>
      </g>
      <g style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 9 }} fill="currentColor" stroke="none" opacity={0.7} textAnchor="middle" letterSpacing={0.5}>
        <text x={120} y={400}>WINDOW</text>
        <text x={720} y={400}>WINDOW</text>
        <text x={420} y={422} style={{ fontSize: 10 }} opacity={0.9}>BALCONY</text>
      </g>
      <g style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 10 }} fill="currentColor" stroke="none" opacity={0.6}>
        <text x={420} y={32} textAnchor="middle" letterSpacing={0.8}>21 m</text>
        <text x={48} y={215} transform="rotate(-90 48 215)" letterSpacing={0.8}>10.5 m</text>
      </g>
    </svg>
  );
}

const MARQUEE_ITEMS = [
  "Weddings",
  "Galas & balls",
  "Corporate conferences",
  "Product launches",
  "Film & TV locations",
  "Private dining",
  "Charity fundraisers",
  "Civic ceremonies",
] as const;

function Marquee(): ReactElement {
  const renderRow = (ariaHidden: boolean): ReactElement => (
    <span aria-hidden={ariaHidden ? true : undefined}>
      {MARQUEE_ITEMS.map((item) => (
        <span key={item}>
          <span>{item}</span>
          <span className="dot">✦</span>
        </span>
      ))}
    </span>
  );
  return (
    <div className="marquee">
      <div className="track">
        {renderRow(false)}
        {renderRow(true)}
      </div>
    </div>
  );
}

function HowItWorks(): ReactElement {
  return (
    <section className="blk" id="how">
      <div className="wrap">
        <div className="sec-head">
          <div className="kicker">How it works</div>
          <h2>Four steps from <em>first look</em> to signed contract.</h2>
        </div>
        <div className="steps">
          <Step num="01 / Pick" title="Choose your room">
            Browse our four rooms by capacity, style and layout. Each one loads with
            an accurate, to-scale floor plan of the real space.
          </Step>
          <Step num="02 / Plan" title="Design the layout">
            Drag tables, stages, bars and dancefloors into place. Switch between
            ceremony, banquet and cabaret in one click.
          </Step>
          <Step num="03 / Check" title="Validate & adjust">
            We check spacing, capacity and fire egress as you go, and flag anything
            our events team would normally catch.
          </Step>
          <Step num="04 / Send" title="Get a quote">
            Send the plan to our team. You&apos;ll have a costed proposal with hire
            items and staffing within 24 hours.
          </Step>
        </div>
      </div>
    </section>
  );
}

function Step({ num, title, children }: { num: string; title: string; children: string }): ReactElement {
  return (
    <div className="step">
      <div className="num">{num}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

interface RoomCardProps {
  readonly size: "lg" | "md";
  readonly name: string;
  readonly sub: string;
  readonly image: string;
  readonly alt: string;
  readonly standing: number;
  readonly banquet: number;
  readonly tag?: string;
}

const ROOMS: readonly RoomCardProps[] = [
  {
    size: "lg",
    name: "The Grand Hall",
    sub: "1st floor · Double-height · Domed ceiling & gallery",
    image: "/rooms/Grand-Hall-scaled-opt.jpg",
    alt: "The Grand Hall set for a banquet with chandeliers and domed ceiling",
    standing: 400,
    banquet: 240,
    tag: "Most booked",
  },
  {
    size: "md",
    name: "The Saloon",
    sub: "Ground floor · Stained glass · Panelled",
    image: "/rooms/saloon_TH_use.png",
    alt: "The Saloon with panelled walls and stained-glass windows set for a ceremony",
    standing: 150,
    banquet: 90,
  },
  {
    size: "md",
    name: "Robert Adam Room",
    sub: "1st floor · Neoclassical · Plaster ceiling",
    image: "/rooms/robert-adam-wedding-opt.jpg",
    alt: "The Robert Adam Room with neoclassical plasterwork ceiling set for a ceremony",
    standing: 120,
    banquet: 80,
  },
  {
    size: "md",
    name: "Reception Room",
    sub: "Ground floor · Intimate · Ceremony ready",
    image: "/rooms/reception-wedding-opt.jpg",
    alt: "Reception Room dressed for a wedding ceremony with floral arch",
    standing: 80,
    banquet: 50,
  },
];

function Rooms(): ReactElement {
  return (
    <section className="blk tight" id="rooms" style={{ borderTop: "1px solid var(--rule)", background: "var(--cream-2)" }}>
      <div className="wrap">
        <div className="sec-head">
          <div className="kicker">The rooms</div>
          <h2>Four rooms, one Robert Adam building. Start with whichever <em>fits the feeling</em>.</h2>
        </div>
        <div className="rooms-grid">
          {ROOMS.map((r) => <RoomCard key={r.name} {...r} />)}
        </div>
        <div style={{ marginTop: 44, display: "flex", justifyContent: "center" }}>
          <Link to="/editor" className="btn primary big">Open the planner with an empty room →</Link>
        </div>
      </div>
    </section>
  );
}

function RoomCard(props: RoomCardProps): ReactElement {
  return (
    <article className={`room-card size-${props.size}`}>
      <div className="image">
        <img src={props.image} alt={props.alt} loading="lazy" />
        {props.tag !== undefined ? <div className="tag">{props.tag}</div> : null}
      </div>
      <div className="meta">
        <div>
          <h3>{props.name}</h3>
          <div className="sub">{props.sub}</div>
        </div>
        <div className="capacity">
          <b>{String(props.standing)}</b>standing<br />{String(props.banquet)} banquet
        </div>
      </div>
    </article>
  );
}

const FEATURES: ReadonlyArray<{ icon: string; title: string; body: string }> = [
  {
    icon: "⌗",
    title: "To-scale floor plans",
    body: "Every room is surveyed and loaded at 1:50. Columns, windows, fire exits, power points — all exactly where they are in real life.",
  },
  {
    icon: "↔",
    title: "Instant layout swaps",
    body: "Toggle between ceremony, banquet, cabaret, theatre and standing receptions with one click. Counts update live.",
  },
  {
    icon: "✓",
    title: "Capacity & safety checks",
    body: "Spacing between rounds, aisle widths and fire egress are validated as you place. We flag anything that wouldn’t pass.",
  },
  {
    icon: "£",
    title: "Transparent costing",
    body: "Furniture, staffing and AV line up against your plan so you can see the cost impact of every choice before you commit.",
  },
  {
    icon: "↻",
    title: "Save & share drafts",
    body: "Save as many versions as you like, share a read-only link with clients or colleagues, and come back to edit later.",
  },
  {
    icon: "☎",
    title: "Hand off to our team",
    body: "Send your plan and we handle the rest — a named coordinator, a costed proposal, and a walk-through of the room in person.",
  },
];

function Features(): ReactElement {
  return (
    <section className="blk" id="features">
      <div className="wrap">
        <div className="sec-head">
          <div className="kicker">What you can do</div>
          <h2>Every question our events team normally asks, answered <em>before you phone us</em>.</h2>
        </div>
        <div className="feat-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="f">
              <div className="ico">{f.icon}</div>
              <h4>{f.title}</h4>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Quote(): ReactElement {
  return (
    <section className="quote" id="about">
      <div className="inner">
        <span className="mark">&ldquo;</span>
        <blockquote>
          We used to send six PDFs back and forth before anyone saw the actual room.
          Now couples plan their day themselves, to the centimetre, and we just make
          it happen.
        </blockquote>
        <div className="attribution">Fiona R. — Events Manager, Trades Hall Glasgow</div>
      </div>
    </section>
  );
}

function FinalCta(): ReactElement {
  return (
    <section className="final-cta">
      <div className="wrap">
        <h2>
          Your event, <em>to scale</em>.<br />In about ten minutes.
        </h2>
        <p>
          Pick a room and start placing furniture. No account required to try — save
          your draft when you&apos;re ready to share it with our team.
        </p>
        <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <Link to="/editor" className="btn primary big">Open the planner</Link>
          <a href="#contact" className="btn big">Book a site visit instead</a>
        </div>
      </div>
    </section>
  );
}

function Footer(): ReactElement {
  return (
    <footer id="contact">
      <div className="wrap">
        <div className="grid">
          <div>
            <div className="brand" style={{ marginBottom: 16 }}>
              <span className="crest">Th</span>
              <span className="lockup">
                <small>Est. 1791 · Glasgow</small>
                <b>Trades Hall</b>
              </span>
            </div>
            <div style={{ maxWidth: "32ch", lineHeight: 1.55 }}>
              85 Glassford Street, Glasgow, G1 1UH<br />
              Event enquiries: +44 141 000 0000<br />
              events@tradeshall.example
            </div>
          </div>
          <FooterCol title="Plan" items={["Open planner", "Choose a room", "Example layouts", "Pricing guide"]} />
          <FooterCol title="The Hall" items={["About the building", "History & restoration", "Find us", "Press"]} />
          <FooterCol title="Legal" items={["Terms", "Privacy", "Accessibility", "Contact"]} />
        </div>
        <div className="wordmark">Trades <em>Hall.</em></div>
        <div className="baseline">
          <span>© 2026 The Trades House of Glasgow · Planner by OmniTwin</span>
          <span>Built in Glasgow</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, items }: { title: string; items: readonly string[] }): ReactElement {
  return (
    <div>
      <h5>{title}</h5>
      <ul>
        {items.map((i) => (
          <li key={i}><a href="#contact">{i}</a></li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Ensure a `<meta name="X" content="...">` (or `<meta property="X" ...>`)
 * exists in the document head, creating it if missing. Returns the
 * element so the caller can swap `content` and restore it on unmount.
 */
function ensureMeta(key: string, keyAttr: "name" | "property" = "name"): HTMLMetaElement {
  const existing = document.head.querySelector<HTMLMetaElement>(`meta[${keyAttr}="${key}"]`);
  if (existing !== null) return existing;
  const el = document.createElement("meta");
  el.setAttribute(keyAttr, key);
  document.head.appendChild(el);
  return el;
}
