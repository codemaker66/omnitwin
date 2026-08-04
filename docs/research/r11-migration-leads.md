# Research Brief R11 — Migration Paths & Lead Sources (Venviewer)

## TL;DR
- **Build a messy-spreadsheet CSV importer first, not per-vendor connectors.** Every named incumbent (Hallmaster, Tripleseat, Planning Pod, iVvy, Skedda) exports to CSV/Excel, but none exposes a customer-facing extraction API, and correspondence history, attachments, recurring-booking rules and financial history reliably degrade on export. The realistic ingestion reality for both the incumbents and the village-hall/Excel/paper segment is the same: a column-mapping wizard that tolerates dirty spreadsheets, plus a white-glove manual service for the handful of high-value multi-room venues like Trades Hall.
- **The enquiry inbox must be email-first with per-source parsers.** None of Hitched, Bridebook, Add to Event or Tagvenue offers a supplier-facing API/webhook; every one delivers via email notification and an in-platform inbox, and several mask the customer's real email — so a universal email-parsing intake with per-source parsers plus a native web-form widget and manual phone/walk-in entry is the only viable architecture. Dedupe must key on name + event date + phone, never on email (relay/masked addresses break it).
- **Prioritise future bookings + client contacts as the non-negotiable v1 core; defer historical bookings, invoices and documents.** Weight lead-source integrations by segment: Hitched/Bridebook for weddings, Tagvenue/Add to Event for corporate/party, direct web-form + phone for community halls. Response-time SLAs (Tagvenue's 2-business-day request expiry / 72-hour enquiry expiry, Add to Event's 14-day credit refund, the wedding "reply within hours" norm) should drive built-in response timers, SLA countdowns, quick-reply templates and mobile notifications.

## Key Findings

