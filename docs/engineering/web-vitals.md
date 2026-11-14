# Field web vitals and the two-minute phone enquiry

**Read this when:** measuring how fast the public pages are for real visitors,
switching field reporting on, reading p75 for goal 07's report, or timing the phone
enquiry.

Goal 07 judges the front of house on Core Web Vitals at the 75th percentile on
production, by device class (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1), and on "Elaine's
client goes from the home to a sent enquiry in under two minutes without a dead end, on
a phone". Lab numbers (the best lab LCP was 5.2 s) are not field numbers, and nothing
recorded field vitals before this.

## What is sent, and what never is

A sampled page load reports the vitals of the page it landed on to
`POST /public/web-vitals`: each vital once, sent when the page is next hidden after it
is measured. That is usually one request; a vital first measured after a hide (an INP
from a tap after the visitor came back) sends another. Every report is padded with
trailing spaces to the same 512 bytes (`WEB_VITALS_REPORT_BYTES`, below):

```json
{ "v": 1, "page": "/proposal-share/:token", "device": "phone",
  "metrics": [{ "name": "LCP", "value": 2970, "rating": "needs-improvement" }, …] }
```

- **The page is the route's pattern**, read from the router's matched routes when the
  page loaded. The address the visitor opened is never read, so a share token, a plan
  code or a layout id cannot travel. A page must be one of `WEB_VITAL_PAGES` (in
  `@omnitwin/types`): every production route's pattern, and `/*` for any other page (a
  dev fixture, the 404). The browser sends nothing else and the API's schema accepts
  nothing else, so not even a hand-made report can store an address, a code or a
  name as a page; `route-inventory.test.ts` holds the list equal to the router, so a
  new route fails it until the list has it. The database checks only the shape
  (`WEB_VITAL_PAGE_PATTERN`: lowercase words, `:params` and `*`, no digits), which
  refuses ids, dates and long tokens but not every short code spelled in letters.
- **The landing page only.** The vitals stop at the visitor's first move to another
  route in the app (a room card from `/` to the walk), so the walk's interactions
  are never credited to the front door; only the landing page's TTFB may still
  arrive. A redirect before the visitor touches anything (`/hallkeeper` to
  `/hallkeeper/today`) reports under its target. The route and every move are
  recorded from boot (`landing-route.ts`), before the reporter's chunk arrives.
- **Each measurement once.** The library reports CLS and INP again whenever a page
  is shown and hidden again; the reporter sends each of its metric ids once, so one
  page load is one row per vital and a tab-switcher is not weighed twice in the p75.
  A page restored from the back/forward cache, or prerendered, is not measured
  (`UNMEASURED_LOADS`): its TTFB of 0 and LCP of a frame or two are values few
  ordinary loads have, and it made its requests long before its report or not at
  all, which sets it apart in the host's log. Nor is a page the browser restored
  after discarding it, a load the visitor did not start. The p75s leave those loads
  out. A document from the browser's own cache also reports a TTFB near 0, a value
  rare in its group (below). The
  cost: CLS and INP are kept at their values when the page is first hidden, and what
  happens after a visitor returns to the tab is not counted. Chrome's field data
  (CrUX) follows a page's whole life, so these two p75s read lower than CrUX's for the
  same visits.
- **The device class** is the hardware, not the window: touch-first
  (`pointer: coarse`) is a phone when the screen's shorter side is under 600 CSS px
  and a tablet otherwise, however it is held or split; mouse-first is a desktop,
  however narrow its window.
