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
`POST /public/web-vitals`, in one request when the page is first hidden:

```json
{ "v": 1, "page": "/proposal-share/:token", "device": "phone",
  "metrics": [{ "name": "LCP", "value": 2968, "rating": "needs-improvement", "navigationType": "navigate" }, …] }
```

- **The page is the route's pattern**, read from the router's matched routes when the
  page loaded. The address the visitor opened is never read, so a share token, a plan
  code or a layout id cannot travel. `WEB_VITAL_PAGE_PATTERN` (in `@omnitwin/types`)
  allows only lowercase words, `:params` and `*`, with no digits, and is checked in the
  browser, by the API's schema and by a database check. A pattern that fails reads
  as `/*`.
- **The landing page only.** The vitals stop at the visitor's first move to another
  route in the app (a room card from `/` to the walk), so the walk's interactions
  are never credited to the front door; only the landing page's TTFB may still
  arrive. A redirect before the visitor touches anything (`/hallkeeper` to
  `/hallkeeper/today`) reports under its target. The route and every move are
  recorded from boot (`landing-route.ts`), before the reporter's chunk arrives.
- **Each measurement once.** The library reports CLS and INP again whenever a page
  is shown and hidden again; the reporter sends each of its metric ids once, so one
  page load is one row per vital and a tab-switcher is not weighed twice in the p75.
  A page restored from the back/forward cache is measured again, as a new load.
- **The device class** is the hardware, not the window: touch-first
  (`pointer: coarse`) is a phone when the screen's shorter side is under 600 CSS px
  and a tablet otherwise, however it is held or split; mouse-first is a desktop,
  however narrow its window.
- **The four vitals** are measured by Google's `web-vitals` library (6.2.3): LCP,
  INP, CLS and TTFB, each with its rating and how the page was reached. LCP, INP and
  CLS are taken at every change, so the values held are current when the visitor
  moves on. The library's metric id (used only to send each once) and its
  performance entries never leave the browser.
- **How it is sent:** `fetch` with `keepalive`, `credentials: "omit"` and a
  `text/plain` body, so it needs no preflight and carries no cookie or token.
- **What is stored:** the API stores one row per vital: page, device, metric, value,
  rating, navigation type and the time received. It stores no address, user agent,
  identifier or session, and nothing is stored on the device.
  Rows go after `WEB_VITAL_RETENTION_DAYS` (90) in the nightly cleanup.
- **What the server sees:** like any request, the report reaches the API from the
  visitor's internet address. The route writes no access line (`logLevel: "warn"`,
  as `POST /public/quiz-runs`), so the address is used by the rate limiter in memory
  and kept nowhere; an error on the route still logs. The hosting platform's own
  edge logs are outside the app; the solicitor should confirm the notice covers them.

## Two switches, both off today

| Where | Switch | Default |
| --- | --- | --- |
| Web build | `VITE_WEB_VITALS_SAMPLE_RATE` (0 to 1): the share of page loads that measure at all | unset = 0 |
| API | `WEB_VITALS_COLLECTION=on`: whether the route keeps anything (otherwise 404) | off |

**When nothing runs:** with the rate at 0 the browser never fetches the reporter or
the library. Otherwise the reporter runs for a sampled page load, except in tests
(`MODE=test`), under automation (`navigator.webdriver`, so e2e runs are never counted),
or where the browser sends Global Privacy Control or Do Not Track.

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
it is not in this change.

**To switch on**, in one release:
1. publish the privacy page's line (draft below, through the solicitor) with a way to
   object that works on an iPhone (above);
2. set `WEB_VITALS_COLLECTION=on` on the API;
3. build the web with a sample rate. At the pilot's traffic, 1 gives a usable p75
   within weeks; lower it as traffic grows.

Draft for the privacy page (for the solicitor and Blake; not live):

> **How fast our pages are.** When you open one of our pages, your browser may measure
> how quickly it loaded and responded (four timings) and send them to us with the kind
> of page (for example "a proposal") and whether it was opened on a phone, tablet or
> computer. It does not send the address of the page you opened, anything you typed,
> or any identifier, and nothing is stored on your device for it. Like any request,
> it reaches us from your internet address; we do not keep that with the timings or
> log it. We use these timings only to make the site faster and delete them after 90
> days. If your browser sends Global Privacy Control or Do Not Track, nothing is
> measured or sent. [The way to object on any browser goes here.]

**Limits.** Anyone can post a report, so the limiter bounds an address to 60 a minute
and a daily ceiling (`WEB_VITALS_DAILY_REPORT_CEILING`, 5,000 reports from everyone,
per server, reset at midnight UTC) bounds the table; the p75 is read as a measure, not
a guarantee. Pages reached by moving inside the app are not measured; each figure
belongs to the page a load landed on. The limiter keys IPv6 per address, as the whole
API does; keying it by /64 is an app-wide change, not this one's.

## Reading p75

```
DATABASE_URL=<read access> pnpm --filter @omnitwin/api web-vitals:report 28
```

The command prints each vital's p75 over the last 28 days. It gives one line per device
class across every page, then one line per page, each beside goal 07's target, with
the sample count. TTFB is judged against web.dev's 800 ms "good" bound. It only reads.

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
answers `POST /public/enquiries` itself, so no venue is emailed and no lead is
created, wherever `--base` points.

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