**Part (a) — migration**
1. All five incumbents export the core booking/contact/invoice data to CSV or Excel, but only as *reports*, not as a clean relational dump. Hallmaster exports invoices and a custom-field report to Excel/CSV (and PDF/PNG); Tripleseat exports Bookings, Accounts/Contacts and Leads reports to Excel plus documents as PDFs; Planning Pod exports contacts to CSV/VCF; iVvy has a universal "Export data" button to CSV in every module; Skedda exports bookings and users to CSV/XLSX. **No incumbent offers customer-accessible API-based bulk extraction of the whole account.**
2. What degrades on export is consistent and predictable: correspondence/email threads, attachments/documents (only downloadable one-by-one or as PDFs), recurring-booking rules (flattened to instances), custom fields (patchy), and financial history (as PDFs, not reconstructable ledgers). This is confirmed by third-party migration guidance for adjacent CRMs ("Historical notes and email threads are generally less portable — this is true of any CRM migration").
3. Competitor importers are overwhelmingly **white-glove + template-spreadsheet**, not self-serve. Tripleseat charges **$250 per import file (up to 5,000 rows), with additional rates for files between 5,000 and 10,000+ rows** ("For each import file containing up to 5,000 rows of data, there is a standard rate of $250 per file per import type… Additional rates will apply for larger imports") and requires you to fill its Excel templates and email support. Perfect Venue and Event Temple lead with **free "white-glove" migration** as a sales weapon against Tripleseat. Skedda/iVvy/Planning Pod offer self-serve CSV importers with field-mapping wizards.
4. Switching triggers are real and documented: price rises after acquisition (Tripleseat's acquisition of Gather drove complaints of big price increases and painful migration), 12-month lock-in contracts (a Tripleseat reviewer was billed for 8 remaining months after cancelling), clunky UX, and support problems. Friction: fear of losing historical data, double-entry, retraining volunteer/part-time staff, and seasonality — wedding venues realistically switch in the **Nov–Feb off-season**, community halls around financial-year/AGM boundaries.

**Part (b) — lead sources**
1. Delivery is **email + in-platform inbox everywhere; no supplier API/webhook/Zapier on any of the four.** Hitched delivers RFIs by email (WedPro's third-party tool "reads" the alert email to feed a CRM — there is no official API). Bridebook sends an email notification plus a "Couples Manager" inbox; **the couple's real email is masked except on VenuePro Classic/Expert/Platinum tiers (policy since 1 May 2024)**, otherwise communication is in-platform relay only. Add to Event notifies by email and in-platform inbox; the organiser's **full name and phone are revealed only after the supplier spends credits to quote** (phone shown as 077******** beforehand). Tagvenue delivers by email + internal messenger and **forbids off-platform contact until a booking is confirmed** (address/phone only revealed post-confirmation).
2. Response-time expectations are enforced differently: Tagvenue gives venues **2 business days to accept/decline a booking request or it auto-expires** (enquiries expire after 72 hours; "venues are expected to respond within 24-48 hours"), and surfaces response rate publicly plus a Supervenue badge; Add to Event auto-refunds credits for quotes **unread after 14 days** and pushes "quote within 24 hours"; the wedding platforms use responsiveness as a soft ranking/nurture signal, and Bridebook's own 2026 report found **81% of couples felt frustrated with venue responses at the start of their journey**.
3. Dedupe: available match keys are name, phone, event date, guest count — **email is unreliable because Bridebook/Tagvenue mask or relay it and Add to Event withholds it pre-quote**. No platform dedupes across other platforms; attribution/billing interacts (Tagvenue commission attaches the moment a user first contacts you; Add to Event charges per-quote-credit).
4. UK market weighting: Hitched and Bridebook dominate weddings (Bridebook's UK Wedding Report 2026 — its 10th annual — draws on **7,000+ couples married or engaged in 2026**); Tagvenue (**20,000+ verified venues across the UK, US, Canada, Australia, Singapore and Ireland**; UK commission **12.5%** for invoice-based categories and **15%** for mandatory-online-payment categories) and Add to Event (pay-per-lead credits, no commission; **used by 1.5M+ customers across the UK**) skew corporate/party; community halls get mostly direct/phone/local enquiries and rarely use directories at all.

## Details

### PART (a): How UK venues migrate booking systems

#### 1. Data export capability by incumbent

**Hallmaster (village/church/community halls; ACRE- and SCVO-endorsed; the primary competitor for Venviewer's community-hall segment).**
- **Exportable:** Invoices (download or export to Excel); a full custom-field **Reports module** covering bookings, income per customer, income per activity, occupancy — exportable to Excel, and to PDF/PNG. Booking lists can be printed ("Print Grid") with description, admin notes, special requirements, equipment. Invoice lists download as CSV for accounting import (Sage/Xero via export/import, no direct API).
- **Formats:** CSV, Excel, PDF, PNG, print. No documented customer-facing API for bulk data extraction.
- **Degradation (inferred):** Export is report-oriented — you get tabular bookings/invoices/customers, but there is no evidence of a single relational dump preserving recurring-booking rules as rules, correspondence, or attachments. Recurring bookings appear as multiple invoice line-items/instances, not as a rule.
- **Lock-in / assistance:** Low. 90-day free trial, low monthly price (~£12–15/month single venue per third-party comparison; "£2.64 per week" quoted on its church-hall page). Reports/exports are self-serve in-app. No known exit fee or data-hostage behaviour. This makes Hallmaster venues **cheap to win and technically easy to extract from** — but the data is thin (volunteers keep sparse records).

**Tripleseat (restaurant/hotel/multi-room event venues; the incumbent most like Trades Hall's use-case).**
- **Exportable:** Three report families — **Bookings Data** (Booking Details Report reports "everything in a Booking including any and all custom fields"), **Accounts & Contacts** (full contact list with emails, exportable to Excel), and **Leads**. Financial data for Tickets exports via Event > Exports (emailed link, valid 24h). Documents (BEOs, invoices, contracts) download **as PDFs**, individually or batch. Calendar via ICS feed.
- **Formats:** Excel/CSV (reports), PDF (documents), ICS (calendar). No customer bulk-export API.
- **Degradation:** Documents are PDFs (not structured contract data); financial/payment history via processor (Stripe/Square) must be pulled from the processor, not Tripleseat; the built-in "Discussion"/email thread is repeatedly described by reviewers as clunky and is not cleanly exportable.
- **Lock-in / exit behaviour:** **12-month contract lock-in** — a Trustpilot reviewer reported being billed for the remaining 8 months after cancelling a nominally "monthly" plan. Post-Gather-acquisition **price increases** are a documented complaint. Its own **inbound import** costs **$250/file (≤5,000 rows), with additional rates for 5,000–10,000+ rows** via emailed Excel templates — signalling migration is treated as a paid, manual, support-mediated process industry-wide.

**Planning Pod.**
- **Exportable:** Contacts export to CSV/VCF or connected apps; event data managed per-event; imports accept CSV/VCF/ICS with field-matching. Reports cover archived events.
- **Formats:** CSV, VCF, ICS. Import wizard has explicit field-mapping ("Match the fields from your file… If the information is not in a valid format, you will not be able to submit it").
- **Degradation (inferred):** Contacts export cleanly; there is no documented one-click full-account export of events+financials+documents together. Its own import guidance shows the tolerance model Venviewer should copy (header detection, per-field mapping, validation step).
- **Assistance:** Offers "custom onboarding plans… including data migration options" — i.e., human-assisted.

**iVvy.**
- **Exportable:** The strongest self-serve export of the set — an **"Export data" button in every module** ("In any given area of iVvy, this export button is available") producing CSV. CRM contacts import/export with duplicate handling. Reports export to CSV.
- **Formats:** CSV throughout.
- **Degradation (inferred):** Function-diary bookings, proposals, BEOs and email logs live in different modules; extraction is module-by-module CSV, so reassembling a booking's full history (proposal + BEO + emails + payments) on the far side requires stitching. No single relational dump.
- **Lock-in:** Not established from sources — flag as unverified.

**Excel / paper diaries (the true "incumbent" for most small UK venues and much of the community-hall market).**
- Real UK venue spreadsheets and paper diaries are highly heterogeneous. Common patterns evidenced by template ecosystems and vendor descriptions:
  - **One sheet/tab per room, per year, or per month** ("we suggest creating a new sheet each month"; hotel templates ship "a sheet per room/room-type").
  - **Colour-coding as data** (status conveyed by cell fill; conditional-formatting drop-downs of symbols like ★/✔/x/O to mean confirmed/paid/no-show/closed) — the meaning lives in the colour, not a column.
  - **Merged cells** for multi-day or multi-slot bookings; **mixed date formats** (DD/MM/YYYY dominant in the UK but inconsistent); free-text time fields ("13:00 PM").
  - Columns typically: date, room/space, hirer name, contact (phone more often than email), start/end time, purpose/activity, fee, deposit, paid?, notes.
  - Paper diaries: a single physical book "that followed her everywhere" (Hallmaster's own testimonial), often held by one volunteer booking officer.
- **Import tolerance required:** header row optional/variable; per-column mapping; tolerant date parsing; ability to treat a colour/symbol legend as a status field (or at least not choke on it); multi-sheet ingestion (merge tabs into one booking table with room derived from tab name); dedupe of repeated regular hirers.

#### 2. What importers competitors offer
- **Self-serve CSV with field mapping:** Planning Pod, iVvy, Skedda (bulk user upload via CSV; bookings/users export to CSV/XLSX). These import **contacts and forward-looking data**; they generally do **not** rebuild historical financials or correspondence.
- **White-glove as a sales tool:** **Perfect Venue** ("our white glove migration ensures every past and present event detail transfers over"; "we'll migrate all of your events for you") and **Event Temple** (dedicated onboarding; documented Opera PMS/Sales-&-Catering migration for First Hotels, "all mission-critical data before go-live") explicitly weaponise free migration to win switchers — especially switchers fleeing Tripleseat.
- **Paid, template-driven manual import:** **Tripleseat** ($250/file, Excel templates, email to support).
- **What they refuse / can't do:** Across CRM/PMS migrations the consistent refusal set is **email/correspondence threads, attachments, and full financial ledgers**; adjacent-industry guidance is explicit that "historical notes and email threads are generally less portable" and that PMS "automated migration" almost always hides manual steps. Recurring rules are re-created, not imported ("plan to recreate recurring schedules… rather than expecting a clean import").

#### 3. What makes venues switch vs stay
- **Triggers (documented):** (a) **Acquisition-driven price hikes** — Tripleseat's Gather acquisition produced "significant price increase" complaints; (b) **contract lock-in surprises** (billed 8 months post-cancellation); (c) **clunky/dated UX** (Caterease "felt super dated"; Tripleseat "overwhelming" post-migration); (d) **support problems** (some Tripleseat users "waiting days" for help); (e) for community halls, **moving off paper/Excel** because customers now expect to see availability and book online 24/7.
- **Friction (documented + inferred):** fear of losing historical data; double-entry during parallel running; retraining **volunteer/part-time** staff (acute in halls); website-embed/calendar dependencies; and **contract timing**.
- **Seasonal switching windows:** Wedding venues will not switch during wedding season — the realistic window is the **Nov–Feb off-season** (engagement season Nov–Feb simultaneously drives couples in, so venues want new tooling live *before* it). Community halls align to **financial-year and AGM/committee cycles**. Hallmaster's own reviews show halls going live in October after a summer trial — consistent with an autumn cutover before the new year.

### PART (b): How UK venue enquiries arrive

#### Hitched (weddings; part of The Knot Worldwide / WeddingPro).
- **Delivery:** Email RFI ("Request for Information") + storefront. The mandatory fields on a Hitched RFI are **only the enquirer's name, registered phone number and wedding date** — venue location is not even mandatory, forcing suppliers to reply asking for basics. A supplier reported a **~92% "ghosting" rate** on RFIs where further info was requested.
- **Programmatic access:** No official API. Third-party WedPro "reads the contents of the alert email" and feeds it into its CRM with a source tag — i.e., **email parsing is the only integration path**, exactly the model Venviewer must replicate.
- **SLA/ranking:** WeddingPro pushes fast, same-channel replies; responsiveness is a soft signal, not a hard expiry.

#### Bridebook ("UK's #1 wedding planning app").
- **Delivery:** Email notification ("click 'View Enquiry'") **plus** the in-platform **"Couples Manager"** inbox. Fields exposed: names, preferred date, guest count, budget, enquiry detail, plus a **Lead Source** column and auto "Hot Lead" labelling. (Bridebook's marketing also claims enquiries can show "other venues they've enquired with," but this is not confirmed in help docs — treat as unverified.)
- **Email masking:** **Since 1 May 2024, the couple's email address is available only on VenuePro Classic/Expert/Platinum plans**; on lower/free tiers venues must use Bridebook's built-in messaging (relay). This directly breaks email-based dedupe.
- **Programmatic access:** No public API/webhook/Zapier. Bridebook offers an **inbound "Lead Capture" relay email** (a per-venue address that ingests a venue's *other* enquiries *into* Bridebook) and a VenuePro **website widget/Enquiry Hub** — both inbound, not an outbound feed. Export is manual CSV/Excel from Couples Manager.
- **SLA/ranking:** Response rate/speed feeds Bridebook's nurture and soft ranking; couples are certified (validated email at signup). Bridebook's 2026 report found 81% of couples felt frustrated with venue responses at the start of their journey.

#### Add to Event (corporate/party/wedding-services marketplace; "UK's leading marketplace for event suppliers," used by 1.5M+ customers).
- **Delivery:** Email notification + in-platform **Inbox** showing event title, date, distance, brief details, and "when you'd be the first to quote." **Mobile push app: not verified.**
- **Contact masking + credit model:** Free to preview requests; the organiser's **full name and telephone are revealed only after the supplier spends credits to send a quote** (phone previewed as 077******** beforehand). Credits are value-based (bigger jobs cost more credits); **no commission** on the booking ("The only time we charge is when you send a quote to a customer for the first time… We don't charge any commission at all").
- **Refund/attribution:** Credits auto-refunded if a quote is **unread after 14 days**; **no refund once a quote is viewed**, regardless of outcome. This makes response speed and quote quality directly monetary.
- **Programmatic access:** **No API/webhook/Zapier**; the ToS actively bars circumventing the platform. Email + manual inbox only.

#### Tagvenue (corporate/meeting/party; 20,000+ verified venues; free to list, commission on confirmed bookings only).
- **Delivery:** Email notification + **internal messenger only**. Tagvenue **prohibits exchanging personal/contact details off-platform**; venue address/phone are revealed to the user only **after** a booking is confirmed, and all booking comms "must take place via Tagvenue Platform's internal messenger."
- **SLA/ranking (hard):** A booking request **auto-expires if not actioned within 2 business days**; enquiries expire at **72 hours** ("venues are expected to respond within 24-48 hours, with inquiries expiring after 72 hours if unanswered"); expiries hurt the venue's public **response rate**, and high performers earn the **Supervenue** badge. Tagvenue recommends SMS notifications to avoid expiry.
- **Attribution/billing:** UK commission is **12.5%** for invoice-based categories and **15%** for categories with mandatory online payments (Meetings/Production/Dry Hire); 10% applies only in the US/Canada/Singapore. The commission right "arises at the point when a Booking Enquiry… is made" (or when Tagvenue first suggests the venue) — so dedupe/attribution disputes are governed entirely by Tagvenue's platform, and off-platform poaching is contractually barred.
- **Programmatic access:** No public supplier API; Tagvenue's own "Tagvenue Pro" AI CRM (launched 2025) ingests the venue's website/email/social leads into Tagvenue — an inbound competitor to Venviewer's inbox, not an outbound feed.

#### Direct website enquiry forms.
- The venue's own form is the highest-intent, un-masked, un-commissioned channel — the couple/organiser's real email and phone are exposed, and there is no per-lead cost. This is the channel Venviewer most fully controls and should own end-to-end with a native embeddable widget/endpoint.

#### UK market weighting by segment
- **Wedding venues:** Hitched + Bridebook dominate discovery (Bridebook's 2026 report draws on 7,000+ couples; industry data cited by third parties says a large majority of couples use online marketplaces, enquire with multiple venues in one sitting, and book fast). Cost model: annual subscription/VenuePro tiers.
- **Corporate/meeting + party/private-hire:** Tagvenue (commission) and Add to Event (pay-per-lead credits) lead; both skew to exactly the multi-room urban/party use-case Trades Hall serves for non-wedding business.
- **Community/village halls:** Overwhelmingly **direct, phone and local/word-of-mouth**; directory presence is minimal. Their "lead source" is a phone call or a walk-in, which is why **manual entry** and a simple web form matter more than directory parsers for that segment.

## Recommendations

### A. Minimum-viable importer scope (onboarding)
**Stage 1 (v1 — build first):**
1. **A messy-spreadsheet CSV/XLSX import wizard** with: per-column field mapping; optional header-row detection; tolerant UK date parsing (DD/MM/YYYY default, fallback heuristics); multi-sheet ingestion that derives *room* from tab names; and a preview/validate/fix step (copy Planning Pod's and iVvy's mapping-then-validate UX). This one tool serves **both** the Excel/paper segment **and** every incumbent, because they all export to CSV/Excel.
2. **Import only two entity types as the non-negotiable core: future bookings and client/contact records.** These are what every incumbent exports cleanly and what a venue cannot operate without on day one.
3. **White-glove manual migration for high-value multi-room venues (Trades Hall class).** For a small number of urban/historic venues the data is complex and the deal size justifies human setup; make free white-glove migration an explicit sales weapon exactly as Perfect Venue and Event Temple do against Tripleseat.

**Stage 2 (fast-follow):** historical (past) bookings; room/space configuration and pricing templates; invoice/payment *history as reference records* (imported as read-only line items, not a reconstructed ledger).

**Stage 3 (later / white-glove only):** documents/contracts (import as attached PDFs, not structured data); notes.

**Explicitly refuse in v1:** correspondence/email-thread history; recurring-booking *rules* (import instances only, re-create rules in-product); custom fields beyond a small mapped set; live financial ledgers/payment reconciliation; attachments at scale. These are precisely what incumbents can't cleanly export and what every comparable CRM/PMS migration abandons.

**Trigger-aware go-to-market:** target Tripleseat switchers on **contract-renewal boundaries** (12-month lock-in) and post-price-rise; target wedding venues in the **Nov–Feb off-season**; target Hallmaster halls at **financial-year/AGM** time. Lead with "we'll bring your future bookings and client list across for free."

**Benchmarks that change the plan:** if discovery shows target venues routinely need *historical financials* to operate (e.g., deposit tracking across a season), promote invoice-history import from Stage 2 into v1. If a per-vendor structured export (e.g., a stable Tripleseat report schema) proves common enough, build a *pre-mapped profile* for that CSV on top of the generic wizard — but only after the generic wizard ships.

### B. Lead-source intake adapters (enquiry inbox)
**Architecture (build in this order):**
1. **A universal email-parsing intake** (a unique per-venue ingest address + inbound parser) with **per-source parsers** for Hitched, Bridebook, Add to Event and Tagvenue notification emails. This is not a fallback — it is the *only* path, because none of the four offers a supplier API/webhook/Zapier. Model it on WedPro's proven "read the alert email → tag the source → drop into the pipeline" approach.
2. **A native web-form widget/endpoint** for the venue's own site — the highest-value, un-masked, zero-cost channel and the one Venviewer fully controls.
3. **Manual quick-entry** for phone and walk-in enquiries — essential for the community-hall segment whose leads are overwhelmingly phone/direct.

**Priority order by segment:** For Trades Hall and urban/historic multi-room venues → **Tagvenue + Add to Event + own web form** first (their non-wedding corporate/party business), then Hitched/Bridebook for the wedding line. For the broader wedding market → **Hitched + Bridebook** first. For community halls → **web form + manual entry** first; directory parsers are low priority.

**Dedupe strategy (given masking):** Never key on email. Use a **composite match on (normalised name) + (event date) + (phone, first-3-digits-tolerant)** with guest-count as a tiebreaker, and surface *suspected duplicates* for one-click human merge rather than auto-merging. Rationale, evidenced above: Bridebook masks email off the top tiers, Tagvenue forbids contact exchange pre-confirmation, and Add to Event withholds name/phone until a quote is paid — so email is absent or relayed on three of four channels, and event date + name is the only cross-channel constant.

**SLA-driven inbox features (mapped to each platform's real mechanics):**
- **Per-enquiry response timer + SLA countdown**, pre-set to each source's clock: **Tagvenue 2 business days for a booking request / 72h enquiry expiry** (hard — missing it delists you from response-rate), **Add to Event "quote within 24h" and the 14-day unread-refund window**, and a configurable "reply within X hours" for wedding leads.
- **Quick-reply templates with smart fields** (name, date, guest count) so a first reply goes out in minutes — directly addresses Hitched's "info missing, please tell me the venue" problem and the wedding "first good reply wins" dynamic.
- **Mobile push notifications** for new enquiries (Tagvenue explicitly recommends SMS alerts to avoid expiry; the same urgency applies across sources).
- **Response-rate/first-response analytics** per source, so venues can see which channel converts and whether they're beating each platform's SLA.

**Benchmarks that change the plan:** if any platform ships a real supplier API/webhook, promote a native connector for that source above its email parser. If masked-email dedupe error rates prove high in production, add fuzzy name-matching and an explicit "same couple?" review queue before considering any paid enrichment.

## Caveats
- **Verified vs inferred:** Export *formats* (CSV/Excel/PDF) for all five incumbents are verified from vendor help pages. The *degradation* claims (recurring rules flattened, correspondence/attachments not exportable, financials as PDFs) are partly inferred from the structure of what's offered plus corroborating cross-industry migration guidance, not always from an explicit "you cannot export X" statement. Where a vendor's full-account export capability could not be confirmed (notably iVvy's contract/lock-in terms), this is flagged as unverified rather than asserted.
- **Lead-delivery specifics** for Add to Event and Bridebook are from their current help centres (2024–2026). Add to Event's mobile-push app, Bridebook's "other venues enquired" field, and any official Bridebook lead-feed equivalent to WedPro's Hitched feed could **not** be verified. No supplier-facing API on any of the four is an absence-of-evidence finding (none documented; Tagvenue and Add to Event ToS actively discourage circumvention), not a formal confirmation that none exists.
- **Third-party statistics** on wedding response times and conversion (e.g., "first venue to reply wins," 47-hour average response) come largely from vendor content-marketing (VenueBot/GoEngage, WeddingPro) and should be treated as directional, not independently audited. Bridebook/Hitched figures (7,000+ couples; 81% frustrated with venue responses) are from their own annual reports.
- **Scope:** This brief is deliberately about *exit/export* and *lead intake*, not the incumbents' general features (covered in R1). Pricing figures (Tripleseat $250/import, Hallmaster ~£12–15/mo, Tagvenue 12.5%/15% UK commission) are point-in-time and should be re-checked before being quoted externally.