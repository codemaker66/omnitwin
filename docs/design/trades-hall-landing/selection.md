# Trades Hall leaflet landing — published Option B

Blake selected **Option B, The Open Hall**, on 7 September 2026. It was published
through the venue's existing fuzzylime CMS on **9 September 2026** at the printed
QR destination, [tradeshallglasgow.co.uk/landing](https://www.tradeshallglasgow.co.uk/landing).
Option A remains preserved. The landing uses the selected photographic composition
and transitions; its links open the separate live planner, tour and Craft quiz.
The same day, Blake requested equal-sized Craft badges and entertaining information
in the space marked on his screenshot. **Published v3** adds that interactive
Craft explorer while preserving the established visitor destinations.

## Published identity and implementation

- CMS page **10**, content block **78**, title **Find your place**.
- [Native CMS source](cms-external-embed.html): three fallback links and a deferred
  external script inside `#th-open-hall-mount`.
- Native file-library item **90**:
  [trades-hall-option-b-v3.js](https://www.tradeshallglasgow.co.uk/file-download/90/trades-hall-option-b-v3.js).
- Published bundle: **929,243 bytes**, SHA-256
  `ba7708e0580e853750d9a72cdc950ffc7e206a7a53442badd906d9b187b8fe44`.
- [Generator](prepare-cms-embed.py) deterministically builds from the preserved
  [standalone draft](cms-draft.html), the [Craft explorer adapter](craft_explorer.py),
  [styles](craft-explorer.css), [interaction](craft-explorer.js) and
  [stories](craft-stories.json). `--external-only` regenerates the small CMS fragment
  against the unchanged bundle. Runtime revisions require a new immutable version
  and confirmed upload URL.

The editor strips styles, rewrites image data URIs, entity-encodes inline JavaScript
and truncates large content near 65 KB. A native uploaded script avoids those edits.
On `body.pf-landing` only, it mounts an open shadow root containing the selected
assets and design. The runtime adjusts that page's wrappers and hides its native
title/header/footer; no shared template was changed. The cookie bar is retained.
The external script stays inside the mount because the CMS wraps it in a paragraph,
which otherwise adds a strip below the design.

## Visitor destinations

- **Plan an event → Start planning:**
  [Grand Hall planner](https://venviewer.com/plan?space=grand-hall).
- The event branch also offers **Explore the venue:**
  [public tour](https://venviewer.com/tour), which redirects to the Trades Hall twin.
- **Find your Craft → Discover my Craft:** [Craft quiz](https://venviewer.com/quiz).
- **Talk to our team:** `mailto:info@tradeshallglasgow.co.uk`.

Enhanced destination links use the same tab. Without the script, the native planner,
quiz and contact anchors remain available. Published-source inspection found that
the CMS adds `target="_blank"` to the two external fallback anchors; shadow links
are unaffected. This is source-level fallback qualification, not a claim that a
browser session with JavaScript disabled was exercised.

## Craft explorer: published v3, 9 September 2026

Each of the fourteen emblems now has the same image box and a native button. A
selected badge opens its Craft story in a panel to the left on desktop and below
the badge gallery on phones. The panel contains an original, entertaining vignette
and a link to the official Craft profile. [Source notes](craft-sources.md) distinguish
the historical facts from the original comic narration; the copy quotes no Terry
Pratchett text and makes no membership promises.

The selected badge is exposed with `aria-pressed`. Close and Escape dismiss the
story and restore badge focus; arrow keys support keyboard navigation. Reduced
motion is respected. The quiz remains available from the Craft branch.

The final immutable v3 bundle passes JavaScript syntax verification and all **nine
runtime regression groups** in [the independent happy-dom harness](check-craft-explorer.mjs).
These DOM checks complement the actual browser checks; they do not stand in for
rendered layout or live CMS qualification.

The publishing agent checked the changed public flow at **1280 × 720** and
**390 × 844**:

- Desktop: Coopers and Tailors panels opened correctly; all sixteen images loaded,
  and every badge image measured **88 px high**.
- Phone: all fourteen badges were clicked; each produced its correct heading with
  exactly one pressed button and no horizontal overflow. Escape closed the story
  and returned focus to the selected badge. Browser logs contained no warnings or
  errors.
- Preview qualification also inspected the fit of all fourteen desktop stories,
  the long phone title, and reduced motion with measured **0 s** transitions.

Rendered evidence: [v3 desktop](evidence/craft-v3-desktop.png) and
[v3 phone](evidence/craft-v3-phone.png).

An independent anonymous HTTPS check confirmed that the public QR page references
file **90**, the public asset matches the v3 hash above, and the ordinary homepage
remains unaffected. This update used the existing venue CMS; it included no
Venviewer application release. Phone checks used browser emulation, not a physical
device.

## Initial v2 delivery and destination qualification: 9 September 2026

The following records the initial publication before the Craft explorer update.
The former published bundle was file **89**, **911,210 bytes**, SHA-256
`6dd7c0c682f36fa63d713b632450c1001778ef8884e070ac2c88d03c61c4616a`.

Independent anonymous HTTPS checks at **18:10:53 UTC on 9 September** confirmed:

- The exact QR URL returns **200**, without a redirect or preview query, with title
  **Find your place | Trades Hall of Glasgow**, body class `page_content pf-landing`,
  one mount and the file-89 script reference.
- The public JavaScript returns **200 application/javascript** and matches the local
  v2 bundle byte for byte at its recorded hash.
- The ordinary homepage returns **200**, retains its normal title and `pf-index`
  body, and contains no landing mount or adapter script.

The publishing agent exercised the final public page in browser viewports of
**1280 × 720** and **390 × 844** and inspected both screenshots. The desktop check
measured exact viewport dimensions, no overflow, all **16 images** loaded and zero
error logs. Evidence:
[published desktop](evidence/published-desktop.png) and
[published phone viewport](evidence/published-phone.png).

From the published page at 390 × 844, **Plan an event → Start planning** opened
`/plan?space=grand-hall` in the same tab, reused the previous guest draft, and
**Open planner** reached the mobile planner with Select/Add/Draw/View/More and
2D/3D controls. Returning to the exact landing URL, **Find your Craft → Discover
my Craft** opened `/quiz` in the same tab with **Which Craft is yours?** and **Begin**.

The preceding rendered-preview checks at both viewport sizes had no overflow and
all 16 images loaded, and exercised Event, Craft, Back and Escape.
Reduced-motion checks measured zero-second transitions and restored focus.
Live destination qualification additionally reached quiz question 1, opened the
guest planner's furniture catalogue, and rendered the tour panorama. Planner
qualification created an ordinary anonymous draft. These are the exercised slices,
not completion of every downstream workflow or physical-device performance testing.
JavaScript syntax, deterministic generation and original-draft preservation checks
pass. This delivery used the venue CMS; no Venviewer application release was needed.

## Recovery and updates

Edit the small embed in CMS **page 10 / block 78**; no other page or shared template
needs to change. Keep the published bundle immutable. For a runtime update, generate
and upload a new version, verify its public hash and rendered behavior, then replace
the embed's script `src` with that confirmed upload URL.

To restore the complete previous published page, switch only that script `src` to
[file 89, v2](https://www.tradeshallglasgow.co.uk/file-download/89/trades-hall-option-b-v2.js),
save, then verify the anonymous QR flow. v2 is retained unchanged as the rollback
bundle. To withdraw the landing, change page 10's status to **Draft**, save, and
verify the anonymous QR URL no longer serves the published page. v1 is retained as
historical evidence, not a recommended rollback: it retains earlier
heading/typography issues and is not visually equivalent.

## Preserved design sources

- Option A: `C:/Users/blake/.codex/visualizations/2026/09/07/01a07bb7-4d06-7c42-90f6-81a87721e3dd/trades-hall-landing.html`
- Selected Option B: `C:/Users/blake/.codex/visualizations/2026/09/07/01a07bb7-4d06-7c42-90f6-81a87721e3dd/trades-hall-option-b.html`
- Option A SHA-256: `9b63a779bfb150f5918bd64ca6030a9a56399b236247c3c7b0d2af3be1154e41`.
- Option B SHA-256: `03ff018ec455aa6566ea55db341e19b2f556520807bfe0292bc1796340095b30`.
- Retained `cms-draft.html` SHA-256:
  `b4465e5479ba3a3d996c375252527d0949fdd81dcdd8eccc1dd0d6107ab90e63`.

Both prototypes and the standalone draft were preserved during CMS adaptation;
their current hashes were rechecked on 9 September, and the publishing agent
separately rechecked A and B. All eighteen embedded assets
are retained: two photographs, fourteen Craft emblems and two font files. v1 remains
local and in native file-library item **88** as an earlier tested bundle. v2 remains
local and in item **89** as the complete previous published page. The published
page now references **v3 only**, in item **90**. The original prototypes and
standalone draft remain unchanged. Credentials are not retained in these artifacts.
