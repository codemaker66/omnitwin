# Revenue Management for Event & Function Space: Yield-Heat, Displacement Warnings, and Hold Policies

## TL;DR
- **The math is well-established:** function-space yield should be built on a space-time contribution metric (Kimes & McGuire's ConPAST / IDeaS's RevPAST–ProPAST family) — revenue or contribution ÷ (saleable area × saleable day-parts) — and a yield-heat score is best expressed as a demand-and-value index per room per date/day-part, with named thresholds (>80% = "hot," 65–80% = "warm," 20–64% = "neutral," <20% = "cold") drawn directly from the Cornell Singapore case.
- **Displacement warnings should trigger on contribution, not gross revenue:** the core rule is *accept if event contribution > forecast displaced contribution*; a booking should raise a warning whenever it consumes constrained inventory (space or guest rooms) on a date whose forecast demand exceeds capacity, using contribution margins (F&B ~30–35%, room hire ~85–95%, guest rooms ~70–80%) rather than headline revenue.
- **Sensible hold defaults exist and can ship out-of-the-box:** first option/second option (challenge) systems with 24–72 hour challenge windows, lead-time-scaled hold durations (longer holds far out, shorter close-in), and wash/attrition decay (typically 80–90% commitment, 10–20% allowable slippage) are standard practice and translate cleanly to function space.

## Key Findings

1. **RevPASH → RevPAST/ConPAST is the correct metric lineage.** RevPASH (Kimes, 1998–1999) = total outlet revenue ÷ (available seats × opening hours). For function space this generalizes to revenue/contribution *per available space-time*: RevPAST/ConPAST = revenue or contribution ÷ (square area × available day-part hours). IDeaS G3 implements the full family — RevPAST, ProPAST (profit), RevPOST/ProPOST (occupied), and Function Space Utilization — and explicitly evaluates groups on *profit*, not revenue, because revenue streams carry very different margins.

2. **Displacement analysis has a canonical formula** — Displacement = revenue on constrained dates − potential revenue on non-constrained dates; accept if positive. Best practice uses contribution margins and total value (room hire + F&B + guest rooms + ancillary), accounts for stay-through and multi-slot effects, and the function-space version handles one large booking blocking several smaller ones and low-value holds blocking high-value enquiries.

3. **Option/hold systems are standardized** around first option, second option (with challenge), and joint options, with option/release dates, and translate directly to venue software statuses (Prospect/Tentative/Definite).

