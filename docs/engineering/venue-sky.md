# Venue sky (T-647)

The weather over a venue at one instant, for the relit hall (T-639): live
Glasgow now, each event's date in the planner, a forecast when the date is near
and typical weather beyond. T-639 owns the mapping from weather to light. This
feed carries no sun or moon positions.

- Contract: [`packages/types/src/venue-sky.ts`](../../packages/types/src/venue-sky.ts) (`VenueSkySchema`).
- Route: [`packages/api/src/routes/venue-sky.ts`](../../packages/api/src/routes/venue-sky.ts).
- Service: [`packages/api/src/services/sky/`](../../packages/api/src/services/sky/).
- Venue location: migration [`0086_venue_location.sql`](../../packages/api/drizzle/0086_venue_location.sql),
  check in [`lib/venue-site.ts`](../../packages/api/src/lib/venue-site.ts).

## Route

`GET /venues/:venueId/sky?at=<ISO 8601 with zone>` answers `{ data: VenueSky }`.
`at` defaults to now and must fall in 2000–2099. The route is public, like
`GET /venues/:id` and `GET /venues/:venueId/spaces`: it reveals only public
weather at a public address, and public pages read it. The global limiter
applies (100 a minute per address). No request triggers an upstream call by
itself: the forecast is fetched per venue location on a fixed refresh,
whatever `at` is asked.

| Status | Code | When |
| --- | --- | --- |
| 200 | | A forecast, or monthly normals with `degraded.reason` |
| 400 | `VALIDATION_ERROR` | Bad venue id, or `at` not a zoned date-time in 2000–2099 |
| 404 | `NOT_FOUND` | Unknown or removed venue |
| 422 | `VENUE_NOT_LOCATED` | The venue has no latitude/longitude; never guessed |
| 503 | `SKY_UNAVAILABLE` | No forecast could be served and no normals cover the venue; `details.forecast` names why |

`Cache-Control`: a forecast is `public, max-age` up to 900 s, never past the
cached forecast's refresh; normals after an upstream failure 300 s; normals
because of the date or configuration 3600 s; 503 `no-store`.

## Contract rules

Values the source does not give are `null`, never defaulted. Fractions and
probabilities are 0–1; instants are UTC. `kind` is `forecast` or `normals`;
`observation` is reserved and not produced. A forecast is never degraded;
normals always carry `degraded.reason`, one of:

| Reason | Meaning |
| --- | --- |
| `forecast_not_configured` | No `MET_OFFICE_DATAHUB_API_KEY` |
| `forecast_key_rejected` | The Met Office answered 401/403, e.g. a key for another DataHub product |
| `forecast_quota_exhausted` | 429 from the Met Office, or this server's daily cap |
| `upstream_unavailable` | Network, timeout, 5xx, 204, or a body that failed validation |
| `beyond_forecast_horizon` | `at` after the forecast's last step (or more than 192 h ahead) |
| `before_forecast_window` | `at` before the forecast's first step (or more than 6 h ago) |

- `fog` is a probability: P(visibility at 1.5 m < 1000 m), the WMO definition.
- `precipitation.probability` says what it is in `probabilityDefinition`:
  forecast `rate_at_least_0_1_mm_per_hour`; normals
  `share_of_days_with_at_least_1_mm` (days of rain ≥ 1 mm ÷ days in the month).
