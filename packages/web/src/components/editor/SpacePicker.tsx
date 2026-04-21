import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { motion, useInView } from "framer-motion";
import type { Venue, Space } from "../../api/spaces.js";
import * as spacesApi from "../../api/spaces.js";

// ---------------------------------------------------------------------------
// Venue selection policy:
//   1. URL `/v/:venueSlug/editor` wins if the slug matches a known venue.
//   2. Otherwise, first venue in the list — the original single-tenant
//      behaviour, preserved for `/editor` and for unknown slugs.
// An unknown slug silently falls back rather than erroring; this is the
// minimum-harm multi-venue hook (B2) — it enables URL-based venue switching
// without breaking any existing entry point.
// ---------------------------------------------------------------------------
export function selectVenueFromSlug(
  venues: readonly Venue[],
  slug: string | undefined,
): Venue | undefined {
  if (slug !== undefined && slug !== "") {
    const match = venues.find((v) => v.slug === slug);
    if (match !== undefined) return match;
  }
  return venues[0];
}

// ---------------------------------------------------------------------------
// SpacePicker — cinematic landing page for venue space selection
// ---------------------------------------------------------------------------

// Colour palette (derived from venue photography)
const CHARCOAL = "#1a1a1a";
const GOLD = "#c9a84c";
const CREAM = "#f5f0e8";
const DARK_BG = "#111111";

const SERIF = "'Playfair Display', Georgia, serif";
const SANS = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

// Space → photo mapping (using available venue images)
const SPACE_PHOTOS: Record<string, string> = {
  "grand-hall": "/images/venue/Grand-Hall-scaled-opt.jpg",
  "saloon": "/images/venue/saloon_TH_use.png",
  "reception-room": "/images/venue/reception-wedding-opt.jpg",
  "robert-adam-room": "/images/venue/robert-adam-wedding-opt.jpg",
};

function getSpacePhoto(slug: string): string {
  return SPACE_PHOTOS[slug] ?? "/images/venue/Grand-Hall-scaled-opt.jpg";
}

// ---------------------------------------------------------------------------
// Fade-in section wrapper
// ---------------------------------------------------------------------------