4. **Wedding seasonality is steep and quantifiable** — Saturday peak-summer commands large premiums over midweek/off-peak; UK peak is May–September; the gap between a peak Saturday and midweek winter date at one venue can be £5,000–£10,000. Notably, in 2025 (per Bridebook's 2026 report) Saturday fell below half of all UK weddings for the first time (47%).

5. **Utilisation benchmarks cluster in the 40–50% range for hotel function space** measured across all available hours, far below guest-room occupancy, with strong day-part and day-of-week skew (PM >> AM; Saturday PM can exceed 100% via turning the room twice).

## Details

### 1. RevPASH, RevPAST, ConPAST and the space-time metric family

**RevPASH origin (restaurant RM).** RevPASH — Revenue Per Available Seat Hour — was introduced by Sheryl Kimes (Cornell) in 1998. The formula is:

> RevPASH = Total Outlet Revenue ÷ (Available Seats × Opening Hours)

Worked example (SiteMinder): $15,000 ÷ (50 seats × 8 hours) = **$37.50 RevPASH**. Its conceptual power is that it puts *time* at the center: Kimes' insight is that restaurants (and by extension function rooms) sell *time* in the form of a perishable slot — "once the time is gone it's gone."

**Adaptation to function space — ConPAST.** In "Function-space Revenue Management: A Case Study from Singapore" (Kimes & McGuire, *Cornell Hotel and Restaurant Administration Quarterly*, Vol. 42, No. 6, Dec 2001, pp. 33–46), the authors define **ConPAST — contribution per available space for a given time**. It has three components: contribution, space (square feet/metres), and time (the day-part or hour). They argue contribution is preferable to revenue "because revenue alone doesn't account for the varying profit margins arising from renting function spaces."

The margins they cite (used to convert revenue streams into contribution):
- **F&B: 30–35% contribution margin**
- **Room rental: 85–95% contribution margin**
- **AV rental: 50–95% contribution margin**

**Function-space occupancy formula (Cornell):**
> Occupancy = day-parts used ÷ day-parts available. Example: 10 rooms × 3 day-parts × 30 days = 900 available day-parts/month; 450 sold = 50% occupancy.

Kimes & McGuire recommend the *hour* as the ideal time unit but concede the *day-part* is the practical unit (most hotels use 2–3 day-parts per room per day). For divisible rooms, they express each sub-room as a percentage of the whole (e.g., each of 4 Plaza rooms = 25%); when dividers are not in use, occupancy of the combined space is by definition 100%.

**ConPAST empirical values (Raffles City Convention Center, Nov–Dec 2000).** Measured in **$ per available square foot per day-part**:
- **Raffles Ballroom, PM day-part:** overall $4.21; by day — Sun $4.81, Mon $1.90, Tue $2.47, Wed $4.17, Thu $2.35, **Fri $5.59, Sat $7.71.**
- Stamford Ballroom PM: $0.73 overall. Atrium Ballroom PM: $0.33. ECC PM: $0.36. Plaza rooms PM: $0.30.
- **AM ConPAST was near-zero across the board** (highest was ECC at $0.24 overall; Atrium Ballroom just $0.04) — a sharp illustration that AM day-parts were massively under-yielded.

These numbers demonstrate the core design principle for a yield-heat layer: value varies by **room × day-of-week × day-part** by more than an order of magnitude (Raffles Ballroom Saturday PM $7.71 vs Monday PM $1.90 vs its own AM near-$0).

**Occupancy empirical values (same study):**
- PM occupancy ranged **36% (Stamford meeting rooms) to 91% (Stamford Ballroom)** overall.
- Stamford Ballroom by day: **56% (Tue) to 133% (Sat)** — over 100% because the room was turned more than once in the PM day-part.
- AM occupancy ranged **3% (Raffles Ballroom) to 48% (ECC Bailey room)**; slightly higher midweek than weekends.

**The IDeaS metric family (G3 RMS / SmartSpace / Function Space Revenue Management).** IDeaS productizes the space-time family:
- **Function Space Utilization** = % of function space booked (analogous to room occupancy).
- **ProPAST — Profit per Available Space Time** (analogous to RevPAR): combine all revenue streams (banquet food, beverage, room hire, guest rooms) for the day-part, apply each stream's configured profit %, divide by available function space.
- **ProPOST — Profit per Occupied Space Time** (analogous to ADR): same but divided by occupied space.
- **RevPAST / RevPOST** are the revenue (not profit) analogues.
- IDeaS measures **time by hours within a Day Part** (defaults: Morning, Noon, Afternoon, Evening, Overnight, including set-up and tear-down time) and **space by square metre/foot**.
- Crucially, IDeaS **evaluates groups on profit**: its documentation gives the example of a group with $900 banquet food + no room hire being *less* valuable than one with $800 room hire only, because room hire margin is far higher.

IDeaS confirms the industry framing that meetings & events represent a huge share of hotel revenue — its meetings & events page states: "With the potential for meetings & events to represent up to 60% of overall revenue for hotels, it's time to take revenue management beyond the guest room." Paul Van Meerendonk of IDeaS has similarly noted (HospitalityNet) that "when it comes to managing meetings, events and other ancillary revenue streams which for most hotels makes up 40-60% of their revenue, the science of revenue management is still at its infancy." This is the prize that justifies function-space RM.

The broader metric debate (Reuters Events interview with Puneet Mahindroo): RevPAR alone is "an incomplete measure"; **RevPAST (revenue per available space-time) or ConPAST (contribution per available space-time)** are proposed as the total-revenue analogues, with ConPAST preferred where chains can exchange profit data. GOPPAR and ProPAST/ProPOST appear in the IDeaS glossary as the profit-based measures.

**"Available" space-time.** Defined as saleable area × number of saleable day-parts (or hours) in the operating window, including set-up/tear-down time (IDeaS folds set-up/tear-down into the day-part, which lowers ProPAST when turnaround is long — a deliberate signal to minimize dead time). F&B and ancillary are attributed to the space metric by summing all revenue streams for the day-part and applying stream-specific margins, versus a room-hire-only variant that would ignore the (usually larger) F&B and guest-room contribution.

### 2. Displacement analysis

**Canonical formula (Lighthouse/Xotels/HospitalityNet):**
> Displacement = Revenue on constrained/identified dates − Potential revenue on non-constrained dates.
> If positive → accept the group; if negative → decline and hold for higher-value business.

**Group value component (Lighthouse):**
> Group value = number of rooms × (ADR − room cost) + additional revenue − related expenses

**Contribution-based worked example (happyhotel):** 100-room hotel, group wants 30 rooms/night for 3 nights at €60. Forecast individual demand: Day 1 = 70, Day 2 = 95, Day 3 = 85 rooms. Individual ADR €120, variable cost €50 → **contribution €70/room.** On Day 2 (forecast 95) and Day 3 (85), accepting 30 group rooms displaces individual demand because 95/85 + 30 exceeds 100; on Day 1 (70) there is no displacement (70 + 30 = 100). The correct decision compares the group's total contribution (room + €800 F&B) against the *displaced individual contribution* on the constrained nights only.

**Profit-based single-night example (Verdant/Copeland):** Accept 20 rooms at $200 ($4,000) + $2,000 other = $6,000; if declined, expect to sell 16 rooms at $300 ($4,800) + $1,600 ancillary = $6,400. Net = $6,000 − $6,400 = **−$400 → decline.** This cleanly illustrates that a *higher headline group revenue can still be displacement-negative.*

**Function-space-specific displacement.** Kimes & McGuire: "the manager must determine the expected contribution associated with each event and compare that with any potential displacement of other business. If the expected contribution is higher than the potential displacement, the group should be accepted." Function space adds three wrinkles beyond guest-room displacement:
1. **One large booking blocking several smaller ones** — a full-ballroom buy-out on a divisible space forecloses 2–3 divided bookings that might in aggregate yield higher ConPAST.
2. **Low-value hold blocking a high-value enquiry** — a tentative meeting-room hold on a Saturday PM ballroom slot blocks a high-ConPAST wedding.
3. **Multi-slot / stay-through effects** (Duetto): a mid-week ballroom buy-out damages the ability to sell a Monday–Friday pattern; group rooms are usually standard rooms, leaving only suites for transient.

**Last Room Value / LRV rule (Xotels):** displacement can also be evaluated at the account level — if a Last-Room-Availability corporate account books over a high-demand date at €100 while the last-room value is €300, the hotel "loses" €200 of opportunity.

**How RMS vendors implement it:**
- **IDeaS G3 / Function Space Revenue Management:** profit-based group evaluation integrated with Delphi; "analyzing the value of displacement and accepting the most profitable business"; automated forecasts by day and day-part; ancillary revenue by market segment feeds transient displacement analysis. Group evaluations can be started inside Delphi.
- **Duetto:** builds two forecasts (with/without the group), layers ancillary spend (F&B, parking, casino), and models the stay-through factor.
- **Amadeus RMS:** contribution-based models (per the Reuters Events interview).
- **Lighthouse/Cloudbeds/happyhotel:** provide displacement calculators/spreadsheet methodology using PMS + RMS + CRM data.

**Inputs required for a displacement warning:** forecast (unconstrained) demand by date/day-part/segment; capacity (rooms and space); average booking value/contribution by segment; contribution margins by revenue stream; lead-time/booking-pace curves; and the candidate booking's total value. **Trigger condition:** warn when (a) the date/slot is forecast to be demand-constrained (forecast demand ≥ capacity, or occupancy forecast in the "hot" 80%+ band) AND (b) the candidate booking's contribution < forecast displaced contribution, OR (c) a lower-value status (e.g., tentative) occupies a slot for which a higher-value enquiry now exists.

### 3. Hold/option policies and release schedules

**First option / second option / joint option (EDGE Venues glossary):**
- **First option** — space held for one client until the option (release) date; they have first right to confirm.
- **Second option** — offered to the next client if the first option lapses; the second option holder cannot confirm unless the first releases, but may **challenge** the first, forcing them to confirm or release.
- **Joint option** — held by two+ clients; first to contract wins.
- **Option date (release date)** — the date the option expires and the venue can re-offer.

**Challenge timelines.** Industry practice (Ticket Fairy venue guide): give first holds **24–48 hours** to confirm with a contract and deposit when challenged, or release. Corporate meeting practice (Zentila RFP glossary) attaches a **first-option date** by which the contract must be returned. Wedding/event trade (mdem) confirms the rise of second/joint options as a vetting mechanism. Vegas is cited as the extreme where major hotels place *no* holds on function space.

**Typical hold durations.** Corporate tentative reservations commonly run **24–48 hours** close-in; provisional event holds run longer far out (e.g., Islington Assembly Hall: "held for up to **10 working days**"). Longer holds are extended for site-visit situations. General principle across sources: **hold duration should scale inversely with proximity to arrival and directly with lead time** — long options far out, short holds close-in and on high-demand dates.

**Courtesy vs contracted blocks (Princeton):** a **courtesy block** has a **cutoff date (typically 30 days prior)** at which unbooked rooms release with no financial obligation; a **contracted block** holds the group financially liable for unused rooms.

**Cut-off, wash, and attrition (translating to forecasts and to function space):**
- **Cut-off date** — typically **30 days out**; unsold block rooms return to general inventory.
- **Group wash** (Duetto) — predict the portion of a block that won't convert; e.g., a 100-room block with historic 90% pickup carries a 10% wash. Wash decays tentative/block inventory in the forecast so it doesn't overstate demand.
- **Attrition clauses** — allowable slippage typically **10–20%** (i.e., 80–90% commitment); measured **per-night, cumulative, or revenue-based** (cumulative is most group-friendly). Room revenue margin is high (**70–80%**), which is why hotels protect it. Resale clauses offset penalties if the hotel resells. Stepped schedules (e.g., release 20% at 90 days, 15% at 60, 10% at 30) are common.
- **For function space specifically:** Kimes & McGuire note hotels reduce cancellation/no-show risk via **non-refundable deposits and prepayment**, and in high-demand cities even require prepayment for the associated guest-room block. If a group reduces its room block materially post-review, hotels often require a proportional release of meeting space (space-to-rooms ratio negotiated up front).

**Venue-software status models and defaults:**
- **Tripleseat:** statuses include Prospect, Tentative, Definite, Lost; **Prospect events are allowed to overlap** (soft holds) while other statuses place hard holds; status rules are configurable; booking- and event-level statuses can differ (e.g., Definite wedding with a Tentative cocktail hour).
- **iVvy:** Prospective / ProspectiveHold → Tentative → Confirmed, with a defined conversion date; single view of quoted/tentative/confirmed for both space and sleeping rooms; iVvy reports customers see ~20% conversion uplift.
- **Priava, Momentus/Ungerboeck, Event Temple, Delphi** provide comparable tentative→definite pipelines. Provisional-booking norms in UK venue contracts cluster around **10 working days**.
- **IDeaS SmartSpace** advises applying **conversion percentages by status (Prospect vs Tentative) and by booking window** — the software analogue of wash — and prioritizing follow-up on high-value tentatives in the immediate booking window.

### 4. Seasonal & day-of-week pricing for wedding venues

**UK seasonality (demand).**
- Peak season is **May–September**; The Knot (US) reports roughly **76% of weddings occur in the May–October half of the year** — its Real Weddings Study finds fall (Sept–Nov) ≈ 35% and summer (June–Aug) ≈ 33% of weddings, with "only 24% of weddings" in the November–April off-season.
- UK day-of-week (Bridebook 2026 report on 2025 weddings): for the first time on record **less than half — 47% — of weddings fell on a Saturday** ("the lowest proportion ever recorded"), while **Wednesday and Thursday saw their highest-ever share** (outside Covid). Savills, citing Bridebook, adds that **40% of bookings fell in the May–August high-peak in 2025** (up from 33% in 2024) and that **over 1 in 3 Gen Z weddings are now Monday–Thursday.** Bridebook's 2026 report ranks **August most popular (17%), May (13%), September (12%).**
- Cheapest vs dearest month (UK): **January ~£15,712 vs June ~£23,989** average total wedding cost (partyhouses.co.uk citing 2024 data).
- US month share (The Knot Real Weddings Study): **October and June ~16% each; May 14%; September 13%; August 10%; December the least popular at ~1%.** Carats & Cake's higher-budget sample reorders slightly: May 15.5%, September 15.4%, June 13.8%, October 13.0%.

**Price differentials (day/season):**
- **Friday** weddings typically **10–25% less** than Saturday; **midweek 20–40% off** weekend rates; **off-peak winter 15–30%** (some sources 30–50%) below peak summer Saturday.
- Absolute UK gap: peak Saturday vs midweek winter at the same venue can be **£5,000–£10,000.**
- Bands/DJs charge **20–30% less** midweek.
- Venue tiered-pricing examples: Peak (May–Sep Saturdays) base +25%; Shoulder (Apr & Oct weekends) +10%; Off-peak weekdays discounted. US consultant rule of thumb: **weddings priced 20–40% above standard day rate** (complexity premium); **off-season floor of ~75% of base rate** (don't discount below).

**Regional (UK) — relevant to a Scotland-based user:**
- London average total wedding **£28,400** (2026); national average **£21,990** (Hitched 2026). **Scotland average ~£17,800**, with mid-market Scottish venues pricing **25–30% below English equivalents** (lower hospitality wages); premium Scottish castle/Highland estates charge **£8,000–£15,000 for weekend hire alone** (Weddings Hub, Jan 2026). Roughly 70% of Scottish weddings fall below £16,000, ~10% above £35,000.

**Lead time.** UK average engagement **23.8 months** (Bridebook 2026); typical venue booking **12–18 months** ahead, **18–24 months** for peak Saturdays at popular venues; off-peak/midweek bookable closer in (6–12 months). **79% of couples book a venue within 4 weeks of first contact** (Bridebook), and **72% won't enquire without visible pricing** — a strong argument for transparent, published seasonal rate cards.

**Dynamic vs fixed debate & elasticity.** The industry is moving from fixed seasonal cards toward demand-based/dynamic pricing (iVvy, Tagvenue, Tripleseat), but with strong caveats against blanket discounting (it "devalues the brand" and attracts price-shoppers). Reported effects: peak-period uplift of **10–20%+**; targeted **5–8% discounts** on high-competitor-availability dates recovered market share in one vendor case study. Consensus best practice: raise peak by **15–30%**, add *value* (extra hour, AV, F&B credit) rather than cutting price off-peak.

### 5. Utilisation benchmarks for multi-room venues

**Headline function-space benchmark: ~40–50%.** Across all available hours, average hotel meeting & banquet space utilisation is cited around **40–50%** (HotelAmplify, Feb 2026) — well below guest-room occupancy, meaning more than half of rentable space-time earns nothing on a given day. *(Caveat: this is a vendor/trade figure citing unspecified "industry benchmarks," not a primary statistical study; treat as indicative.)*

**Measurement.** Utilisation = Total Booked Hours ÷ Total Available Hours (× 100), or the day-part form (day-parts used ÷ day-parts available, per Cornell). More granular variants: square-metre-hours; day-part occupancy; revenue-producing utilisation (IDeaS separates total utilisation from *revenue-producing* utilisation and defines **Function Space Efficiency** = revenue-producing ÷ total utilisation, flagging space used for non-revenue purposes).

**Day-part / day-of-week skew (Cornell empirical).** PM vastly outperforms AM (Raffles Ballroom PM ConPAST $4.21 vs AM $0.09; Atrium PM occupancy 69% vs AM 22%). Weekends peak for social/wedding ballroom demand (Saturday PM Stamford Ballroom 133% — turned twice); weekday daytime peaks for meetings (ECC/Plaza rooms higher midweek AM). Divisible rooms create the trade-off that booking one division forecloses selling the whole — a key input to a combinable-room yield model.

**Demand-band thresholds (Cornell, directly usable for a heat layer):** the Singapore properties designated **occupancy >80% = "hot," 65–80% = "warm," <20% = "cold," 20–64% = "neutral."**

**UK conference/meeting context (UKCAMS 2025, covering 2024).** The VisitBritain-sponsored survey reports the sector "generated an estimated £19.3 billion of direct expenditure… from a total of 1.08 million conferences and meetings, the highest number since 2019… up 12% on 2023," with medium/large events (101–500 delegates) rising to **22% from 15%.** Average **daily delegate rate up 11%**; average 24-hour/residential rate up 4%; **corporate = 52% of events.** (Prior year: DDR ~£46 inc VAT, 24-hr rate ~£158.) Only ~16% of venues offered live availability/instant booking — a market gap. UKCAMS is the authoritative UK supply-side series (33rd year in 2026).

**US meetings context (Knowland/Amadeus, Jan 2024).** "The fourth quarter of 2023 demonstrated that group business in 10 of the top markets in the U.S. has recovered 110 percent compared to the same time in 2019" (Las Vegas 144.1%, Phoenix 123.9%, San Diego 122.5%, Tampa 121.3%). "70.0 percent of events have 200 attendees or less, and… smaller meetings of less than 25 attendees have experienced the most growth, with a 19 percent increase since 2019" (top segment 101–200 attendees = 20.4%). Knowland's own COVID recovery framing used a **35–45% occupancy band as the first recovery step**.

**Academic literature.** Kimes & McGuire (2001) is the seminal function-space RM paper; Eric Orkin, "The Emerging Role of Function Space Optimisation in Hotel Revenue Management," *Journal of Revenue and Pricing Management*; Kimes' broader RM corpus (restaurant RM 1998–2004, golf 2000, group forecasting accuracy 1999). Madanoglu et al. (2015), "Is more better? The relationship between meeting space capacity and hotel operating performance," *International Journal of Hospitality Management* (>20,000 US hotels, 2007–2012) found the average property had ~2,731 sq ft of meeting space and 58.66% *guest-room* occupancy — useful context but not a function-space occupancy benchmark.

## Recommendations

### (a) Yield-heat score per room per date/day-part

Compute a composite 0–100 **Yield Heat Index (YHI)** for each (room, date, day-part) cell, blending forecast *value* and forecast *demand pressure*:

**Step 1 — Value layer (what the slot is worth).** For each cell, compute a normalized **expected ConPAST/ProPAST**:
- ExpectedContribution = Σ(revenue_stream × margin) for the typical/forecast booking in that cell, using default margins: **room hire 0.90, F&B 0.33, AV 0.70, guest rooms 0.75** (Cornell/IDeaS values; make configurable).
- ProPAST_cell = ExpectedContribution ÷ (saleable m² × day-part hours, including set-up/tear-down).
- Normalize each room's ProPAST against its own historical distribution (percentile or min-max) so a small meeting room and a ballroom are comparable → **ValueScore (0–100).**

**Step 2 — Demand layer (how contested the slot is).** Blend forecast occupancy for that date/day-part with booking-pace-vs-lead-time. Map to the **Cornell demand bands** for the color ramp: <20% cold, 20–64% neutral, 65–80% warm, >80% hot → **DemandScore (0–100).**

**Step 3 — Combine.** YHI = w₁·ValueScore + w₂·DemandScore (start w₁ = w₂ = 0.5; expose weights). Render as the heat color; on hover show the underlying ProPAST, forecast occupancy band, and pace. Use **profit/contribution, not revenue,** as the default value basis (IDeaS's core design choice), with a toggle to revenue (RevPAST) for users without margin data.

**Why this works:** it directly operationalizes the Cornell finding that value varies by room × DoW × day-part by >1 order of magnitude, and it gives salespeople a single, explainable color that means "this slot is both valuable and contested — protect it / price it up."

### (b) Displacement-warning logic

**Required inputs:** (1) unconstrained demand forecast by date/day-part/segment for both space and guest rooms; (2) capacity (space m² and rooms) with divisible-room adjacency map; (3) contribution margins by stream; (4) average contribution by segment; (5) booking-pace/lead-time curves; (6) the candidate booking's full value (room hire + F&B + guest rooms + ancillary).

**Trigger a warning when ALL of:**
1. The requested cell(s) are **demand-constrained** — forecast occupancy in the **warm/hot band (≥65%)** OR forecast demand ≥ capacity on any affected date/day-part (include stay-through and adjacent-division effects); AND
2. **Candidate contribution < forecast displaced contribution**, i.e.,
   `Warn if [Σ candidate stream contributions] < [Σ displaced segment contributions on constrained slots only]`.

**Also warn (status-conflict rule):** a lower-value status (Prospect/Tentative) occupies a slot for which a higher-value enquiry now exists → prompt a **challenge**.

**Severity tiers:** RED if displacement-negative on a hot date; AMBER if warm-band or the booking blocks a divisible space that historically yields higher aggregate ConPAST split; GREEN otherwise. Show the *number* and *value* of bookings/enquiries displaced, not just a flag. Default to **contribution**; degrade gracefully to revenue if margins are unset.

### (c) Default hold-expiry / release-schedule policies

Ship these as editable defaults, scaled by lead time and event type:

| Lead time to event | Corporate meeting hold | Wedding / social hold | High-demand date (hot band) |
|---|---|---|---|
| > 12 months | 14–30 days | 14–21 days | 7–14 days |
| 6–12 months | 14 days | 14 days | 7 days |
| 3–6 months | 7 days | 10 days | 72 hours |
| 1–3 months | 72 hours | 7 days | 48 hours |
| < 1 month | 24–48 hours | 48 hours | 24 hours |

- **Second-option / challenge default: 48 hours** (range 24–72h) for the first-option holder to confirm-with-deposit or release when challenged. Auto-notify both parties; auto-expire on timeout.
- **Auto-expiry:** tentative holds auto-lapse at the option date unless a deposit/contract is attached; send reminders at T-7, T-3, T-1 days (mirrors IDeaS SmartSpace's "prioritize immediate-window tentatives" discipline).
- **Wash in the forecast:** decay tentative/prospect inventory by status-specific conversion rates (start Prospect 20–30%, Tentative 60–80% pickup; calibrate to history) so the yield-heat and displacement layers don't overstate demand (Duetto group-wash principle).
- **Cut-off / release for associated room blocks:** default **30 days** prior; stepped release (20% at 90d, 15% at 60d, 10% at 30d) with a resale-offset clause; require **proportional meeting-space release** if the room block is cut materially.
- **Deposits:** default non-refundable deposit to secure a Definite (Cornell: deposits/prepayment are the primary no-show control for function space), higher on hot dates.

**Thresholds that would change these defaults:** if a room's or date's **forecast occupancy enters the hot band (>80%)**, automatically shorten holds one tier and shorten the challenge window to 24h; if utilisation for a room/day-part chronically runs **<20% (cold)**, lengthen holds and relax challenges to aid conversion. Recalibrate wash/conversion rates whenever realized pickup deviates from forecast by more than ~10 percentage points.

## Caveats
- **The 40–50% function-space utilisation benchmark is a trade/vendor figure** (HotelAmplify, 2026) citing unspecified "industry benchmarks"; no primary STR/CoStar, IACC, or Cornell CHR public occupancy percentage was found (STR function data is subscription-gated). Treat as directional. UKCAMS and STR publish rates and volumes but not a headline public function-space *occupancy* %.
- **The Cornell ConPAST/occupancy figures are from one property (Singapore, Nov 2000–May 2001)** and are illustrative of *patterns and methodology*, not universal values; the dollar magnitudes are dated. The methodology (space-time contribution, demand bands, day-part granularity) is what transfers.
- **Margin percentages are typical ranges,** not property-specific; a real deployment must let operators set their own F&B/room-hire/AV/guest-room margins.
- **Wedding percentages differ by source and sample** (Bridebook vs Hitched vs The Knot vs Carats & Cake) due to methodology and sample skew (e.g., higher-budget samples shift month rankings; Bridebook's August-led UK ranking differs from The Knot's October-led US ranking). Day-of-week and month distributions are directional.
- **Displacement forecasts degrade with lead time** — group business can book 2–5 years out, where transient/individual forecasts are unreliable; warnings should widen confidence bands (or suppress) at long lead times.
- **Software status models are not standardized** across vendors (Tripleseat's Prospect-overlap behavior differs from iVvy's ProspectiveHold), so any "default" must map to each integrated system's semantics.
- Some pricing-uplift and market-share figures come from **vendor case studies** (VenueQuoter, iVvy, Tagvenue) and should be read as illustrative marketing evidence, not independent research.