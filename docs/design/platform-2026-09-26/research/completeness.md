## What Venviewer may still be missing (T-638)

Research for Blake's third-round instruction to add "anything else we may of missed to be the most amazing venue and events business platform ever". Read-only; 26 September 2026. It extends [roadmap.md](../roadmap.md) §3 and §5, [competitors.md](competitors.md) and `docs/research/r7`; r7 already covers licensing hours, occasional licences, noise, keys and SIA door staff. New evidence here covers Caterease, Access Collins, Trail, Cvent Instant Book, Tripleseat Direct Book, Momentus work orders and iVvy ticketing. **None of this is legal advice.**

### How to read the evidence

The proxy blocked direct fetches from gov.uk, legislation.gov.uk, gov.scot, the ICO, HSE, NRS, G2 and TrustRadius. Links marked **(s)** were read through a search-engine summary; check them in a browser before relying on them. Vendor pages are marketing. What the product has comes from reading the source at `2be601ca`, not the running app.

### 1. Not in the source at all

Menus, guest lists or seating; VAT, invoices or client payments; e-signature; SMS, WhatsApp or calls; custom fields or a live public API; room occupancy limits; a staff rota; marketing consent or retention rules; work orders (only an `internal_block` booking type).

### 2. Gaps beyond the roadmap

