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
  A page restored from the back/forward cache, prerendered, or restored after the
  browser discarded it is not measured (`UNMEASURED_LOADS`): its TTFB of 0 and LCP of
  a frame or two are values no ordinary load has, which would tie its rows to each
  other and to its request. The p75s leave those loads out. The
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
  an in-app browser's (Android's WebView) does, so at a thousandth a score could
  name a screen the log names too; CLS is kept in hundredths, where screens of a kind
  score alike, ten times finer than goal 07's 0.1 target. An unusual shift on an
  unusual screen may still stand apart.
- **One size on the wire.** The host's request log records each request's size, and
  a report's length would otherwise follow what it carries: how many vitals, their
  digits and ratings ("needs-improvement" is longer than "good"), its page and device
  class (#309's round-4 review). The browser pads every report with trailing spaces,
  which JSON ignores, to `WEB_VITALS_REPORT_BYTES` (512; the longest report the schema
  allows is about 330), and the API refuses a report of any other length.
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
- **Written in shuffled batches** (Blake, 13 November 2026), so that a stored row
  cannot be paired with the one request that brought it. The day alone would not do that:
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
    slower than the rest), which values go together, and decoys. A row carries nothing that joins it
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
    what is held stays within one day's ceiling, and the closing flush drops all it
    holds (and drops rather than start a write in the last tenth of its bound). A
    write stuck on the server's own pool still holds its connection, so the pool's
    close then waits until the API's 25-second stop ends the process.
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
  report's size is the same for every report, and its answer the same 204, so those
  say nothing of what it carried.

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
are never counted), or where the browser sends Global Privacy Control or Do Not Track.
Both chunks load as optional code (`loadOptional` in `route-error-boundary.tsx`): one
that fails to load (a blocker, offline, a deploy in between) stops the measurement
and never reloads the page, as a failed page chunk would. While they load, any
script's failure falls to its own import (a route's to the route boundary, which
reloads on it); a stylesheet that will not preload still takes the reload.

**Why both are off.** Reading the browser's performance timings and sending them is
access to information on the visitor's device. PECR Schedule A1 paragraph 5 allows it
without consent only with clear information and a simple, free way to object. Blake's
decision of 19 October 2026 for the enquiry funnel's browser signals applies here
too: keep nothing until the privacy page describes it.

**The way to object is not built yet.** Global Privacy Control and Do Not Track are
honoured, but Safari, and so every browser on an iPhone, sends neither, so most phone
visitors would have no way to object. Before switching on, the privacy page needs one
that works everywhere, for example a "Don't measure my visits" control whose stored
choice `shouldReportWebVitals` checks. That is for the solicitor and Blake to settle;
it is not in this change (#355 adds it).

**To switch on**, in one release:
1. check the database first: `web_vital_samples` has no `navigation_type` column,
   `recorded_at` defaults to `date_trunc('day', now(), 'UTC')`, and its index beside
   the primary key is `web_vital_samples_recorded_idx` on `recorded_at`. The migration
   was edited before landing and renumbered (0106 in October, 0108, then
   `0109_web_vital_samples` on 13 November), so a database that ran an earlier copy
   of #309 keeps the old table. Production never ran any of them;
2. merge #355, which adds the privacy page's paragraph ("How fast our pages are", the
   wording approved on 12 November 2026) and the "Don't measure my visits" switch, a
   way to object that works on an iPhone (above);
3. set `WEB_VITALS_COLLECTION=on` on the API;
4. build the web with a sample rate **below 1** (0.5 to start): the page says a
   browser "may" measure a page load, so only a sample of them is measured, and the
   code treats 1 or more as off. Measuring every page load needs that description
   changed first.

The privacy page's wording is #355's (`LegalPage.tsx`). The October draft that stood
here said the address was not logged, which is untrue: the host's request logs
record it (above).

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