- `precipitation.type` comes from the Met Office weather code (published table at
  <https://datahub.metoffice.gov.uk/definition-of-codes>): showers and thunder
  are rain unless sleet, hail or snow is named; mist and fog are `none`; code 4
  ("Not used") and unknown codes are `null`. The code itself is in `weather`.
- `sunshineFraction` = bright-sunshine hours ÷ astronomical day length
  (geometric sunrise to sunset; declination 23.45° × sin(360° × (284 + n)/365),
  day length = 2·acos(−tan φ·tan δ)/15 h). Forecast: the 24 h sunshine period
  containing `at`. Normals: the month's sunshine hours ÷ the month's summed day
  length at the cell latitude. An impossible ratio (> 1.01) is `null`.
- `presetHint` is a weather-only hint from total cloud: `sunny` ≤ 2 oktas,
  `overcast` ≥ 6 oktas, else `null`. It is not a lighting decision.
- `provenance` states when this server requested the forecast, its age, and
  the Met Office site used (the API answers for its nearest site) with its
  distance from the venue.

## Source 1: Met Office Site-Specific Blended Probabilistic Forecast v2

Read 8 October 2026 from datahub.metoffice.gov.uk.

- Why this product. DataHub's "Changes & Updates" announces v2 of the
  Site-Specific **Blended Probabilistic Forecast** (BPF), with v1 retiring on
  11 November 2026 and v1 keys not working on v2. The other site-specific
  product, Global Spot (`/sitespecific/v0`), has no v2, and its hourly and
  three-hourly parameter lists have no cloud cover, the main input for light.
  So the feed uses BPF v2 only.
- Base URL `https://data.hub.api.metoffice.gov.uk/mo-blended-prob-forecast-feature-svc/2.0.0`,
  an OGC EDR service. OpenAPI:
  `/downloads/api-definitions/mo-site-specific-blended-probabilistic-forecast-v2_subscriber.json`
  (sha256 `8ccb6ee1…25ff0` when read).
- Auth: header `apikey`. A key belongs to one product subscription (FAQ: "The API
  key is unique to the subscription you have created it for"), so a key for
  atmospheric models is refused; the free BPF v2 subscription issues its own key.
- Calls per refresh: `GET /collections/{c}/instances` and
  `GET /collections/{c}/instances/{newest}/position?coords=POINT(lon lat)` for
  `improver-percentiles-spot-uk` (with `percentiles=50`) and
  `improver-probabilities-spot-uk`. Collection ids are confirmed from
  `/collections` once a day.
- Values: the 50th percentile, as the Met Office guide "How to create a
  deterministic forecast" recommends. `cloudAreaFraction` (total),
  `lowTypeCloudAreaFraction` (low; mid and high are not offered, so `null`),
  `visibilityInAir1p5m`, `lwePrecipitationRate` (m/s → mm/h), `airTemperature1p5m`
  (K → °C), `windSpeed10m`, `weatherCodePt01h`/`Pt03h`, `durationOfSunshineSumPt24h`;
  probabilities `probabilityOfLwePrecipitationRateAboveThreshold` at 0.1 mm/h and
  `probabilityOfVisibilityInAirBelowThreshold1p5m` at 1000 m. A declared unit
  outside the accepted spellings drops that parameter (logged) rather than
  rescaling it.
- Horizon (glossary, UK): hourly to T+120 h, then three-hourly to T+186/192 h.
  Each step stands for the span to the midpoints with its neighbours
  (`validFrom`/`validTo`).
- Quota: free plan "up to 55 calls per day, one site". The API refetches every
  fourth hourly issue (4 h): 4 calls per refresh, 24 a day, plus one collection
  list. A process cap of 40 calls per UTC day protects the plan against restart
  loops. Failures are held: 30 min (unavailable), 1 h (key refused), to 00:00
  UTC (quota). Concurrent requests share one fetch.
- Attribution (FAQ): "Powered by Met Office data"; licence: the Weather DataHub
  terms and conditions.
- Logs carry stage, status and Zod issue paths, never the key, headers or bodies.

**Not yet verified live.** No key was available, and the DataHub sample files
may not be redistributed, so the test bodies
([fixtures](../../packages/api/src/__tests__/fixtures/met-office-bpf-v2.ts)) are
built from the documented structure with synthetic numbers. The first live
response must be checked: run the verifier below and read the
`venue_sky_forecast_partial` / `venue_sky_upstream_failed` logs.

## Source 2: monthly normals (blocked)

Intended source: Met Office HadUK-Grid v1.3.2.ceda, 1 km `mon-30y` 1991–2020
climatologies of `raindays1mm`, `snowLying`, `sun`, `tas` and `sfcWind`
(Open Government Licence v3.0) on the CEDA Archive, e.g.
`https://dap.ceda.ac.uk/badc/ukmo-hadobs/data/insitu/MOHC/HadOBS/HadUK-Grid/v1.3.2.ceda/1km/sun/mon-30y/v20260512/sun_hadukgrid_uk_1km_mon-30y_199101-202012.nc`.
Directory listings are public, but every file download redirects to the CEDA
login (checked 8 October 2026), so no generator was written and no normals file
is committed. Until one is, a request that needs normals answers 503.

The reading side exists: `SkyNormalsFileSchema` in
[`normals.ts`](../../packages/api/src/services/sky/normals.ts) defines the file a
generator must write (dataset version and citation, `generatedAt`, input URLs
with sha256, the cell centre, twelve months), and `createVenueSkyService`
takes the parsed files (`normals: []` in `src/index.ts` today). Attribution for
normals is the OGL statement ("Contains public sector information licensed under
the Open Government Licence v3.0.") followed by the dataset citation.

## Venue location and deployment

Migration 0086 adds nullable `venues.latitude`/`longitude` (double precision,
both or neither, `BETWEEN` ±90/±180, which also refuses NaN and infinities) and
sets Trades Hall (`trades-hall-glasgow`) to 55.8593, −4.2491, the site agreed
with T-639 (`claude/real-hall:tools/relight/config/grand-hall.json`, room.site),
only while it has no location. Schema first: venue routes select every venue
column, so 0086 must be applied before the API that reads it serves traffic.

After deployment, check from anywhere (public endpoints, no credentials):

```bash
pnpm --filter @omnitwin/api venue:verify-site -- --api https://api.venviewer.com
```

It fails unless the stored Trades Hall location is within 100 m of the agreed
site, and validates the sky answer against the contract.

## Out of scope

ECMWF open data for days 8–14 (beyond the Met Office horizon those dates get
normals with `beyond_forecast_horizon`); observations; a write path for other
venues' locations (set them by migration until one is needed).
