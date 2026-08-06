import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useReducedMotion } from "../landing/useReducedMotion.js";
import {
  buildDressingProgram,
  drawnSegments,
  elementSegmentEnds,
  seatsAtSegments,
  strokesToInkGeometry,
  type DressingEventType,
} from "./gold-ink.js";
import { hasYourTable } from "./turn.js";
import { useSectionScrollProgress } from "./useSectionScrollProgress.js";
import { useLivingHallRuntimeAsset } from "./useLivingHallRuntimeAsset.js";
import { RECEPTION_FIXED_FINE_REVIEW_PROFILE } from "./reception-viewer-profile.js";
import { RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT } from
  "./reception-presentation-contract.js";
import type { ReceptionLocalPreflightSelection } from "./reception-local-preflight.js";
import { buildReceptionCaptureConfiguration } from "./reception-capture-contract.js";
import {
  buildReceptionCandidateComparisonSearch,
  EXPERIMENTAL_E57_CAMERA_NOTICE,
} from "./reception-experimental-camera.js";
import {
  CAPACITY_FORMATS,
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_WEDDING_PRICING,
  VENUE_TRUTH_PROVENANCE,
  formatPriceGBP,
} from "../../lib/trades-hall-venue-truth.js";
import { publicRoomSelectionCards } from "../../lib/trades-hall-room-showcase.js";
import {
  FOOTER_EMAIL,
  FOOTER_PHONE_DISPLAY,
  FOOTER_PHONE_HREF,
  enquiryMailtoHref,
} from "../landing/rite-copy.js";
import {
  LH_ACTS,
  LH_BRAND_NAME,
  LH_BRAND_SMALL,
  LH_CAPTURE_RECORD_LINES,
  LH_CAPTURE_RECORD_TITLE,
  LH_CHECK_DATE_LABEL,
  LH_CTA_CONTINUE_LABEL,
  LH_CTA_PLANNER_HREF,
  LH_CTA_PLANNER_LABEL,
  LH_CTA_TEAM_LABEL,
  LH_ENQUIRY_DRAFT_NOTE,
  LH_ENQUIRE_LABEL,
  LH_EVENT_CHOICE_LEGEND,
  LH_EVENT_TYPES,
  LH_FOOTER_NOTE,
  LH_HEADLINE,
  LH_LEDE,
  LH_LEGEND_CYAN,
  LH_LEGEND_GOLD,
  LH_META_TITLE,
  LH_RATES_TITLE,
  LH_ROOMS_TITLE,
  LH_SANDBOX_DONE,
  LH_SANDBOX_HINT,
  LH_SANDBOX_START,
  LH_SKIP_LABEL,
  LH_TICK_CEILING_PREFIX,
  LH_TICK_FORMAT_LABEL,
  LH_TICK_SEATED,
} from "./living-hall-copy.js";
import "./living-hall.css";

// -----------------------------------------------------------------------------
// LivingHallPage — the P0 DOM-first document of the Living Hall.
//
// This is the semantic source of truth for every tier of the experience: the
// scroll-driven 3D performance (P1+) layers onto these sections; Tier C is
// this document styled; screen readers, scrapers, and search engines read it
// as-is. Structural rules the tests enforce: one h1, one section + h2 per
// act, act nav that resolves, skip link first, venue figures rendered only
// from trades-hall-venue-truth, provenance only from the capture record.
// -----------------------------------------------------------------------------

const roomName = (slug: string): string =>
  publicRoomSelectionCards.find((c) => (c.canonicalRoomSlug ?? c.id) === slug)?.name ?? slug;

/** The live seat count under the pen. Computed from the same pure gold-ink
 *  functions the scene uses — consistent by construction, no canvas coupling.
 *  The number is never animated (it changes constantly under scroll); the
 *  figures are engine-derived, never typed here. */
function DressingTick({ eventType }: { readonly eventType: DressingEventType }): ReactElement {
  const derived = useMemo(() => {
    const program = buildDressingProgram(
      eventType,
      TRADES_HALL_ROOM_CAPACITIES["reception-room"],
    );
    return {
      program,
      geometry: strokesToInkGeometry(program.strokes),
      ends: elementSegmentEnds(program),
    };
  }, [eventType]);
  const [seats, setSeats] = useState(0);

  const applyProgress = useCallback(
    (p: number) => {
      const segments = drawnSegments(derived.geometry, p);
      const next = seatsAtSegments(derived.program, derived.ends, segments);
      setSeats((prev) => (prev === next ? prev : next));
    },
    [derived],
  );
  const progressRef = useSectionScrollProgress("the-dressing", applyProgress);

  useEffect(() => {
    // Event type changed: recount at the current scroll position.
    applyProgress(progressRef.current);
  }, [applyProgress, progressRef]);

  return (
    <p className="lh-tick" data-dressing-tick>
      <b>{seats}</b> {LH_TICK_SEATED} · {LH_TICK_CEILING_PREFIX}{" "}
      <b>{derived.program.seatCeiling}</b> {LH_TICK_FORMAT_LABEL[derived.program.ceilingFormat]}
    </p>
  );
}

