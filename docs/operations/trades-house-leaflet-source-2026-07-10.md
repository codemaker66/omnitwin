# Trades House leaflet source record — 2026-07-10

Task: T-483.

## Supplied source

The user supplied `C:\Users\blake\Downloads\Copy of Copy of Trade's House Glasgow Leaflet.zip` directly on 2026-07-10.

- Archive SHA-256: `a593fa79263f201e8cc372df2f93a3d95b7cc5fc5e7a53dedbe4deb9dbcae7a3`
- Selected leaflet source: `Trades Hall Leaflet-standalone.dc.html`
- Leaflet source SHA-256: `aee00543011b33a6b4b266d34acce4fa0d404c8eb445c33ac71c4302405e6b17`
- Selected quiz source: `Discover Your Craft Quiz v2.dc.html`
- Quiz source SHA-256: `0e7ed301a2b5fa941a28e1d2d74eea0dbbcce021c0e23d6bb74dbc8062b9c2ab`

Only the 27 files under the archive's curated `assets/` directory were imported. The 118 unreferenced draft files under `uploads/` were not imported.

## Implementation boundary

The generated `support.js` runtime was not shipped. It dynamically evaluates the embedded component logic and downloads React/ReactDOM from a third-party CDN. The leaflet is a static print document with local QR SVGs; the quiz scoring and UI are native strict TypeScript/React.

The original QR destination is preserved: both leaflet QR codes continue to point to `https://www.tradeshallglasgow.co.uk`. The Venviewer wrapper links to the separate supplied quiz, but the printed QR campaign has not been silently retargeted.

## Claim and rights status

This record proves source delivery, not factual verification or publication rights. The following supplied leaflet content still needs final Trades House approval before the preview is treated as approved print collateral:

- `£926,319` given to good causes and the reporting period behind “in our most recent year”;
- `810` individuals, `81` organisations and charities, and `235` families with children;
- “Glasgow's only surviving major Adam work”;
- charity number `SC040548`, dates, address, phone, email, and all image usage rights.

The `up to 250 guests` statement aligns with `TRADES_HALL_ROOM_CAPACITIES.grand-hall` for theatre and reception formats, but it remains a planning guide whose final number depends on layout. The route shows a visible review notice and the standalone leaflet is `noindex,nofollow` until final collateral approval.

## Print boundary

The artifact is browser-print faithful at A4 landscape. It is not described as press-ready: the supplied design has no bleed, crop marks, CMYK profile, or fold compensation, and no commercial prepress approval has been performed.

## Delivered surfaces

- Leaflet wrapper: `/trades-house/leaflet`
- Native Craft experience: `/trades-house/discover-your-craft`
- Standalone print source: `packages/web/public/trades-house-media/leaflet.html`
- Local handoff PDF: `output/pdf/trades-house-glasgow-leaflet.pdf`

The PDF was rendered from the same standalone source and verified as two tagged
A4 landscape pages at 841.92 by 594.96 points. Poppler renders of both pages were
visually inspected; this confirms browser-print fidelity only and does not alter
the prepress or venue-approval boundary above.