| # | Capability | Best tools | Venviewer today | Value | Size |
| --- | --- | --- | --- | --- | --- |
| G1 | A menu library with the 14 allergens per dish, feeding kitchen production | Caterease: menu cost, recipes, allergen review, prep, labels, pack counts ([TEC](https://www3.technologyevaluation.com/solutions/49373/caterease), s) | **Missing.** Diet counts and free-text allergies only (`packages/types/src/event-requirements.ts`) | High | L |
| G2 | Named guests on the real floor plan: RSVP, meal, seat, place cards, kitchen sheet, check-in | Planning Pod ([s](https://planningpod.com/seating-charts)); Cvent ([s](https://www.cvent.com/en/supplier-venue/event-diagramming-software)) | **Missing** guests; **has** the real placed tables | High | M–L |
| G3 | SMS, WhatsApp and calls on the record | Tripleseat with Kenect ([s](https://tripleseat.com/partners/kenect/)); Event Temple call logs ([s](https://www.eventtemple.com/pipeline-and-crm)) | **Missing**; roadmap #2 covers email only | High | M–L |
| G4 | Custom fields the venue controls; a real API and webhooks | Tripleseat ([fields](https://support.tripleseat.com/hc/en-us/articles/31802433974807-Custom-Fields-What-they-are-and-how-to-use-them), [webhooks](https://support.tripleseat.com/hc/en-us/articles/360002146094-Tripleseat-Webhooks), s) | **Missing**; the webhook is a stub (`packages/api/src/routes/integrations.ts`) | Medium–high | M–L |
| G5 | Occupancy limits per room, layout and building, checked across events at the same time | Cvent diagrams carry capacities (s) | **Missing** | High | S–M |
| G6 | Each guest's access needs carried to their seat, route and the evacuation list | Cvent tags attendees (s) | **Partial**: event-level only | Medium–high | S–M |
| G7 | Building care: work orders from issues and damage, rooms out of service, inspections | Momentus ([s](https://gomomentus.com/enterprise-event-management-software)); [Trail](https://trailapp.com/) (s) | **Partial**: `internal_block`; issues | Medium | M |
| G8 | The venue's own compliance calendar, with evidence | Trail | **Missing** | Medium–high | M |
| G9 | Purchase orders to suppliers; resold services with cost and margin | Caterease | **Missing** | Medium | M |
| G10 | Retention, subject access, erasure with legal holds, consent records | ICO | **Missing** | Medium | M |
| G11 | An accident book with a RIDDOR prompt | — | **Partial**: issues have severity, no injury fields | Medium | S |
| G12 | Heritage house rules acknowledged by clients and suppliers | Category A listed, LB32713 ([s](https://en.wikipedia.org/wiki/Glasgow_Trades_Hall)) | **Partial**: pack acknowledgements, a heritage tag | Medium | S |
| G13 | Drinks packages; bar-tab caps the host approves | Access Collins ([s](https://www.theaccessgroup.com/en-gb/hospitality/access-collins-booking-system/)) | **Missing** | Medium | S–M |
| G14 | Each new enquiry owned by whoever is on the rota | Salesforce assignment rules (s) | **Partial**: a role is notified, not a person | High | S |
| G15 | Ticketed or shared nights; meal pre-orders | iVvy ([s](https://www.ivvy.com/event-ticketing-software/)) | **Missing** | Medium, if Trades Hall runs its own nights | L |
| G16 | Instant booking of standard packages | Tripleseat Direct Book ([s](https://tripleseat.com/features/direct-book/)); Cvent Instant Book ([s](https://www.cvent.com/en/supplier-venue/instant-book)) | **Partial**: the enquiry form and embeds | Low–medium; against roadmap G3 | M |

### 3. Scotland and UK obligations

The product records and prompts; it never claims anything is compliant.

| Obligation | Source (s) | What the product should do |
| --- | --- | --- |
| A full VAT invoice needs set contents and a unique sequential number; records kept 6 years, digitally under Making Tax Digital | [VATREC5010](https://www.gov.uk/hmrc-internal-manuals/vat-trader-records/vatrec5010), [700/21](https://www.gov.uk/guidance/record-keeping-for-vat-notice-70021), [700/22](https://www.gov.uk/government/publications/vat-notice-70022-making-tax-digital-for-vat/vat-notice-70022-making-tax-digital-for-vat) | Number invoices and credit notes in one unbroken series; MTD-ready export |
| VAT on a deposit is due when invoiced or received, whichever is first; refundable security deposits carry none; early-termination and some cancellation fees take the booking's VAT treatment (from April 2022) | [deposits](https://www.gov.uk/guidance/vat-instalments-deposits-credit-sales), [VATTOS5125](https://www.gov.uk/hmrc-internal-manuals/vat-time-of-supply/vattos5125), [RCB 2/2022](https://www.gov.uk/government/publications/revenue-and-customs-brief-2-2022-vat-early-termination-fees-and-compensation-payments/revenue-and-customs-brief-2-2022-vat-early-termination-fees-and-compensation-payments) | Keep advance payments apart from damage deposits; a VAT receipt each time VAT falls due |
| Electronic invoicing for business and government customers from April 2029 | [ICAS](https://www.icas.com/news-insights-events/news/tax/autumn-budget-2025-e-invoicing-will-go-ahead-from-2029) | Keep invoice data structured from day one |
| No surcharge on consumers for most payment methods (since January 2018) | [SI 2012/3110 reg 6A](https://www.legislation.gov.uk/uksi/2012/3110/regulation/6A) | No card fee on consumer payment links |
| Tips and service charges passed on fairly, with a written policy and records per worker (from October 2024) | [Acas](https://www.acas.org.uk/tips-and-service-charges), [code](https://www.gov.uk/government/publications/distributing-tips-fairly-statutory-code-of-practice) | Service charge in its own ledger; needs the rota |
| Glasgow occasional licences: apply at least 7 weeks ahead, fee and documents in by 6 weeks | [occasional](https://www.glasgow.gov.uk/article/6405/Guidance-for-an-Occasional-Licence), [extended hours](https://glasgow.gov.uk/article/6408/Guidance-for-Extended-Hours) | Use the lead time in the licence prompt |
| Unlimited alcohol for a fixed charge is an irresponsible promotion; sellers need 2 hours' training; an age-check policy at 25 is mandatory | [2005 Act sch 3](https://www.legislation.gov.uk/asp/2005/16/schedule/3/crossheading/irresponsible-drinks-promotions), [SSI 2007/397](https://www.legislation.gov.uk/ssi/2007/397/made), [2010 Act](https://www.legislation.gov.uk/asp/2010/18) | Flag "unlimited" packages; training records; trained bar staff from the rota |
| Martyn's Law: duties for 200–799 capacity, stricter from 800, regulated by the SIA; expected spring 2027 | [guidance](https://www.gov.uk/government/publications/the-terrorism-protection-of-premises-act-2025/terrorism-protection-of-premises-act-2025-statutory-guidance), [SIA](https://www.gov.uk/guidance/understanding-martyns-law-and-the-sias-role-as-regulator) | Record the tier, procedures, responsible person and training |
| The duty-holder's fire risk assessment (Fire (Scotland) Act 2005) | [gov.scot](https://www.gov.scot/publications/practical-fire-safety-guidance-existing-non-residential-premises-2/) | Venue-entered occupancy limits; warn when a booking exceeds them |
| Anticipatory reasonable adjustments (Equality Act 2010 s20) | [EHRC](https://www.equalityhumanrights.com/sites/default/files/equality_act_summary_guidance_on_services.pdf) | Record each guest's needs, including help to evacuate |
| A retention schedule; data requests answered within a month (the clock may pause for clarification under the 2025 Act) | [ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/) | Retention per record type; erasure that keeps VAT records |
| A member of the public injured and taken straight to hospital must be reported by whoever controls the premises | [HSE](https://www.hse.gov.uk/riddor/reporting/who-should-report.htm) | A prompt in the accident book |
| The M10 marriage notice goes in between 3 months and 29 days before; for religious or belief ceremonies the schedule is collected no more than 7 days before and returned within 3 days | [NRS M10](https://www.nrscotland.gov.uk/media/1tnbox3r/m10-marriage-notice-form-24_april_2023.pdf) | Reminders to the couple |
| No 14-day cancellation right for date-specific catering or leisure services | [CCR 2013 reg 28](https://www.legislation.gov.uk/uksi/2013/3134/regulation/28) | No cooling-off flow; a simple e-signature is probably enough (take legal advice) |

### 4. The ten highest-value gaps

The roadmap's Tier A still comes first (import, mailbox, intake, quote engine, contract, payments). These run alongside it or straight after:
1. **Menus with allergens per dish, and kitchen production (G1).** Turns "3 nut allergies" into "Table 7, seat 4: sesame in the starter".
2. **Named guests on the real floor plan (G2).** Escort list, place cards, kitchen sheet by table and check-in, with nothing retyped.
3. **Correct UK money handling inside Tier A:** one unbroken invoice series; advance payments apart from damage deposits; VAT at each tax point and on cancellation fees; no consumer surcharges; MTD- and e-invoicing-ready data.
4. **Occupancy, access and evacuation facts (G5, G6).** "Can we fit 220?" answered without claiming compliance.
5. **Messages and calls on the record (G3).** Drafts only; nothing sent automatically.
6. **Building care and a compliance calendar (G7, G8).**
7. **Custom fields and a real API with webhooks (G4).**
8. **Data-protection operations (G10)**, before the Tier A history import.
9. **Supplier purchase orders and resold services (G9).**
10. **Small-print safeguards (G11–G13):** accident book, heritage rules, drinks-package prompts, bar-tab caps, marriage-schedule reminders.

Dependencies: items 3, 4, 5, 6 and 10, and G14, depend on the staff rota; item 6 and G16 depend on automatic turnarounds.

Decisions only Blake can make: ticketed or shared nights (G15); instant small bookings (G16, against the roadmap's default of no public live availability); a service charge on quotes (the tips law then applies). The outcome of Food Standards Scotland's allergen consultation (closed 17 May 2026) was not found.
