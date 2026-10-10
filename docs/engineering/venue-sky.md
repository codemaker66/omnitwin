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
| `forecast_not_configured` | No `MET_OFFICE_BPF_API_KEY` |
| `forecast_key_rejected` | The Met Office answered 401/403, e.g. a key for another DataHub product |
| `forecast_quota_exhausted` | 429 from the Met Office, or this server's daily cap |
| `upstream_unavailable` | Network, timeout, 5xx, 204, or a body that failed validation |
| `beyond_forecast_horizon` | `at` after the last step that all the forecast's core series reach |
| `before_forecast_window` | `at` before the forecast's first step (or more than 6 h ago) |

- `fog` is a probability: P(visibility at 1.5 m < 1000 m), the WMO definition.
- `precipitation.probability` says what it is in `probabilityDefinition`:
  forecast `rate_at_least_0_1_mm_per_hour`; normals
  `share_of_days_with_at_least_1_mm` (days of rain ≥ 1 mm ÷ days in the month).
- `precipitation.type` comes from the Met Office weather code (published table at
  <https://datahub.metoffice.gov.uk/definition-of-codes>): showers and thunder
  are rain unless sleet, hail or snow is named; mist and fog are `none`; code 4
  ("Not used") and unknown codes are `null`. The code itself is in `weather`.
- `sunshineFraction` (normals) = the month's bright-sunshine hours ÷ the
  month's summed astronomical day length at the cell latitude (geometric
  sunrise to sunset; declination 23.45° × sin(360° × (284 + n)/365), day
  length = 2·acos(−tan φ·tan δ)/15 h). An impossible ratio (> 1.01) is `null`.
  - **Forecast: `null`.** BPF v2's only sunshine parameter is
    `durationOfSunshineSumPt24h`, a sum over the 24 h ending at each step.
  - It mostly describes the day before, not the sky at `at`. Live on 10
    October it gave 0.929 under 88% cloud.
  - It is not requested. The selection log names the sunshine parameters the
    collection declares, so an hourly one would show.
- `presetHint` is a weather-only hint from total cloud: `sunny` ≤ 2 oktas,
  `overcast` ≥ 6 oktas, else `null`. It is not a lighting decision.
- `provenance` states when this server requested the forecast, its age, and
  the Met Office site used (the API answers for its nearest site) with its
  distance from the venue.

## Source 1: Met Office Site-Specific Blended Probabilistic Forecast v2

Read 8 October 2026 from datahub.metoffice.gov.uk.

- Why this product. DataHub's "Changes & Updates" announces v2 of the
  Site-Specific **Blended Probabilistic Forecast** (BPF), with v1 retiring on
  11 November 2026 and v1 keys not working on v2. It supplies every forecast
  field in the contract except mid and high cloud.
- Global Spot (`/sitespecific/v0`, its own key and a 360-call free tier) was
  evaluated as a second source and is not used. Its hourly and three-hourly
  parameter lists have no cloud cover and no sunshine, and everything else it
  offers BPF v2 also supplies, over a longer horizon (T+186 h against T+168 h).
  Its public OpenAPI and glossary do not name the response's parameter keys
  (only the sample behind the DataHub sample-data terms does), so a client
  now would rest on guessed names. It can become a per-field fallback, with
  its own `MET_OFFICE_SITE_SPECIFIC_API_KEY`, once a live or accepted sample
  response has been read.
- Base URL `https://data.hub.api.metoffice.gov.uk/mo-blended-prob-forecast-feature-svc/2.0.0`,
  an OGC EDR service. OpenAPI:
  `/downloads/api-definitions/mo-site-specific-blended-probabilistic-forecast-v2_subscriber.json`
  (sha256 `8ccb6ee1…25ff0` when read).