- **Each value on its vital's step** (`WEB_VITAL_STEPS`: 10 ms, CLS in hundredths),
  with the rating that value earns by the library's own bounds. The browser steps it
  before sending and the API steps and rates it again, whatever arrives (the release
  lead's B1, 13 November 2026). A value's precision is its browser's clock: Chromium's
  is a tenth of a millisecond, WebKit's and Gecko's a millisecond, and a browser
  resisting fingerprinting (Firefox and Tor Browser since Firefox 103) clocks to
  1/60 s. Kept as sent, a fractional TTFB among whole ones would name its engine, and
  so its request in the host's log. On a 10 ms step every engine's values share one
  grid, and a 1/60 s clock's land on the 0, 20 and 30 ms of each 50 that most ordinary
  values land on too. Only a clock made coarser still, by hand or in an outdated
  browser (100 ms), stands apart: its values are whole hundreds, as about one ordinary
  value in ten is. Event timing is rounded to 8 ms in every engine already. CLS is not
  a clock's reading but a score of how far things moved, and one shift's score
  follows the screen's size. Chrome's own user agent no longer names the phone, but
  an in-app browser's (Android's WebView) does. In hundredths, ten times finer than
  goal 07's 0.1 target, a shift's score takes fewer distinct values across screens
  than in thousandths (how many fewer depends on how far the screens' scores
  spread), but one whose score sits near a step's edge still splits ordinary
  screens: a CLS row whose screen the log's user agent names can stand alone in its
  group (a residual, below).
