import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

// ---------------------------------------------------------------------------
// PricingPage — the public /pricing surface for prospective venues.
//
// Design intent: dark, premium, expressive — a single dominant Pro tier
// card centred as the hero, followed by scalable add-ons, professional
// scanning services, a founder bundle, competitor comparison, and FAQ.
// Visual language matches the LandingPage (Playfair/Newsreader serif
// display, oxblood accent, cream on near-black).
//
// Phase 1 stub: the "Start free trial" CTA currently links to `/onboard`
// (which doesn't exist yet). Once Phase 1.3 ships /api/billing/checkout,
// the handler will POST to that endpoint and redirect to Stripe.
// ---------------------------------------------------------------------------

const BG_DARK = "#0a0806";
const BG_PANEL = "#15110d";
const GOLD = "#c9a84c";
const GOLD_DIM = "#8a6e1e";
const OXBLOOD = "#7a1f2a";
const CREAM = "#f5ede0";
const CREAM_MUT = "rgba(245,237,224,0.7)";
const CREAM_FAINT = "rgba(245,237,224,0.4)";
const SERIF = "'Playfair Display', 'Newsreader', Georgia, serif";
const BODY = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

const KEYFRAMES_ID = "pricing-page-animations";
if (typeof document !== "undefined" && document.getElementById(KEYFRAMES_ID) === null) {
  const style = document.createElement("style");
  style.id = KEYFRAMES_ID;
  style.textContent = `
    @keyframes pricing-glow {
      0%, 100% { box-shadow: 0 0 0 1px rgba(201,168,76,0.3), 0 20px 60px rgba(0,0,0,0.6), 0 0 0 rgba(201,168,76,0); }
      50%      { box-shadow: 0 0 0 1px rgba(201,168,76,0.5), 0 28px 80px rgba(0,0,0,0.7), 0 0 80px rgba(201,168,76,0.12); }
    }
    @keyframes pricing-drift {
      0%, 100% { transform: translate(0, 0) scale(1); }
      33%      { transform: translate(30px, -20px) scale(1.05); }
      66%      { transform: translate(-20px, 30px) scale(0.95); }
    }
    @keyframes pricing-fade-up {
      0% { opacity: 0; transform: translateY(24px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    .pricing-cta-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 32px rgba(201,168,76,0.4);
    }
    .pricing-cta-primary:active {
      transform: translateY(0);
    }
    .pricing-addon-card:hover {
      border-color: rgba(201,168,76,0.4);
      transform: translateY(-4px);
    }
    .pricing-scan-card:hover {
      border-color: rgba(201,168,76,0.4);
      transform: translateY(-4px);
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    .pricing-faq-item[open] summary {
      color: ${GOLD};
    }

    /* ---- Mobile (<= 768px) ---- */
    @media (max-width: 768px) {
      .pricing-nav-container {
        padding: 20px 20px !important;
      }
      .pricing-nav-links {
        display: none !important;
      }
      .pricing-nav-sign-in {
        display: inline-block !important;
        padding: 8px 16px !important;
        font-size: 12px !important;
      }
      .pricing-founder-card {
        padding: 36px 24px !important;
      }
      .pricing-founder-grid {
        grid-template-columns: 1fr !important;
        gap: 28px !important;
      }
      .pricing-founder-cta {
        width: 100% !important;
        padding: 18px 24px !important;
        font-size: 15px !important;
      }
      .pricing-hero {
        padding: 48px 24px 40px !important;
      }
      .pricing-hero h1 {
        font-size: 44px !important;
        letter-spacing: -0.5px !important;
      }
      .pricing-hero p {
        font-size: 16px !important;
      }
      .pricing-main-card {
        padding: 36px 24px !important;
      }
      .pricing-main-card-divider {
        margin-left: -24px !important;
        margin-right: -24px !important;
      }
      .pricing-section {
        padding: 48px 20px !important;
      }
      .pricing-section h2 {
        font-size: 30px !important;
      }
      .pricing-comparison-row {
        padding: 18px 20px !important;
      }
      .pricing-final-cta h2 {
        font-size: 38px !important;
      }
      .pricing-footer-inner {
        flex-direction: column !important;
        gap: 12px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

interface BillingCycleToggleProps {
  readonly cycle: "monthly" | "annual";
  readonly onChange: (c: "monthly" | "annual") => void;
}

function BillingCycleToggle({ cycle, onChange }: BillingCycleToggleProps): React.ReactElement {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(201,168,76,0.15)",
        borderRadius: 999,
        padding: 4,
        gap: 2,
      }}
    >
      {(["monthly", "annual"] as const).map((c) => {
        const active = cycle === c;
        return (
          <button
            key={c}
            type="button"
            onClick={() => { onChange(c); }}
            style={{
              padding: "10px 22px",
              borderRadius: 999,
              border: "none",
              background: active ? GOLD : "transparent",
              color: active ? BG_DARK : CREAM_MUT,
              fontFamily: BODY,
              fontSize: 14,
              fontWeight: active ? 600 : 500,
              cursor: "pointer",
              transition: "all 0.2s",
              letterSpacing: 0.3,
            }}
          >
            {c === "monthly" ? "Monthly" : "Annual"}
            {c === "annual" && (
              <span
                style={{
                  marginLeft: 8,
                  padding: "2px 8px",
                  background: active ? "rgba(10,8,6,0.15)" : "rgba(201,168,76,0.15)",
                  color: active ? BG_DARK : GOLD,
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                }}
              >
                Save 17%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function PricingPage(): React.ReactElement {
  const [cycle, setCycle] = useState<"monthly" | "annual">("annual");

  const price = cycle === "annual" ? 47.99 : 57.99;
  const billingLabel = cycle === "annual" ? "billed annually · £575.88/yr" : "billed monthly";

  const handleStartTrial = (): void => {
    window.location.href = `/onboard?tier=pro&cycle=${cycle}`;
  };

  useEffect(() => {
    document.title = "Pricing — VenViewer";
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: BG_DARK,
        color: CREAM,
        fontFamily: BODY,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Ambient background drifting glow */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "-20%",
          left: "50%",
          width: 900,
          height: 900,
          marginLeft: -450,
          background: "radial-gradient(ellipse at center, rgba(201,168,76,0.08) 0%, rgba(122,31,42,0.04) 30%, transparent 70%)",
          animation: "pricing-drift 18s ease-in-out infinite",
          pointerEvents: "none",
          filter: "blur(40px)",
        }}
      />

      {/* TopNav */}
      <nav
        className="pricing-nav-container"
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "28px 48px",
          maxWidth: 1400,
          margin: "0 auto",
        }}
      >
        <Link to="/" style={{ textDecoration: "none", color: CREAM, fontFamily: SERIF, fontSize: 22, fontWeight: 500, letterSpacing: 2 }}>
          VENVIEWER
        </Link>
        <div className="pricing-nav-links" style={{ display: "flex", gap: 28, alignItems: "center", fontSize: 14 }}>
          <Link to="/" style={{ color: CREAM_MUT, textDecoration: "none" }}>Home</Link>
          <a href="/#how-it-works" style={{ color: CREAM_MUT, textDecoration: "none" }}>How it works</a>
          <Link to="/pricing" style={{ color: CREAM, textDecoration: "none", fontWeight: 600 }}>Pricing</Link>
          <Link
            to="/login"
            style={{
              color: CREAM,
              textDecoration: "none",
              padding: "10px 22px",
              border: `1px solid ${CREAM_FAINT}`,
              borderRadius: 999,
              fontSize: 13,
              letterSpacing: 0.5,
            }}
          >
            Sign in
          </Link>
        </div>
        {/* Mobile-only minimal sign-in button (.pricing-nav-links hides the full menu below 768px) */}
        <Link
          to="/login"
          className="pricing-nav-sign-in"
          style={{
            display: "none",
            color: CREAM,
            textDecoration: "none",
            padding: "10px 22px",
            border: `1px solid ${CREAM_FAINT}`,
            borderRadius: 999,
            fontSize: 13,
            letterSpacing: 0.5,
          }}
        >
          Sign in
        </Link>
      </nav>

      {/* === HERO === */}
      <section
        className="pricing-hero"
        style={{
          position: "relative",
          zIndex: 2,
          padding: "80px 48px 60px",
          textAlign: "center",
          maxWidth: 1100,
          margin: "0 auto",
          animation: "pricing-fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: 4, color: GOLD, textTransform: "uppercase", marginBottom: 24, fontWeight: 600 }}>
          Pricing
        </div>
        <h1
          style={{
            fontFamily: SERIF,
            fontSize: "clamp(48px, 7vw, 96px)",
            lineHeight: 1.02,
            margin: 0,
            fontWeight: 400,
            letterSpacing: -1.5,
          }}
        >
          Turn every enquiry<br />
          <em style={{ color: GOLD, fontStyle: "italic" }}>into a yes.</em>
        </h1>
        <p
          style={{
            fontSize: 20,
            color: CREAM_MUT,
            maxWidth: 640,
            margin: "32px auto 0",
            lineHeight: 1.6,
            fontFamily: "'Newsreader', Georgia, serif",
            fontStyle: "italic",
          }}
        >
          One monthly plan. Every room in 3D. Your clients plan their own event while your team reviews and approves in real time.
        </p>
      </section>

      {/* === Main pricing card === */}
      <section style={{ position: "relative", zIndex: 2, padding: "20px 48px 80px", maxWidth: 720, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <BillingCycleToggle cycle={cycle} onChange={setCycle} />
        </div>

        <div
          style={{
            background: `linear-gradient(145deg, ${BG_PANEL} 0%, #1a1510 100%)`,
            border: `1px solid rgba(201,168,76,0.2)`,
            borderRadius: 24,
            padding: "56px 48px",
            position: "relative",
            animation: "pricing-glow 4s ease-in-out infinite",
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: -1,
              left: 48,
              right: 48,
              height: 2,
              background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
            }}
          />

          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 14, letterSpacing: 3, color: GOLD, textTransform: "uppercase", fontWeight: 600 }}>
              VenViewer Pro
            </div>
            <div
              style={{
                padding: "3px 12px",
                background: `rgba(201,168,76,0.12)`,
                color: GOLD,
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              MOST POPULAR
            </div>
          </div>

          <div style={{ textAlign: "center", margin: "24px 0 8px" }}>
            <span style={{ fontSize: 28, color: CREAM_MUT, verticalAlign: "top", marginRight: 4 }}>£</span>
            <span style={{ fontSize: 84, fontFamily: SERIF, fontWeight: 400, color: CREAM, lineHeight: 1 }}>
              {Math.floor(price)}
            </span>
            <span style={{ fontSize: 36, fontFamily: SERIF, fontWeight: 400, color: CREAM }}>
              .{(price % 1).toFixed(2).slice(2)}
            </span>
            <span style={{ fontSize: 16, color: CREAM_MUT, marginLeft: 8 }}>/ month</span>
          </div>
          <div style={{ textAlign: "center", fontSize: 13, color: CREAM_FAINT, marginBottom: 40, fontStyle: "italic" }}>
            {billingLabel}
          </div>

          <div style={{ height: 1, background: "rgba(201,168,76,0.12)", margin: "0 -48px 40px" }} />

          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 16, fontSize: 15, color: CREAM_MUT }}>
            {[
              "1 venue, up to 5 spaces",
              "5 staff seats (admin, planner, hallkeeper)",
              "Unlimited client planning sessions",
              "Embed on your own website (one-line widget)",
              "Custom brand colour & logo",
              "Interactive 3D planning walkthroughs included",
              "Priority email support",
              "All future features, no add-on fees",
            ].map((feature) => (
              <li key={feature} style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <svg width="20" height="20" viewBox="0 0 20 20" style={{ flexShrink: 0, marginTop: 2 }}>
                  <circle cx="10" cy="10" r="10" fill={`rgba(201,168,76,0.15)`} />
                  <path d="M6 10.5 L9 13 L14.5 7" stroke={GOLD} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={handleStartTrial}
            className="pricing-cta-primary"
            style={{
              display: "block",
              width: "100%",
              marginTop: 40,
              padding: "20px 32px",
              background: `linear-gradient(135deg, ${GOLD}, #d4b65c)`,
              color: BG_DARK,
              border: "none",
              borderRadius: 14,
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: 0.5,
              cursor: "pointer",
              fontFamily: BODY,
              transition: "all 0.2s",
              boxShadow: "0 8px 24px rgba(201,168,76,0.25)",
            }}
          >
            Start your 14-day free trial
          </button>
          <div style={{ textAlign: "center", fontSize: 12, color: CREAM_FAINT, marginTop: 16 }}>
            No credit card required · Cancel any time
          </div>
        </div>
      </section>

      {/* === Add-ons === */}
      <section style={{ position: "relative", zIndex: 2, padding: "60px 48px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ fontSize: 12, letterSpacing: 4, color: GOLD, textTransform: "uppercase", marginBottom: 12, fontWeight: 600 }}>
            Scale with your venue
          </div>
          <h2 style={{ fontFamily: SERIF, fontSize: 44, margin: 0, fontWeight: 400, letterSpacing: -0.5 }}>
            Pay only for what you grow into.
          </h2>
          <p style={{ fontSize: 17, color: CREAM_MUT, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>
            No tier ladder to guess at. Start on Pro, add exactly what you need as your venue grows.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
          {[
            { name: "Extra space", price: "£12", sub: "/ month each", desc: "Add a garden, courtyard, second hall — each room scanned and fully planable." },
            { name: "Extra staff seat", price: "£5", sub: "/ month each", desc: "Invite more planners, hallkeepers, sales staff beyond the first five." },
            { name: "White-label", price: "£20", sub: "/ month", desc: "Remove VenViewer branding, run on your own domain (plan.yourvenue.com)." },
          ].map((addon) => (
            <div
              key={addon.name}
              className="pricing-addon-card"
              style={{
                background: BG_PANEL,
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 16,
                padding: "28px 28px 32px",
                transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              <div style={{ fontSize: 13, color: GOLD, letterSpacing: 2, textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>
                {addon.name}
              </div>
              <div style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 36, fontFamily: SERIF, fontWeight: 400 }}>{addon.price}</span>
                <span style={{ fontSize: 13, color: CREAM_MUT, marginLeft: 6 }}>{addon.sub}</span>
              </div>
              <p style={{ fontSize: 14, color: CREAM_MUT, lineHeight: 1.6, margin: 0 }}>
                {addon.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* === Scan services === */}
      <section style={{ position: "relative", zIndex: 2, padding: "80px 48px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <div style={{ fontSize: 12, letterSpacing: 4, color: GOLD, textTransform: "uppercase", marginBottom: 12, fontWeight: 600 }}>
            One-off · Professional services
          </div>
          <h2 style={{ fontFamily: SERIF, fontSize: 44, margin: 0, fontWeight: 400, letterSpacing: -0.5 }}>
            Get your venue <em style={{ color: GOLD, fontStyle: "italic" }}>into the cloud.</em>
          </h2>
          <p style={{ fontSize: 17, color: CREAM_MUT, marginTop: 16, maxWidth: 580, marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>
            We come to you. Lidar + photogrammetry + custom 3D model, ready to drop into your subscription.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
          {[
            { name: "Basic", price: "£750", desc: "Single space up to 200m². Lidar + 360° photo capture. Delivered in 3-5 days.", highlight: false },
            { name: "Standard", price: "£1,500", desc: "Up to 3 spaces / 800m² total. Indoor + garden. Delivered in 7-10 days.", highlight: true },
            { name: "Premium", price: "£3,000+", desc: "Multi-venue, heritage buildings, complex photogrammetry (Robert Adam friezes, domes). Quote-based.", highlight: false },
          ].map((scan) => (
            <div
              key={scan.name}
              className="pricing-scan-card"
              style={{
                background: scan.highlight
                  ? `linear-gradient(145deg, ${BG_PANEL}, #1e1814)`
                  : BG_PANEL,
                border: scan.highlight
                  ? `1px solid rgba(201,168,76,0.3)`
                  : "1px solid rgba(255,255,255,0.06)",
                borderRadius: 20,
                padding: "36px 32px 40px",
                position: "relative",
                transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              {scan.highlight && (
                <div
                  style={{
                    position: "absolute",
                    top: 20,
                    right: 20,
                    padding: "4px 10px",
                    background: "rgba(201,168,76,0.15)",
                    color: GOLD,
                    borderRadius: 999,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1,
                  }}
                >
                  RECOMMENDED
                </div>
              )}
              <div style={{ fontSize: 13, color: GOLD_DIM, letterSpacing: 3, textTransform: "uppercase", fontWeight: 600, marginBottom: 16 }}>
                {scan.name}
              </div>
              <div style={{ fontSize: 48, fontFamily: SERIF, fontWeight: 400, marginBottom: 14, letterSpacing: -0.5 }}>
                {scan.price}
              </div>
              <p style={{ fontSize: 14, color: CREAM_MUT, lineHeight: 1.7, margin: 0 }}>
                {scan.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* === Founder bundle === */}
      <section style={{ position: "relative", zIndex: 2, padding: "60px 48px", maxWidth: 1000, margin: "0 auto" }}>
        <div
          className="pricing-founder-card"
          style={{
            background: `linear-gradient(135deg, ${OXBLOOD} 0%, #5a1820 100%)`,
            borderRadius: 24,
            padding: "56px 64px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background: "radial-gradient(ellipse at top right, rgba(201,168,76,0.2) 0%, transparent 60%)",
              pointerEvents: "none",
            }}
          />

          <div className="pricing-founder-grid" style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "1fr auto", gap: 40, alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: 4, color: GOLD, textTransform: "uppercase", fontWeight: 600, marginBottom: 14 }}>
                Founder bundle · Limited
              </div>
              <h3 style={{ fontFamily: SERIF, fontSize: 40, margin: 0, fontWeight: 400, letterSpacing: -0.5, color: CREAM, lineHeight: 1.1 }}>
                Scan + 12 months Pro.<br />
                <em style={{ color: GOLD, fontStyle: "italic" }}>Save £575.</em>
              </h3>
              <p style={{ fontSize: 16, color: "rgba(245,237,224,0.8)", marginTop: 20, lineHeight: 1.6, maxWidth: 440 }}>
                One payment. Your venue scanned, modelled, and live in 3D — plus a full year of Pro. Pay £1,500 today, nothing else for a year.
              </p>
            </div>

            <button
              type="button"
              onClick={() => { window.location.href = "/onboard?bundle=founder"; }}
              className="pricing-cta-primary pricing-founder-cta"
              style={{
                padding: "22px 36px",
                background: CREAM,
                color: BG_DARK,
                border: "none",
                borderRadius: 14,
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: 0.5,
                cursor: "pointer",
                fontFamily: BODY,
                transition: "all 0.2s",
                whiteSpace: "nowrap",
              }}
            >
              Book a scan →
            </button>
          </div>
        </div>
      </section>

      {/* === Comparison === */}
      <section style={{ position: "relative", zIndex: 2, padding: "80px 48px", maxWidth: 900, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ fontSize: 12, letterSpacing: 4, color: GOLD, textTransform: "uppercase", marginBottom: 12, fontWeight: 600 }}>
            What you pay elsewhere
          </div>
          <h2 style={{ fontFamily: SERIF, fontSize: 40, margin: 0, fontWeight: 400, letterSpacing: -0.5 }}>
            The same job, <em style={{ color: GOLD, fontStyle: "italic" }}>one-tenth the cost.</em>
          </h2>
        </div>

        <div
          style={{
            background: BG_PANEL,
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 20,
            overflow: "hidden",
          }}
        >
          {[
            { name: "Cvent Event Diagramming", price: "$500–2,000/mo", context: "Bundled only, enterprise sales calls" },
            { name: "Prismm (formerly AllSeated)", price: "$99–299/mo", context: "Planner only, no 3D walkthrough" },
            { name: "Matterport hosting (per space)", price: "$70–500/mo", context: "Walkthrough only, no planner" },
            { name: "Cvent + Matterport combined", price: "~$400+/mo", context: "Two tools, two invoices, two onboardings" },
          ].map((row, idx) => (
            <div
              key={row.name}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                padding: "22px 32px",
                borderBottom: idx === 3 ? "none" : "1px solid rgba(255,255,255,0.04)",
                gap: 24,
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: CREAM }}>{row.name}</div>
                <div style={{ fontSize: 12, color: CREAM_FAINT, marginTop: 4 }}>{row.context}</div>
              </div>
              <div style={{ fontSize: 17, fontFamily: SERIF, color: CREAM_MUT }}>{row.price}</div>
            </div>
          ))}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              padding: "26px 32px",
              background: `linear-gradient(90deg, rgba(201,168,76,0.08), rgba(201,168,76,0.02))`,
              borderTop: "1px solid rgba(201,168,76,0.2)",
              gap: 24,
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: GOLD, letterSpacing: 0.5 }}>VenViewer · all-in-one</div>
              <div style={{ fontSize: 12, color: CREAM_MUT, marginTop: 4 }}>Planner + 3D walkthrough + enquiry pipeline</div>
            </div>
            <div style={{ fontSize: 22, fontFamily: SERIF, color: GOLD, fontWeight: 500 }}>£47.99/mo</div>
          </div>
        </div>

        <p style={{ textAlign: "center", fontSize: 13, color: CREAM_FAINT, marginTop: 20, fontStyle: "italic" }}>
          Prices above are industry estimates from public reviews; verify with each vendor.
        </p>
      </section>

      {/* === FAQ === */}
      <section style={{ position: "relative", zIndex: 2, padding: "80px 48px", maxWidth: 760, margin: "0 auto" }}>
        <h2 style={{ fontFamily: SERIF, fontSize: 40, margin: "0 0 40px", fontWeight: 400, textAlign: "center", letterSpacing: -0.5 }}>
          Questions, answered.
        </h2>

        {[
          {
            q: "Do I need to buy a Matterport camera?",
            a: "No. We come to your venue with our own lidar + photogrammetry rig, scan everything, and deliver the 3D model as part of our scanning service. No hardware purchase, no separate hosting fees.",
          },
          {
            q: "What happens after the free trial?",
            a: "If you like it, you pick a plan and we turn billing on. If you don't, your layouts are archived and nothing charges. No auto-renewal into a paid plan without your consent.",
          },
          {
            q: "Can my clients plan events themselves without signing up?",
            a: "Yes. The embed widget lets anyone visiting your website plan their event anonymously. They only enter their email at the very end to submit an enquiry to your team.",
          },
          {
            q: "What if I need more than 5 spaces or staff seats?",
            a: "Add them from your dashboard. £12/mo per extra space, £5/mo per extra staff seat. You pay pro-rata from the day you add them.",
          },
          {
            q: "Can I cancel anytime?",
            a: "Yes. Monthly plans cancel immediately. Annual plans refund the unused portion. No retention hoops.",
          },
          {
            q: "What data do you keep about my clients?",
            a: "Only what they submit on the enquiry form (name, email, event details) and their layout. We never share, sell, or analyse their data beyond what's needed to show it to your staff.",
          },
        ].map((item) => (
          <details
            key={item.q}
            className="pricing-faq-item"
            style={{
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              padding: "24px 0",
            }}
          >
            <summary
              style={{
                cursor: "pointer",
                fontSize: 17,
                fontWeight: 600,
                color: CREAM,
                listStyle: "none",
                transition: "color 0.2s",
                fontFamily: SERIF,
              }}
            >
              {item.q}
            </summary>
            <p style={{ fontSize: 15, color: CREAM_MUT, lineHeight: 1.7, marginTop: 12, marginBottom: 0 }}>
              {item.a}
            </p>
          </details>
        ))}
      </section>

      {/* === Final CTA === */}
      <section style={{ position: "relative", zIndex: 2, padding: "100px 48px 120px", textAlign: "center", maxWidth: 800, margin: "0 auto" }}>
        <h2 style={{ fontFamily: SERIF, fontSize: 56, margin: 0, fontWeight: 400, letterSpacing: -1, lineHeight: 1.05 }}>
          Ready when you are.
        </h2>
        <p style={{ fontSize: 18, color: CREAM_MUT, marginTop: 24, lineHeight: 1.6 }}>
          Fourteen days on the house. Every feature. No credit card.
        </p>
        <button
          type="button"
          onClick={handleStartTrial}
          className="pricing-cta-primary"
          style={{
            marginTop: 32,
            padding: "22px 48px",
            background: `linear-gradient(135deg, ${GOLD}, #d4b65c)`,
            color: BG_DARK,
            border: "none",
            borderRadius: 14,
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: 0.5,
            cursor: "pointer",
            fontFamily: BODY,
            transition: "all 0.2s",
            boxShadow: "0 12px 32px rgba(201,168,76,0.3)",
          }}
        >
          Start free trial →
        </button>
      </section>

      {/* Footer */}
      <footer style={{ position: "relative", zIndex: 2, padding: "40px 48px", borderTop: "1px solid rgba(255,255,255,0.05)", textAlign: "center", fontSize: 12, color: CREAM_FAINT }}>
        <div className="pricing-footer-inner" style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>© 2026 VenViewer</div>
          <div style={{ display: "flex", gap: 24 }}>
            <Link to="/privacy" style={{ color: CREAM_FAINT, textDecoration: "none" }}>Privacy</Link>
            <Link to="/terms" style={{ color: CREAM_FAINT, textDecoration: "none" }}>Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