// The 3D layer ships in its own chunk: Tier C visitors (and scrapers) never
// download Spark/three. The document below is complete without it.
const LivingHallScene = lazy(() =>
  import("./LivingHallScene.js").then((m) => ({ default: m.LivingHallScene })),
);

function webGl2Available(): boolean {
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

export interface LivingHallPageProps {
  readonly previewPackageId?: string | null;
  readonly localPreflight?: ReceptionLocalPreflightSelection | null;
  readonly localCaptureOnly?: boolean;
  readonly localCaptureNonce?: string | null;
}

export function LivingHallPage({
  previewPackageId = null,
  localPreflight = null,
  localCaptureOnly = false,
  localCaptureNonce = null,
}: LivingHallPageProps = {}): ReactElement {
  const [searchParams] = useSearchParams();
  const reducedMotion = useReducedMotion();
  const [eventType, setEventType] = useState<DressingEventType>("wedding");
  const [sandboxActive, setSandboxActive] = useState(false);
  const sandboxButtonRef = useRef<HTMLButtonElement | null>(null);
  const [sceneFailed, setSceneFailed] = useState(false);

  // The adaptive threshold: a visitor who has placed their table gets the
  // planner as the primary door; a skimmer gets the events team. Engagement
  // is re-read when the sandbox closes — the moment ownership was exercised.
  const [engaged, setEngaged] = useState(() => hasYourTable());

  const exitSandbox = useCallback(() => {
    setSandboxActive(false);
    setEngaged(hasYourTable());
    sandboxButtonRef.current?.focus();
  }, []);

  // Escape always ends the sandbox — page-level, so the contract holds on
  // every tier and never depends on the canvas having focus.
  useEffect(() => {
    if (!sandboxActive) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") exitSandbox();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [exitSandbox, sandboxActive]);
  const runtimeAsset = useLivingHallRuntimeAsset({
    isDevelopment: import.meta.env.DEV,
    sceneParameter: searchParams.get("scene"),
    previewPackageId,
  });
  // Vite replaces this condition with `false` in production. The production
  // page therefore cannot accept local diagnostic sources even if another
  // component accidentally supplies the prop.
  const acceptedLocalPreflight = import.meta.env.DEV && previewPackageId === null
    ? localPreflight
    : null;
  const acceptedCaptureOnly = acceptedLocalPreflight !== null && localCaptureOnly;
  const captureConfiguration = useMemo(() => {
    if (!acceptedCaptureOnly || localCaptureNonce === null) return null;
    return buildReceptionCaptureConfiguration(acceptedLocalPreflight, localCaptureNonce);
  }, [acceptedCaptureOnly, acceptedLocalPreflight, localCaptureNonce]);
  const activeSplatSources = acceptedLocalPreflight?.splatSources ?? runtimeAsset.splatSources;
  const activePresentationContract = acceptedLocalPreflight !== null
    ? RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT
    : runtimeAsset.presentationContract;
  const sceneCapable = useMemo(() => webGl2Available(), []);
  const sceneActive = activeSplatSources.length > 0 &&
    activePresentationContract !== null && sceneCapable && !sceneFailed;
  const handleSceneFailed = useCallback(() => {
    setSandboxActive(false);
    setSceneFailed(true);
  }, []);

  useEffect(() => {
    document.title = LH_META_TITLE;
  }, []);
  const privatePreviewMessage = runtimeAsset.status === "private-preview-ready"
    ? "This exact package is loaded for private review."
    : runtimeAsset.status === "private-preview-fallback"
      ? "This exact package could not be loaded. The photograph is shown instead; nothing else was substituted."
      : "Loading this exact package for private review…";
  const oppositeCandidate = acceptedLocalPreflight?.candidateId === "mobile"
    ? "quality"
    : "mobile";
  const oppositeCandidateSearch = acceptedLocalPreflight === null
    ? ""
    : buildReceptionCandidateComparisonSearch(
      oppositeCandidate,
      acceptedLocalPreflight.reviewView,
      acceptedCaptureOnly,
    );

  return (
    <div
      className={`lh-root${sceneActive ? " has-scene" : ""}${acceptedCaptureOnly ? " is-cv-capture" : ""}`}
      data-runtime-asset-state={acceptedLocalPreflight === null
        ? runtimeAsset.status
        : "local-preflight"}
      data-preflight-candidate-id={acceptedLocalPreflight?.candidateId}
      data-preflight-runtime-profile-id={acceptedLocalPreflight?.runtimeProfileId}
      data-preflight-expected-splat-count={acceptedLocalPreflight?.expectedGaussianCount}
      data-preflight-review-view-id={acceptedLocalPreflight?.reviewView.id}
      data-preflight-capture-only={acceptedCaptureOnly || undefined}
      data-preflight-loaded-asset-set-sha256={captureConfiguration?.assetSetSha256}
      data-preflight-renderer-config-digest={captureConfiguration?.rendererBinding.digest}
      data-preflight-runtime-build-digest={captureConfiguration?.rendererBinding.runtimeBuildDigest}
      data-preflight-runtime-environment-digest={captureConfiguration?.rendererBinding.runtimeEnvironmentDigest}
      data-preflight-profile-digest={captureConfiguration?.rendererBinding.profileDigest}
      data-preflight-tone-map-digest={captureConfiguration?.rendererBinding.toneMapDigest}
      data-preflight-exposure-digest={captureConfiguration?.rendererBinding.exposureDigest}
      data-preflight-colour-space-digest={captureConfiguration?.rendererBinding.colourSpaceDigest}
    >
      {previewPackageId !== null && (
        <aside className="lh-private-preview" role="status" aria-live="polite">
          <strong>Private exact-version review</strong>
          <span>Package {previewPackageId}</span>
          <span>{privatePreviewMessage}</span>
          <span>Viewer profile {RECEPTION_FIXED_FINE_REVIEW_PROFILE.id}</span>
          <span>This view cannot publish or replace the public room.</span>
        </aside>
      )}
      {acceptedLocalPreflight !== null && (
        <aside className="lh-private-preview" role="status" aria-live="polite">
          <strong>
            {acceptedLocalPreflight.reviewView.experimentalViewId === undefined
              ? "Local computer-vision preflight"
              : EXPERIMENTAL_E57_CAMERA_NOTICE}
          </strong>
          <span>{acceptedLocalPreflight.label}</span>
          <span>Fixed camera: {acceptedLocalPreflight.reviewView.label}</span>
          <span>
            Expected total: {acceptedLocalPreflight.expectedGaussianCount.toLocaleString()} splats
          </span>
          <span>Viewer profile {RECEPTION_FIXED_FINE_REVIEW_PROFILE.id}</span>
          <Link to={`/dev/reception-quality-preflight?${oppositeCandidateSearch}`}>
            Open the same camera with the other candidate
          </Link>
          <span>
            Development only. This cannot publish, replace the protected room,
            or grant physical approval.
          </span>
        </aside>
      )}
      {sceneActive && (
        <Suspense fallback={null}>
          <LivingHallScene
            key={activeSplatSources.map((source) => source.id).join("\n")}
            splatSources={activeSplatSources}
            presentationContract={activePresentationContract}
            reducedMotion={reducedMotion}
            eventType={eventType}
            sandboxActive={sandboxActive}
            onSandboxExit={exitSandbox}
            onSceneFailed={handleSceneFailed}
            reviewView={acceptedLocalPreflight?.reviewView}
            captureConfiguration={captureConfiguration ?? undefined}
          />
        </Suspense>
      )}
      <a className="lh-skip" href="#rooms-and-rates">
        {LH_SKIP_LABEL}
      </a>

      <header className="lh-header">
        <div className="lh-brand">
          <small>{LH_BRAND_SMALL}</small>
          <b>{LH_BRAND_NAME}</b>
        </div>
        <nav aria-label="Page acts" className="lh-act-nav">
          {LH_ACTS.map((act) => (
            <a key={act.id} href={`#${act.id}`}>
              {act.navLabel}
            </a>
          ))}
        </nav>
        <div className="lh-header-actions">
          <a href="#rooms-and-rates" className="lh-header-quiet">
            {LH_CHECK_DATE_LABEL}
          </a>
          <a href={enquiryMailtoHref()} className="lh-header-cta">
            {LH_ENQUIRE_LABEL}
          </a>
        </div>
      </header>

      <main className="lh-main">
        <div className="lh-hero">
          <h1>{LH_HEADLINE}</h1>
          <p className="lh-lede">{LH_LEDE}</p>
        </div>

        {LH_ACTS.map((act) => (
          <section key={act.id} id={act.id} className="lh-act" aria-labelledby={`${act.id}-title`}>
            <h2 id={`${act.id}-title`}>{act.title}</h2>
            {act.id === "the-dressing" && (
              <fieldset className="lh-event-choice">
                <legend>{LH_EVENT_CHOICE_LEGEND}</legend>
                {LH_EVENT_TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={eventType === t.key}
                    onClick={() => {
                      setEventType(t.key);
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </fieldset>
            )}
            {act.narration.map((line) => (
              <p key={line.slice(0, 32)}>{line}</p>
            ))}
            {act.id === "the-dressing" && <DressingTick eventType={eventType} />}
            {act.id === "the-plan" && sceneActive && (
              <div className="lh-sandbox">
                <button
                  ref={sandboxButtonRef}
                  type="button"
                  aria-pressed={sandboxActive}
                  onClick={() => {
                    if (sandboxActive) exitSandbox();
                    else setSandboxActive(true);
                  }}
                >
                  {sandboxActive ? LH_SANDBOX_DONE : LH_SANDBOX_START}
                </button>
                {sandboxActive && <p className="lh-sandbox-hint">{LH_SANDBOX_HINT}</p>}
              </div>
            )}

            {act.id === "the-plan" && (
              <>
                <aside className="lh-legend" aria-label="How to read the plan">
                  <span className="lh-legend-gold">{LH_LEGEND_GOLD}</span>
                  <span className="lh-legend-cyan">{LH_LEGEND_CYAN}</span>
                </aside>
                <dl className="lh-record" data-capture-record>
                  <dt>{LH_CAPTURE_RECORD_TITLE}</dt>
                  {LH_CAPTURE_RECORD_LINES.map((line) => (
                    <dd key={line.slice(0, 32)}>{line}</dd>
                  ))}
                </dl>
              </>
            )}

            {act.id === "rooms-and-rates" && (
              <>
                <h3>{LH_ROOMS_TITLE}</h3>
                <table className="lh-capacities">
                  <thead>
                    <tr>
                      <th scope="col">Room</th>
                      {CAPACITY_FORMATS.map((f) => (
                        <th key={f.key} scope="col">
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(TRADES_HALL_ROOM_CAPACITIES).map(([slug, cap]) => (
                      <tr key={slug} data-room-row={slug}>
                        <th scope="row">{roomName(slug)}</th>
                        {CAPACITY_FORMATS.map((f) => (
                          <td key={f.key}>{cap[f.key]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="lh-provenance">{VENUE_TRUTH_PROVENANCE.capacities}</p>

                <h3>{LH_RATES_TITLE}</h3>
                <p className="lh-rates-scope">{TRADES_HALL_WEDDING_PRICING.scope}</p>
                {TRADES_HALL_WEDDING_PRICING.seasons.map((season) => (
                  <dl className="lh-rates" key={season.years}>
                    <dt>{season.years}</dt>
                    {season.rates.map((rate) => (
                      <dd key={rate.packageName} data-rate-row>
                        <span>{rate.packageName}</span>
                        <span>{formatPriceGBP(rate.priceGBP)}</span>
                      </dd>
                    ))}
                  </dl>
                ))}
                <p className="lh-provenance">{VENUE_TRUTH_PROVENANCE.pricing}</p>

                <div className="lh-threshold">
                  {engaged ? (
                    <>
                      <Link className="lh-cta" to={LH_CTA_PLANNER_HREF}>
                        {LH_CTA_CONTINUE_LABEL} <span aria-hidden>→</span>
                      </Link>
                      <a className="lh-cta-quiet" href={FOOTER_PHONE_HREF}>
                        {LH_CTA_TEAM_LABEL} · {FOOTER_PHONE_DISPLAY}
                      </a>
                    </>
                  ) : (
                    <>
                      <a className="lh-cta" href={FOOTER_PHONE_HREF}>
                        {LH_CTA_TEAM_LABEL} <span aria-hidden>→</span>
                      </a>
                      <Link className="lh-cta-quiet" to={LH_CTA_PLANNER_HREF}>
                        {LH_CTA_PLANNER_LABEL}
                      </Link>
                    </>
                  )}
                  <a
                    className="lh-cta-quiet"
                    href={enquiryMailtoHref(undefined, engaged ? LH_ENQUIRY_DRAFT_NOTE : undefined)}
                  >
                    {FOOTER_EMAIL}
                  </a>
                </div>
              </>
            )}
          </section>
        ))}
      </main>

      <footer className="lh-footer">
        <span>{LH_FOOTER_NOTE}</span>
      </footer>
    </div>
  );
}