- **One size on the wire.** The host's request log records each request's size, and
  a report's length would otherwise follow what it carries: how many vitals, their
  digits and ratings ("needs-improvement" is longer than "good"), its page and device
  class (#309's round-4 review). The browser pads every report with trailing spaces,
  which JSON ignores, to `WEB_VITALS_REPORT_BYTES` (512; the longest report the browser
  sends is about 320, and any the schema accepts stays under 400), and the API
  refuses a report of any other length, measuring
  the body it received rather than its Content-Length, which a proxy may drop.
- **The four vitals** are measured by Google's `web-vitals` library (6.2.3): LCP,
  INP, CLS and TTFB, each with its rating. LCP, INP and CLS are taken at every
  change, so the values held are current when the visitor moves on. The library's
  metric id (used only to send each once), its performance entries and how the page
  was reached (`navigationType`, which the privacy page does not name; dropped on
  12 November 2026) never leave the browser. Not every browser reports every vital.
  CLS comes only from Chromium browsers (the library's README, "Browser Support"), so
  never from an iPhone (every iOS browser is WebKit), Safari or Firefox. The library
  measures LCP and INP only where the browser has the Largest Contentful Paint and
  Event Timing APIs, which WebKit shipped in Safari 26.2 on 12 December 2025 (web.dev,
  "LCP and INP are now Baseline Newly available"), so no iPhone before iOS 26.2 sends
  either. A phone's CLS p75 is Android's alone, and its LCP and INP leave out older
  iPhones; read each line's count.
- **How it is sent:** `fetch` with `keepalive`, `credentials: "omit"`,
  `referrerPolicy: "no-referrer"` and a `text/plain` body, so it needs no preflight and
  carries no cookie, token or `Referer` (the page's address names a share token or a
  plan's code), whatever the site's Referrer-Policy.
- **What is stored:** the API stores one row per vital: page, device, metric, value
  and rating, with only the UTC day it arrived, not the moment. The API stamps the
  arrival's UTC midnight itself; the column's default (`date_trunc('day', now(),
  'UTC')`, whatever the session's time zone) serves only rows written by hand. It
  stores no address, user agent, identifier or session, and nothing about the
  measurement is stored on the device.
- **Written in shuffled batches** (Blake, 13 November 2026), so that, on what a row
  shares with the host's request log, it narrows only to its group of ten or more,
  short of the residuals named below. The day alone would not do that:
  rows written as they arrive sit in arrival order, each carries the id of the
  transaction that inserted it (`xmin`, which anyone who can read the table can see,
  rising with time), and the database's restore history follows arrival. Instead:
  - the route holds each checked report's samples in memory, each on its vital's
    step, with nothing about who sent it, and their UTC day (`createWebVitalsBatch`);
  - it groups the samples by everything a row and the host's request log can both
    tell apart: the vital (CLS comes only from Chromium, so a lone Android phone's
    CLS among iPhones' samples would be its batch's only CLS row), the page (a share
    page's own API call, logged with its token seconds before the report, names it),
    the device class (the log's user agent says roughly which) and the UTC day (each
    row keeps it). The step keeps the browser's clock out, and one size on the wire
    the report's contents (above);
  - once an hour it writes every group that holds at least ten samples
    (`WEB_VITALS_BATCH_MIN_SAMPLES`), every row in random order and all in one
    transaction, so the batch shares one `xmin` and its rows' positions say nothing
    of their order of arrival;
  - on what a row shares with the host's request log (below), it then narrows only
    to the ten or more samples of its group, short of the residuals named in this
    section: a value rare in its group (a 100 ms clock's whole hundreds, a load far
    slower than the rest, a TTFB near 0 from the browser's own cache, a CLS whose
    screen the log's user agent names), which values go together, and decoys. A row carries nothing that joins it
    to its report's other vitals, so a report's samples may be written apart: an
    Android phone's TTFB with nine iPhones' today, its CLS once nine more Android
    phones have come. One shuffle spans the whole batch, across its groups, so a
    report's rows are not kept together in the table's order either. What still
    joins them, weakly, is which values go together: an LCP is never below its own
    TTFB, so within one page, device class and day a row's likely partners in the
    other vitals narrow by value, sometimes to one row when a value is an outlier
    (a slow first byte), though each row's own group still holds ten. Ten
    samples, not ten people: one visitor's repeated loads of a page count as many,
    and someone who posts reports on purpose to fill a group around another
    visitor's could single that one out.
  - A group of today holding fewer than ten waits for a later hour; one of an
    earlier day can no longer grow and is dropped. When the API stops, what reaches
    ten is written and the rest is dropped; a crash loses all that is held. At each
    deploy Railway sends the old deployment SIGTERM, then SIGKILL `drainingSeconds`
    later: 30 seconds, set in `railway.json` (#420), which covers the API's own
    25-second close. That close lets requests in flight finish first, then runs the
    write, so the write has its full 15 seconds when they finish within about ten
    seconds of SIGTERM, less when one runs longer, and none past 25. A drain that
    long has not yet been watched under load: that needs a deploy during a slow
    request.
  - Each write is bounded. The database ends a statement after 15 seconds
    (`statement_timeout`) and rolls the batch back whole: it is dropped, and the
    places of reports none of whose samples was kept are given back under the daily
    ceiling. A flush stops waiting after 15 seconds too, but a write it stopped
    waiting for may still commit later (a connection slow to come), or never settle
    (a stalled socket, whose outcome is then unknown): it is never tried again, and
    its places stay counted until it settles. Writes never overlap. A flush waits for
    the write before it within its own 15 seconds; if that is still unfinished, an
    hourly flush writes nothing that hour but still drops an earlier day's groups, so
    what is held stays within one day's ceiling (beside the stuck write's own batch),
    and the closing flush drops all it holds (and drops rather than start a write in
    the last tenth of its bound). The close's one bound is measured on a monotonic
    clock (`performance.now`), which a change of the wall clock cannot stretch or
    cut. A write stuck on the server's own pool still holds its connection, so the
    pool's close then waits until the API's 25-second stop ends the process.
  - So a page's vital is measured only once ten sampled loads of it, from one device
    class, arrive within one server process's life inside one UTC day: about twenty
    loads at a rate of 0.5, between deploys, which come several times a day. Most
    share pages and tablets are never measured. A device class's p75 across every
    page leans towards the busy pages, whose groups fill. Within a page, a vital's
    samples group with every load that measured it, whatever the visitor did, so
    LCP and TTFB do not lean towards visitors who never tapped; INP, by its nature,
    comes only from those who did.
  Rows go after `WEB_VITAL_RETENTION_DAYS` (90) in the nightly cleanup.
- **What the server sees:** like any request, the report reaches the API from the
  visitor's internet address. The route writes no access line (`logLevel: "warn"`,
  as `POST /public/quiz-runs`); its rate limiter keys the address by an HMAC under a
  secret held in memory and replaced every ten minutes (`createAddressKey`), so it
  never holds the address itself (about 60 reports a minute per address in each
  server process, and up to about twice that in the minute a rotation falls in; a
  restart starts the count and the secret again, and each replica keeps its own);
  and API tracing leaves the route out (`ignoreTransactions` in
  `observability/sentry.ts`; `web-vitals-tracing.test.ts` runs the real SDK, route
  and server and sees the route traced and not sent). A report carrying a
  Global Privacy Control or Do Not Track header is answered and not stored, whatever
  the page did. An error on the route still reaches the error log and Sentry, and a
  Sentry error event carries the request's URL, method and headers (the user agent
  among them), as for every route's errors.
- **What the host sees:** the hosting provider's own request logs (Railway's HTTP
  logs) record every request's address, user agent, path and time, these included,
  as they do for every request, and its sizes and duration (`rxBytes`, `txBytes`,
  `totalDuration`). No code here changes that, so the privacy page says so. A
  report's size is the same for every report, and every report that is kept was
  answered the same 204, so those say nothing of what a stored row carried.

## Two switches, both off today

| Where | Switch | Default |
| --- | --- | --- |
| Web build | `VITE_WEB_VITALS_SAMPLE_RATE`, a decimal below 1 such as `0.5`: the share of page loads that measure at all. `1` or more, or anything not written as a decimal (`1e-1`, `0x1`), is off | unset = off |
| API | `WEB_VITALS_COLLECTION=on`: whether the route keeps anything (otherwise 404); only `on` turns it on | off |

**When nothing runs:** a build without the rate has none of this: the entry's
condition (`import.meta.env.VITE_WEB_VITALS_SAMPLE_RATE !== undefined`) is a build-time
constant, Vite writes an unset variable as `undefined`, and the bundler drops the
branch, the reporter's import and the two small modules it uses. (Set at all, even to
`0`, the code stays in the entry and reads the rate as off; leave it unset.) A build
with a rate records every page load's landing route and fetches the reporter (a small
chunk), which draws the sample; only a sampled load fetches the library and measures,
except in tests (`MODE=test`), under automation (`navigator.webdriver`, so e2e runs
are never counted), where the browser sends Global Privacy Control or Do Not Track,
or where the visitor chose "Don't measure my visits" or the browser will not let the
site read its storage ("The way to object", below).
Both chunks load as optional code (`loadOptional` in `route-error-boundary.tsx`): one
that fails to load (a blocker, offline, a deploy in between) stops the measurement
and never reloads the page, as a failed page chunk would. While they load, any
script's failure falls to its own import (a route's to the route boundary, which
reloads on it); a stylesheet that will not preload still takes the reload.