- Auth: header `apikey`, from `MET_OFFICE_BPF_API_KEY`. A key belongs to one
  product subscription (FAQ: "The API key is unique to the subscription you have
  created it for"), so a Global Spot, map-images or atmospheric key is refused.
- Collections: `GET /collections` once a day.
  [`bpf-collections.ts`](../../packages/api/src/services/sky/bpf-collections.ts)
  chooses the percentile and probability collections from the listing.
  - **How:** by the EDR `parameter_names` each declares when the listing
    carries them, otherwise by the words of its id and then its title
    (`percentile(s)`, `probability`/`probabilities`, `uk`/`global`).
  - **Order:** the UK set first, the global set as the fallback, and
    probabilities from the same region as the percentiles.
  - **Why not fixed ids:** the first release looked for the v1 ids
    (`improver-percentiles-spot-uk`, from the Met Office's v1 download
    utilities), and the live v2 listing does not offer them (production,
    10 October). No official document names the v2 ids. A third-party client
    lists `uk-spot-percentiles`, `uk-spot-probabilities`,
    `global-spot-percentiles` and `global-spot-probabilities`.
  - **Logging:** each listing is logged as `venue_sky_collections_selected`,
    or as `venue_sky_collections_unmatched` with every offered id, title and
    parameter count.
  - **No usable set:** the listing is held for 6 h and the sky falls back to
    normals with `upstream_unavailable`.
- Calls per refresh: `GET /collections/{c}/instances` and
  `GET /collections/{c}/instances/{newest}/position?coords=POINT(lon lat)`,
  once for the percentile collection (with `percentiles=50`) and once for the
  probability collection.
- Values: the 50th percentile, as the Met Office guide "How to create a
  deterministic forecast" recommends. `cloudAreaFraction` (total),
  `lowTypeCloudAreaFraction` (low; mid and high are not offered, so `null`),
  `visibilityInAir1p5m`, `lwePrecipitationRate` (m/s → mm/h), `airTemperature1p5m`
  (K → °C), `windSpeed10m` and `weatherCodePt01h`/`Pt03h`. Probabilities:
  `probabilityOfLwePrecipitationRateAboveThreshold` at 0.1 mm/h and
  `probabilityOfVisibilityInAirBelowThreshold1p5m` at 1000 m.
  - **Thresholds:** matched by value within 2% on the axis's own labels.
    There is no nearest value: a missing threshold, or one in other units,
    gives `null`.
  - **Time steps:** each series is read on its own time axis, in any axis
    order.
  - **Units:** a declared unit outside the accepted spellings drops that
    parameter (logged) rather than rescaling it.
- Horizon: read from the data, never fixed. The glossary says T+186/192 h,
  but the live v2 series ran further on 10 October and differ by parameter:
  - cloud, temperature, wind and precipitation rate: 203 steps to
    25 October 00:00Z, about 14.4 days;
  - precipitation probability: 198 steps to the same date;
  - visibility and fog: to 18 October 12:00Z;
  - the hourly weather code: to 15 October 16:00Z.

  A forecast is served while all the core series (total cloud, temperature,
  wind, precipitation rate) reach `at`: up to the earliest of their last
  steps, inclusive. Later instants get normals with `beyond_forecast_horizon`.
- Each other field is read from its own series. It is `null` once `at` passes
  that series' last step: no value is carried past the data.
  - **Precipitation type** comes from the hourly weather code, else the
    3-hourly one, else `null`.
- **Step spans:** each step stands for the span to the midpoints with its
  neighbours (`validFrom`/`validTo`). The first step also stands for half a
  spacing before it, so "now" is served. The last step stands only up to
  itself, and an answer's span never runs past the core reach.
- Because the reach comes from the data, a cold cache reads the forecast
  once (4 calls) before it can answer even a far date. Later far dates are
  answered from the cache. Without a key, every date is
  `forecast_not_configured`.
- Quota: free plan "up to 55 calls per day, one site". The API refetches every
  fourth hourly issue (4 h): 4 calls per refresh, 24 a day, plus one collection
  list. A process cap of 40 calls per UTC day protects the plan against restart
  loops. Failures are held: 30 min (unavailable), 1 h (key refused), to 00:00
  UTC (quota). Concurrent requests share one fetch.
- Attribution (FAQ): "Powered by Met Office data"; licence: the Weather DataHub
  terms and conditions.
- Data bodies are CoverageJSON (the OpenAPI position query: "Provides data
  for the nearest location as a CovJson response"; it has no output-format
  parameter, so none is sent).
  - **Parameters in scope:** a parameter's unit is read from the parameters
    in scope: the coverage's own, else the collection's (OGC 21-069r2: a
    collection MAY carry `parameters`, 9.6.5; a coverage MUST carry its own
    when the collection does not, 9.6.4). The live service puts them on each
    coverage.
  - **No unit in scope:** the glossary unit applies.
- Logs carry stage, status and Zod issue paths, never the key, headers or
  bodies. A body that fails its schema is described by its structure alone:
  member names, array lengths and `type`/`domainType`/`dataType` strings,
  four levels deep, 30 lines at most, as `body: …` lines in the failure's
  detail.
- The first successful forecast in a process is logged once as
  `venue_sky_forecast_metadata`, for each field:
  - the key, the collection and the unit applied (declared or the glossary's);
  - each extra axis's labels and the index chosen (e.g. the fog threshold);
  - the time axis's length, first and last step and spacings;
  - period lengths.

  It never includes a forecast value.

**Live state (10 October 2026).**
- The key is accepted. #70 (`d9a80276`) chose the collections from the
  listing at 14:55Z (`venue_sky_collections_selected`).
  - **Chosen:** percentiles `uk-spot-percentiles` (basis: declared
    parameters), probabilities `uk-spot-probabilities`.
  - **Offered:** `global-spot-percentiles` (73 parameters),
    `global-spot-probabilities` (38), `uk-spot-percentiles` (77) and
    `uk-spot-probabilities` (78), all without a title.
- The position body then failed the schema with one issue, `parameters:
  Required`.
  - **What the response is:** a CoverageCollection whose coverages all parsed
    (a GeoJSON body would also have failed `type` and `coverages`). It
    carries no collection-level `parameters`, as CoverageJSON allows.
  - **Fix:** reading parameters in scope (above).
- #73 (`2deac5bb`) made the forecast live. At 15:50Z it read cloud 0.883 (low
  0.680), rain at a 0.094 mm/h median rate with P(≥ 0.1 mm/h) = 0, 11.25 °C,
  wind 5.69 m/s, visibility 26 725 m and fog 0.333, from a site 563 m away.
  Two values were questioned:
  - **Sunshine 0.929:** came from the trailing 24 h sum; now `null` (above).
  - **Fog 0.333 against a 26.7 km median visibility:** genuine. After #75
    (`75d6aecd`), `venue_sky_forecast_metadata` showed:
    - fog chose index 14, `<1000.0` (m);
    - precipitation probability chose index 2, `>2.7777778E-8` m/s
      (0.1 mm/h).

    Later the forecast read fog 0.0101 at 26.3 km visibility, and the
    sunshine fraction was `null`.
- The metadata log also showed each series' own reach (see Horizon above),
  which replaced the fixed 192 h limit. It also logs the percentile
  instance's members by name. EDR states no issue time, so `issuedAt` comes
  only from a date-time instance id and stays `null` otherwise. The logged
  members show whether the live instance offers more.

No live response body has been read here, and the DataHub sample files may
not be redistributed. The test bodies
([fixtures](../../packages/api/src/__tests__/fixtures/met-office-bpf-v2.ts))
are therefore still built from the documented structure, with synthetic
numbers.

## Source 2: monthly normals (HadUK-Grid 1991–2020)

Met Office HadUK-Grid v1.3.2.ceda, 1 km `mon-30y` climatologies for
1991–2020 (Open Government Licence v3.0), from the CEDA Archive. The archive
serves the files only to a signed-in user; a CEDA account is free. Cite them
as the catalogue record says (doi:10.5285/789b3065d74a4c948ab05d33556c86d0).
The attribution for normals is the OGL statement ("Contains public sector
information licensed under the Open Government Licence v3.0.") followed by
that citation.

| Variable | File (version directory `v20260512`) | sha256 |
| --- | --- | --- |
| `raindays1mm` | `raindays1mm_hadukgrid_uk_1km_mon-30y_199101-202012.nc` | `7cc522b1875e07314ceb4ae2df95fc332e7060dd31f71f25f1a5941117bb5c01` |
| `sfcWind` | `sfcWind_hadukgrid_uk_1km_mon-30y_199101-202012.nc` | `c64bcb33922c95215354b0507d54fe1ff56bc279f6685b88bbb39307050efacc` |
| `snowLying` | `snowLying_hadukgrid_uk_1km_mon-30y_199101-202012.nc` | `920bc0c79fe8eb90e9768a65d937a30a49b29ed8fbfe1db178d9fd377b5f992e` |
| `sun` | `sun_hadukgrid_uk_1km_mon-30y_199101-202012.nc` | `d1cda0d700368a29f61dc26a51e3ebb427ee3a866402c0976412b731cd3109a0` |
| `tas` | `tas_hadukgrid_uk_1km_mon-30y_199101-202012.nc` | `a68aa595f8a05e63ce904e7025377758d3c056a280fe87d0b6d29e9b0fba6876` |

Each URL is
`https://dap.ceda.ac.uk/badc/ukmo-hadobs/data/insitu/MOHC/HadOBS/HadUK-Grid/v1.3.2.ceda/1km/<variable>/mon-30y/v20260512/<file>`.

**Generator.** With the five files in a directory, run:

```bash
pnpm --filter @omnitwin/api sky:normals -- --inputs <directory>
```

([`generate-sky-normals.ts`](../../packages/api/src/scripts/generate-sky-normals.ts)).
It needs no login and no network. It stops on any sha256 mismatch, and on a
file whose CF standard name, units, version (`source` HadUK-Grid_v1.3.2,
`version` v20260512) or month coordinate is not what it expects. For
`raindays1mm` and `snowLying` it also checks the 1 mm and 50% scalar
coordinates.

It finds the cell from the files' own grid mapping. The site is moved from
WGS84 to OSGB36 with the Ordnance Survey's 7-parameter Helmert transform,
projected with the file's own `transverse_mercator` parameters (OS guide
formulae), and located in the files' `projection_x/y_coordinate_bnds`. The
cell is then checked against the files' own `latitude`/`longitude`.

The files are NetCDF-4 (HDF5) and the stack has no HDF5 library, so
[`sky-normals/hdf5.ts`](../../packages/api/src/scripts/sky-normals/hdf5.ts) is a
strict read-only reader for exactly what these pinned files use. Values are
written as stored: nothing is rounded or filled in. The generator prints a
plausibility report, which is not used to change values.

**The Trades Hall cell**
([`haduk-grid-1km-1991-2020-e259500-n665500.json`](../../packages/api/src/services/sky/normals/haduk-grid-1km-1991-2020-e259500-n665500.json),
loaded by [`normals-data.ts`](../../packages/api/src/services/sky/normals-data.ts)
and validated at startup):

- The site (55.8593, −4.2491) is E 259327.0, N 665189.0 on the National Grid.
- The cell is x=459, y=865, centred on E 259500, N 665500 = 55.862142, −4.246499
  (WGS84), 355.3 m from the site. The site is 189 m from the nearest cell edge.
- The files' own latitude/longitude for that cell are OSGB36 values, and they
  agree with the computed centre to 0.00 m.

| Month | Rain days ≥ 1 mm | Snow lying, days | Sunshine, h | Mean temp, °C | Wind, m/s |
| --- | --- | --- | --- | --- | --- |
| Jan | 17.00 | 2.08 | 39.7 | 5.02 | 4.32 |
| Feb | 14.17 | 1.65 | 68.6 | 5.40 | 4.36 |
| Mar | 13.10 | 0.93 | 101.8 | 6.66 | 4.35 |
| Apr | 12.33 | 0.11 | 146.9 | 9.09 | 4.15 |
| May | 12.47 | 0.01 | 192.3 | 11.85 | 3.90 |
| Jun | 12.13 | 0.00 | 160.0 | 14.46 | 3.56 |
| Jul | 13.53 | 0.00 | 159.7 | 16.04 | 3.40 |
| Aug | 14.03 | 0.00 | 149.3 | 15.81 | 3.26 |
| Sep | 13.60 | 0.00 | 118.5 | 13.62 | 3.54 |
| Oct | 15.70 | 0.00 | 87.5 | 10.49 | 3.60 |
| Nov | 16.57 | 0.29 | 55.2 | 7.47 | 3.75 |
| Dec | 16.40 | 1.85 | 36.3 | 5.19 | 3.77 |

The plausibility checks all pass:
- Coldest month January 5.0 °C, warmest July 16.0 °C.
- Sunshine peaks in May (192 h), least in December (36 h), 1316 h a year.
- 15.9 rain days a month in Dec–Feb against 12.3 in Apr–Jun, 171 a year.
- 6.9 snow-lying days a year, 81% of them in Dec–Feb.
- Windier in winter (4.15 m/s) than summer (3.41 m/s).

The file's few non-zero summer snow-lying values (at most 2×10⁻⁵ days, June
and August) are interpolation residue in the published grid. They are kept as
published.

## Venue location and deployment

Migration 0086 adds nullable `venues.latitude`/`longitude` (double precision,
both or neither, `BETWEEN` ±90/±180, which also refuses NaN and infinities) and
sets Trades Hall (`trades-hall-glasgow`) to 55.8593, −4.2491, the site agreed
with T-639 (`claude/real-hall:tools/relight/config/grand-hall.json`, room.site),
only while it has no location. Schema first: venue routes select every
declared venue column, so 0086 must be applied before the API that declares
it serves traffic. It shipped on its own as step 1 (PR #58, merged as
`ac1e463e`, applied by the Deploy workflow after CI). The code that reads it
(PR #53) merges only after that.

After deployment, check from anywhere (public endpoints, no credentials):

```bash
pnpm --filter @omnitwin/api venue:verify-site -- --api https://api.venviewer.com
```

It fails unless the stored Trades Hall location is within 100 m of the agreed
site, and validates the sky answer against the contract.

## Out of scope

ECMWF open data (the Met Office series already reach about 14 days; beyond
them dates get normals with `beyond_forecast_horizon`); observations; a write
path for other venues' locations (set them by migration until one is needed).