function FadeInSection({ children, delay = 0 }: { readonly children: React.ReactNode; readonly delay?: number }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
      transition={{ duration: 0.7, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SpacePickerProps {
  readonly onSelectSpace: (spaceId: string, venueId: string) => void;
}

export function SpacePicker({ onSelectSpace }: SpacePickerProps): React.ReactElement {
  const { venueSlug } = useParams<{ venueSlug?: string }>();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // Read the abort flag through a function call so TS can't narrow
    // it across awaits — the lint otherwise dead-code-eliminates the
    // post-await guards even though the cleanup mutates the signal.
    const isActive = (): boolean => !controller.signal.aborted;
    void (async () => {
      try {
        const venueList = await spacesApi.listVenues();
        if (!isActive()) return;
        setVenues(venueList);
        const picked = selectVenueFromSlug(venueList, venueSlug);
        if (picked !== undefined) {
          const spaceList = await spacesApi.listSpaces(picked.id);
          if (isActive()) setSpaces(spaceList);
        }
      } catch (err) {
        if (isActive()) setError(err instanceof Error ? err.message : "Failed to load venues");
      } finally {
        if (isActive()) setLoading(false);
      }
    })();
    return () => { controller.abort(); };
  }, [venueSlug]);

  const venue = selectVenueFromSlug(venues, venueSlug);

  const handleSelectSpace = (space: Space): void => {
    if (venue !== undefined) onSelectSpace(space.id, venue.id);
  };

  const scrollToSpaces = (): void => {
    document.getElementById("spaces-section")?.scrollIntoView({ behavior: "smooth" });
  };

  // --- Loading / Error ---
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: CHARCOAL, color: CREAM, fontFamily: SANS }}>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>Loading...</motion.p>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: CHARCOAL, color: "#dc2626", fontFamily: SANS }}>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ background: CHARCOAL, color: CREAM, fontFamily: SANS, overflowX: "hidden" }}>

      {/* ================================================================= */}
      {/* SECTION 1 — HERO */}
      {/* ================================================================= */}
      <section style={{
        position: "relative", height: "70vh", width: "100%", overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        {/* Ken Burns background */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 0,
          backgroundImage: "url('/images/venue/Grand-Hall-scaled-opt.jpg')",
          backgroundSize: "cover", backgroundPosition: "center 30%",
          animation: "kenBurns 20s ease-in-out infinite alternate",
        }} />
        {/* Gradient overlay */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 1,
          background: "linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0.75) 100%)",
        }} />

        {/* Top bar */}
        <div style={{
          position: "relative", zIndex: 2, display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "24px 32px",
        }}>
          <span style={{ fontFamily: SANS, fontWeight: 200, fontSize: 20, letterSpacing: 3, color: CREAM }}>
            VENVIEWER
          </span>
        </div>

        {/* Center content */}
        <div style={{
          position: "relative", zIndex: 2, flex: 1, display: "flex",
          flexDirection: "column", alignItems: "center", justifyContent: "flex-end",
          paddingBottom: "10vh", textAlign: "center",
        }}>
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.3 }}
            style={{ fontFamily: SERIF, fontSize: "clamp(36px, 6vw, 72px)", fontWeight: 400, color: "#fff", marginBottom: 12, lineHeight: 1.1 }}
          >
            Trades Hall Glasgow
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            transition={{ duration: 1, delay: 0.6 }}
            style={{ fontFamily: SANS, fontSize: 14, fontWeight: 300, letterSpacing: 2, color: CREAM, marginBottom: 32, textTransform: "uppercase" }}
          >
            Est. 1791 &middot; Glasgow&rsquo;s Historic Venue
          </motion.p>
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.9 }}
            onClick={scrollToSpaces}
            style={{
              fontFamily: SANS, fontSize: 15, fontWeight: 500, padding: "14px 36px",
              background: GOLD, color: CHARCOAL, border: "none", borderRadius: 32,
              cursor: "pointer", letterSpacing: 0.5,
              boxShadow: `0 0 30px ${GOLD}40`,
              transition: "transform 0.2s, box-shadow 0.2s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.04)"; e.currentTarget.style.boxShadow = `0 0 40px ${GOLD}60`; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = `0 0 30px ${GOLD}40`; }}
            type="button"
          >
            Plan Your Event
          </motion.button>

          {/* Scroll indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5, y: [0, 8, 0] }}
            transition={{ opacity: { delay: 1.5, duration: 0.5 }, y: { repeat: Infinity, duration: 2, ease: "easeInOut" } }}
            style={{ marginTop: 40, fontSize: 12, letterSpacing: 2, textTransform: "uppercase" }}
          >
            Explore Spaces
            <div style={{ marginTop: 8, fontSize: 18 }}>&darr;</div>
          </motion.div>
        </div>

        {/* Ken Burns keyframes */}
        <style>{`
          @keyframes kenBurns {
            0% { transform: scale(1); }
            100% { transform: scale(1.08); }
          }
        `}</style>
      </section>

      {/* ================================================================= */}
      {/* SECTION 2 — VENUE INTRODUCTION */}
      {/* ================================================================= */}
      <section style={{ padding: "100px 32px", maxWidth: 1100, margin: "0 auto" }}>
        <FadeInSection>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48,
            alignItems: "center",
          }}>
            <div style={{ overflow: "hidden", borderRadius: 12 }}>
              <img
                src="/images/venue/grand-hall-facade-3.jpg"
                alt="Trades Hall Glasgow facade"
                loading="lazy"
                style={{ width: "100%", height: "auto", display: "block" }}
              />
            </div>
            <div>
              <h2 style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 400, color: "#fff", marginBottom: 20, lineHeight: 1.2 }}>
                Four centuries of Glasgow history.<br />One evening that&rsquo;s entirely yours.
              </h2>
              <p style={{ fontSize: 15, lineHeight: 1.7, color: "rgba(255,255,255,0.6)", marginBottom: 24 }}>
                Built in 1791 by architect Robert Adam, Trades Hall is one of Glasgow&rsquo;s
                finest surviving Georgian buildings. From grand dinners beneath the gilded dome
                to intimate ceremonies in wood-panelled salons, every space tells a story.
              </p>
              <div style={{ display: "flex", gap: 32, fontSize: 14, color: GOLD }}>
                <span>4 Spaces</span>
                <span>&middot;</span>
                <span>Up to 200 Guests</span>
                <span>&middot;</span>
                <span>City Centre</span>
              </div>
            </div>
          </div>
        </FadeInSection>
      </section>

      {/* ================================================================= */}
      {/* SECTION 3 — SPACE CARDS */}
      {/* ================================================================= */}
      <section id="spaces-section" style={{ padding: "80px 32px 100px", maxWidth: 1100, margin: "0 auto" }}>
        <FadeInSection>
          <h2 style={{
            fontFamily: SERIF, fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 400,
            color: GOLD, textAlign: "center", marginBottom: 48,
          }}>
            Choose Your Space
          </h2>
        </FadeInSection>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 20,
        }}>
          {spaces.map((space, i) => (
            <FadeInSection key={space.id} delay={i * 0.1}>
              <div
                style={{
                  position: "relative", borderRadius: 12, overflow: "hidden",
                  cursor: "pointer", aspectRatio: "16 / 10",
                }}
                onClick={() => { handleSelectSpace(space); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSelectSpace(space); }}
                role="button"
                tabIndex={0}
                data-testid={`space-card-${space.slug}`}
              >
                <img
                  src={getSpacePhoto(space.slug)}
                  alt={space.name}
                  loading="lazy"
                  style={{
                    position: "absolute", inset: 0, width: "100%", height: "100%",
                    objectFit: "cover", transition: "transform 0.5s ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.03)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
                />
                {/* Gradient overlay */}
                <div style={{
                  position: "absolute", inset: 0, zIndex: 1,
                  background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 50%, transparent 100%)",
                  transition: "background 0.4s",
                }} />
                {/* Content */}
                <div style={{
                  position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 2,
                  padding: "20px 24px",
                }}>
                  <h3 style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 500, color: "#fff", marginBottom: 4 }}>
                    {space.name}
                  </h3>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
                    {space.widthM}m &times; {space.lengthM}m &times; {space.heightM}m
                  </p>
                  <p style={{
                    fontSize: 13, color: GOLD, marginTop: 8,
                    opacity: 0, transition: "opacity 0.3s",
                  }}
                    className="card-cta"
                  >
                    Configure Space &rarr;
                  </p>
                </div>
              </div>
            </FadeInSection>
          ))}
        </div>

        {/* Hover CSS for card CTA */}
        <style>{`
          [data-testid^="space-card-"]:hover .card-cta {
            opacity: 1 !important;
          }
          @media (max-width: 768px) {
            [data-testid^="space-card-"] {
              aspect-ratio: 3 / 2 !important;
            }
          }
        `}</style>
      </section>

      {/* ================================================================= */}
      {/* SECTION 4 — HOW IT WORKS */}
      {/* ================================================================= */}
      <section style={{ padding: "80px 32px", background: "#222222" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <FadeInSection>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 40,
              textAlign: "center",
            }}>
              {[
                { icon: "⊞", title: "Choose a Space", desc: "Browse our four historic rooms" },
                { icon: "⤮", title: "Design Your Layout", desc: "Drag tables, chairs, and staging in 3D" },
                { icon: "➤", title: "Send to Events Team", desc: "We'll bring your vision to life" },
              ].map((step, i) => (
                <div key={i}>
                  <div style={{ fontSize: 32, color: GOLD, marginBottom: 12 }}>{step.icon}</div>
                  <h3 style={{ fontFamily: SANS, fontSize: 16, fontWeight: 500, color: "#fff", marginBottom: 8 }}>{step.title}</h3>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>{step.desc}</p>
                </div>
              ))}
            </div>
          </FadeInSection>
        </div>
      </section>

      {/* ================================================================= */}
      {/* SECTION 5 — FOOTER */}
      {/* ================================================================= */}
      <footer style={{
        padding: "40px 32px", background: DARK_BG, textAlign: "center",
        fontSize: 12, color: "rgba(255,255,255,0.3)",
      }}>
        <p style={{ marginBottom: 8 }}>Powered by <span style={{ color: "rgba(255,255,255,0.5)" }}>VenViewer</span></p>
        <p style={{ marginBottom: 12 }}>Trades Hall Glasgow &middot; 85 Glassford Street &middot; Glasgow G1 1UH</p>
        <p>
          <a href="/privacy" style={{ color: "rgba(255,255,255,0.3)", textDecoration: "none", marginRight: 16 }}>Privacy</a>
          <a href="/terms" style={{ color: "rgba(255,255,255,0.3)", textDecoration: "none" }}>Terms</a>
        </p>
      </footer>

      {/* Global responsive overrides + scrollbar polish.
          - 768px: collapse 2-col grids to 1-col (existing tablet break).
          - 640px: tighten section padding so phones don't lose 32px on each
            side; reduce hero h1 line height since the clamp can wrap awkwardly.
          - Scrollbar: opt into the custom WebKit/Firefox styling on the
            spaces section so the dark theme isn't broken by the system
            scrollbar's bright track. */}
      <style>{`
        @media (max-width: 768px) {
          #spaces-section > div:last-of-type {
            grid-template-columns: 1fr !important;
          }
          section > div > div {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 640px) {
          section { padding-left: 20px !important; padding-right: 20px !important; }
          #spaces-section { padding-left: 20px !important; padding-right: 20px !important; }
        }
        html { scrollbar-width: thin; scrollbar-color: ${GOLD}80 ${CHARCOAL}; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: ${CHARCOAL}; }
        ::-webkit-scrollbar-thumb { background: ${GOLD}80; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: ${GOLD}; }
      `}</style>
    </div>
  );
}