**Why both are off.** Reading the browser's performance timings and sending them is
access to information on the visitor's device. PECR Schedule A1 paragraph 5 (in force
since 5 February 2026) allows it without consent only when its sole purpose is to
collect statistics about how the site is used with a view to improving it, the
information is shared with no one except to help with that, the visitor is given clear
and comprehensive information about the purpose and a simple, free means of objecting,
and does not object; paragraph 5(3) asks for the information and the means of
objecting at the first use. Blake's decision of 19 October 2026 for the enquiry
funnel's browser signals applies here too: keep nothing until the privacy page
describes it.

**The way to object** (T-685, 6 November 2026). Global Privacy Control and Do Not
Track are honoured, but Safari, and so every browser on an iPhone, sends neither. The
privacy page therefore carries a "Don't measure my visits" switch
(`observability/measurement-choice.ts`, rendered in `LegalPage.tsx`). The choice is
kept in the browser under `venviewer.measurement.declined`, and
`shouldReportWebVitals` refuses while it is set. A browser that will not let the site
read its storage at all counts as declined and is never measured. What the browser
keeps is the choice that holds, in every tab: when another tab presses the switch,
every tab follows at once, whether or not it shows the switch (the `storage` event,
heard once for the module), and a reporter still running reads it before its next
send. A press to decline that the browser will not keep (storage full) is kept for the
tab instead, in its session storage, which outlasts the site's own links (plain links,
each a fresh page load) and reloads until the tab is closed (Blake, 13 November 2026:
"Keep it for the tab (Recommended)"); where the browser refuses that too, it is held in
that page's memory only, until the next page load. Neither reaches a tab already open,
and the switch says how long it holds ("only in this tab, until you close it"; "only
until you leave this page"); a browser does copy session storage into a duplicate of
the tab or one its script opens, and keeps it in a tab it reopens, which can only
measure less. A press in another tab while this one has the site open replaces it; a
script there clearing all of the site's storage does not. A page restored from the
back/forward cache reads the choice again. The switch reads what holds from the choice itself
(`measurementChoiceState`, through `useSyncExternalStore`), so a return to the page
cannot reset what it says. The reporter reads the choice again before every send, so
pressing the switch also stops the page load in progress (the privacy page is itself
measured), and so does a press that the browser keeps in another tab, before this
one is hidden. Safari's tracking prevention clears script
storage after about seven days without a visit, so there the choice can lapse; the
paragraph says so, and the page's storage list names the choice ("Your page-speed
choice"). Blake chose the switch's place: on the privacy page, which every public
page links to, not in every footer.

**To switch on**, in one release:
1. check the database first: `web_vital_samples` has no `navigation_type` column,
   `recorded_at` defaults to `date_trunc('day', now(), 'UTC')`, and its index beside
   the primary key is `web_vital_samples_recorded_idx` on `recorded_at`. The migration
   was edited before landing and renumbered (0106 in October, 0108, then
   `0109_web_vital_samples` on 13 November), so a database that ran an earlier copy
   of #309 keeps the old table. Production never ran any of them;
2. merge #355, the privacy page's paragraph ("How fast our pages are", below) and the
   "Don't measure my visits" switch, a way to object that works on an iPhone
   (above), re-dating the policy to the day it goes live;
3. have the solicitor's reply (Blake, 13 November 2026: "Wait for their reply
   (Recommended)"): their confirmation of our reading of PECR Schedule A1 paragraph 5,
   and their answer on whether a visitor's first page may be measured before they can
   reach the switch. The note for them promises the measurement stays off until then;
4. set `WEB_VITALS_COLLECTION=on` on the API;
5. build the web with a sample rate **below 1** (0.5 to start): the page says a
   browser "may" measure a page load, so only a sample of them is measured, and the
   code treats 1 or more as off. Measuring every page load needs that description
   changed first.

The privacy page's paragraph. Blake approved the first wording on 6 November 2026 and
the solicitor approved it (Blake, 12 November). On 12 November a check of every claim
against the code found sentences untrue of the real system (the hosting provider's
request logs record every request's address; Safari clears the stored choice; one of
the four is a layout-shift score, not a time) and corrected the switch's status line
("in this browser"; a plain line when the browser will not keep the choice), and
Blake approved the corrected wording the same day ("everything is approved and have
full permissions"). On 13 November the release lead's review found three more places
to make exact, and Blake approved all three ("Apply all three (Recommended)"): the
Global Privacy Control and Do Not Track sentence (the server also discards a report
whose signal the page could not see), a lawful basis under "Why we use it, and our
lawful basis" (Article 6(1)(f)), with "What we do not do" narrowed to "We run no
third-party analytics product", and the rating and the day kept beside each
measurement. A review of #355 later that day found three more, and Blake approved
them too ("Apply all three (Recommended)"): a row keeps the kind of page and the kind
of device as well as the day (not the time), not the day alone; the layout shift is
measured "while it was open", since CLS is reported until the page is hidden, not
only while it loads; and "How long we keep it" lists the measurements (90 days). He
also approved naming the Regulations' statistics exemption in the cookies section
("Add the sentence (Recommended)") and turning off the error monitor's sessions
("Turn sessions off (Recommended)"): browser Sentry sent a session for every page
load and navigation, which neither "no third-party analytics product" nor the switch's
"not measured" would have survived (`observability/sentry.ts` now drops its
`BrowserSession` integration). Two more reviews that evening (the switch's code and
tests; every claim against the code and PECR's text) led to four more of Blake's
answers. "Strip browser details, say so (Recommended)": the API sent Sentry a timing
record (a transaction) for about one request in ten, whether or not anything failed,
with the request's headers and the user agent; `scrubTransaction`
(`packages/api/src/observability/redact.ts`) now keeps no request header, and both of
the page's Sentry entries say what such a record carries. "Wait for their reply
(Recommended)": switching on waits for the solicitor (step 3 above). "Change both
(Recommended)": the switch says where the browser blocks storage that "your visits in
this browser are never measured", and why. "Name every condition (Recommended)": the
cookies section names each of paragraph 5's conditions, not a part of them.

Verification workflows that night (each finding put to three skeptics) found more:
- The second (five lenses) found record ids in the timing records' URLs (user, event
  and booking ids in the request's path, provider ids in outgoing calls), against the
  approved "with no address, identifier or browser details"; a press held only in
  memory, lost at the next page load, which the page's own links are, though the line
  said it held until a reload or leaving the site (Blake chose "Keep it for the tab
  (Recommended)", with the lines "…holds only in this tab, until you close it." and,
  where the tab will not keep it either, "…holds only until you leave this page.");
  and "clear information" where paragraph 5(1)(d) says "clear and comprehensive
  information" (Blake chose "Use the statute's words (Recommended)").
- The third (four lenses) found that the first fix for the ids covered named keys
  only (the SDK also writes a plain `url` key, Fastify's own span writes the path
  again, and breadcrumbs hold outgoing calls' URLs), and that a caller's baggage sets
  the sampling draw (sample_rand), which the sampler as first written, returning the
  rate, could not stop. Every URL and path anywhere in a record now goes on the route's
  pattern where it is the request's own path, and otherwise loses each segment that
  looks like a record's id (a UUID, a token with a digit, a long token in both cases);
  a record carries no breadcrumbs; and no record with a parent span is sent.
- The fourth (three lenses) found that that rule drops every record with a parent, the
  late parts of a request already sent included (work a route started that ended
  after its reply, whose record repeats the request's own URL without its route),
  which is kept on purpose and now said and tested; and that the API's own calls
  carried Sentry's trace headers, so the tests' requests, made in the same process,
  were dropped too. The API now sends trace headers to no one
  (`tracePropagationTargets: []`), which also stops telling Clerk, Stripe, Resend and
  R2 our trace ids and route names. A record no route matched (a malformed URL's 400,
  say; an unknown path's 404 is never sent, as the SDK itself drops records of 401
  to 404) has no pattern, so its own path has the segment rules alone, a code spelled
  only in letters being the gap.
- The fifth (two lenses, 14 November) found that the late-part test could not fail if
  such a record were sent, since the segment rules replaced its call's id anyway (it
  now looks for the record's own span id and the request's own path, and checks that
  no record sent has a parent); that the other two real-SDK tests did not check that
  their plain requests continued no trace (they now do, for the requests made with
  fetch; capture-path's node:http request writes its headers raw, so none could be
  added to it); and that an aborted or timed-out request's route work goes with the
  late parts, which is kept (nothing in such a record tells it from the late part of a
  request that continued a caller's trace) and now said. Checking it turned up one
  more: a push endpoint's device token at FCM has a colon in it, which the segment
  rules did not take for an id, so a push that ended before its route's reply would
  have named the device in that request's record. Colons now count.
- The sixth (two lenses, at 4e2acb3e) found that counting colons would also have taken
  a long or digit-bearing route placeholder for an id (none exists yet; the longest is
  18 characters), so a segment that starts with a colon is now never one; that the
  tests did not cover a token whose digit or capitals come only after its colon; that
  the capture-path test showed only its /boom records sent (it now shows every record
  built for the API sent); and that "a 404" above was wrong. The check runs found two
  more: a lint error, an `any` read from Sentry's attribute bag (latent since the
  second's fixes, as no run had finished since), and a test whose second round could
  not fail, as its CLS of 500 is one the report schema refuses.

The paragraph now reads:

> **How fast our pages are.** When you open one of our pages, your browser may measure
> how quickly it loaded and responded, and how much its content shifted while it was
> open (four measurements, each rated good, needs improvement or poor), and send them
> to us with the kind of page (for example "a proposal") and whether it was opened on
> a phone, tablet or computer. It does not send the address of the page you opened,
> anything you typed, or any identifier, and nothing is stored on your device for it.
> Like any request, it reaches us from your internet address. We do not keep that with
> the measurements, and our own server does not log it; our hosting provider's standard
> request logs record it, as they do for every request (see "Server and request
> logs"). We keep each measurement with only the kind of page, the kind of device and
> the day it arrived (not the time). We use them only to make the site faster, and
> delete them after 90 days. If your browser sends Global Privacy Control or Do Not
> Track, your visit is not measured, and anything that arrives with either signal is
> discarded. On any browser you can also turn it off with the "Don't measure my
> visits" switch on this page. That choice is kept in this browser on this device
> until the browser clears our site's data (Safari does this after about a week
> without a visit), so you may need to set it again.

**Limits.** Anyone can post a report, so the limiter bounds an address to 60 a minute
in each server process and a daily ceiling (`WEB_VITALS_DAILY_REPORT_CEILING`, 5,000
reports from everyone) bounds the table; the p75 is read as a measure, not a
guarantee. The ceiling is each server process's own count from midnight UTC: a
restart (every deploy) starts it again and each replica keeps its own, so a day keeps
up to 5,000 reports for every process that ran that day. A report none of whose
samples is stored gives its place back; one stored in part keeps it. Pages
reached by moving inside the app are not measured; each figure belongs to the page a
load landed on. The limiter keys IPv6 per address, as the whole API does; keying it
by /64 is an app-wide change, not this one's. What the figures leave out (CLS and INP
after a return to the tab, CLS from every iPhone, LCP and INP from older iPhones) is
under "What is sent", above.

## Reading p75

```
DATABASE_URL=<read access> pnpm --filter @omnitwin/api web-vitals:report 28
```

The command prints each vital's p75 over the last 28 days: today and the 27 whole UTC
days before it (a row keeps only its day). It gives one line per device class across
every page, then one line per page, each beside goal 07's target, with the sample
count (`n=`). Read the count before the figure: a phone's CLS line holds Android
phones only, and its LCP and INP lines leave out older iPhones (above). The count is
of stored samples, after the groups that never reached ten were dropped, so a device
class's line across every page leans towards the busy pages (above). TTFB is judged
against web.dev's 800 ms "good" bound. It only reads.

## The two-minute phone enquiry

`packages/web/scripts/phone-enquiry-timing.mjs` times the goal's flow on an emulated
phone. The phone is an iPhone 13 at 390 × 844 with touch, a 4× CPU slowdown and
Lighthouse's mobile network (150 ms round trip, 1.6 Mbit/s down, 750 kbit/s up). The
flow:
1. the home page shows the hall;
2. "Ask about a date" brings the form;
3. choose the occasion;
4. clear the suggested guest count and type one;
5. pick a date;
6. type a name;
7. type an email;
8. "Send enquiry", until "Enquiry sent" shows.

A step with no way on is a dead end and fails the run.

A machine cannot time a person, so the result has two shares:
- **The system's share is measured:** each step from the action to what it shows,
  typing excluded.
- **The person's share is modelled** with the Keystroke-Level Model:
  - a 1.35 s mental preparation per field and decision;
  - a 0.6 s tap;
  - typing at 36.2 words a minute, the mean phone speed in Palin et al., CHI 2019;
  - six taps for the native date picker;
  - 20 s to read down to the form.

The run fails above 120 s for the two together. The enquiry is never sent: the script
answers `POST /public/enquiries` itself, and blocks service workers so that no request
can pass that answer, so no venue is emailed and no lead is created, wherever
`--base` points. The date it picks is about seven months ahead of the day it runs.

```
pnpm exec vite build --mode budget && pnpm exec vite preview --mode budget
node scripts/phone-enquiry-timing.mjs --base http://127.0.0.1:4173
node scripts/phone-enquiry-timing.mjs --base https://venviewer.com
```

**Measured 28 October 2026** on a local production build of master plus this change:
- the system's share was 4.5 s (home page shown 3.0 s, form 0.3 s, sent 1.0 s);
- the modelled person's share was 54.5 s;
- the total was 59 s, with no dead end.

This is not yet measured against production: the cloud session's network policy
refused venviewer.com. A person on a real phone is the acceptance; the script is the
regression guard and the method.

**Why a script, not a gated e2e case.** The browser release gate requires an exact,
admitted set of cases (`.github/gpu/browser-baseline.json`), and a wall-clock budget
on a shared CI runner would flake. The script needs no admission, and its modelled
share is deterministic. `e2e/front-of-house-vitals.spec.ts`, named in goal 07's
Verify section, can wrap it once the orchestrator admits a case for it.
