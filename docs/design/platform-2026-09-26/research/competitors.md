## Competitive landscape for venue and event sales and operations software

I researched venue and event sales and operations software on 26 September 2026: what each product offers, what users praise and what they complain about. Then I compared that with what Venviewer's code already has.

I did not change any repository files or git state.

### How to read the evidence

The main review sites and most vendor sites were blocked by this environment's network proxy for direct fetching. That includes G2, Capterra, TrustRadius, Software Advice, HotelTechReport, Trustpilot, Skift, cvent.com, tripleseat.com, amadeus-hospitality.com and docs.oracle.com; oracle.com returned 403 and reddit.com could not be fetched.

Review evidence therefore comes from **search-engine summaries of those pages**, cited by URL:
- Quotes are as the search results surfaced them. Re-verify them in a browser before quoting anything outside the company.
- Some sources are vendor or competitor marketing: Perfect Venue comparison pages, nurturepro, docket.io, eventsair and taskip. I have marked these.
- Venviewer's current status comes from **reading the source code** (schema, services, types). I did not check the rendered UI or whether any of it is deployed.

This report builds on earlier research already in the repo and does not repeat it:
- `docs/research/r1-incumbent-teardown.md`: holds, option ladders and BEOs across Event Temple, Tripleseat, Momentus, Planning Pod, iVvy, Perfect Venue, Caterease and UK hall tools.
- `docs/research/r11-migration-leads.md`: exports, importers and UK lead channels.
- `docs/research/r8-calendar-sync.md`, `docs/research/r9-payment-rails.md`, `docs/research/r7-uk-operational-context.md` and `docs/research/r2-ops-ethnography.md`.

What is new here: the enterprise incumbents (Salesforce, the Cvent suite, Delphi, OPERA), a synthesis of user-experience complaints tied to the founder's principle, and a parity map against Venviewer's source.

---

## 1. The landscape at a glance

| Segment | Products | Who buys them |
|---|---|---|
| General CRM adapted to venues | Salesforce, and Salesforce-based tools: Amadeus Sales & Event Management (the successor to Delphi), Thynk, Blackthorn Events | Hotel groups, large venues and corporates with admin staff |
| Planner platform plus supplier marketplace | Cvent Event Management (planner side); Cvent Supplier Network (CSN), RFPs, advertising and Sales & Catering CRM (venue side); Cvent Event Diagramming (formerly Social Tables); Passkey room blocks | Corporate planners; hotels and venues chasing planner RFPs |
| Hotel sales and catering | Amadeus Delphi, Oracle OPERA Sales & Catering / OPERA Cloud Sales and Event Management, Event Temple, Thynk; in the UK, Guestline, Inntelligent and Alacer | Hotels with bedrooms plus function space |
| Venue and event management, mid-market | Tripleseat, Perfect Venue, iVvy, Planning Pod, Priava (now Momentus Priava), EventPro, VenueBook (UK) | Restaurants, unique and heritage venues, conference venues |
| Enterprise venues | Momentus (formerly Ungerboeck; also absorbed EventBooking, VenueOps and Priava), Artifax (arts, UK) | Convention centres, arenas, concert halls |
| Small-business client-flow tools | HoneyBook | Solo planners and small wedding venues |
| UK marketplaces and lead sources | Hire Space, Tagvenue, Add to Event, Hitched, Bridebook | Sources of enquiries, not systems of record (see r11) |

---

## 2. Product by product: what it offers, praise and complaints

### 2.1 Salesforce, as used by venues and hospitality

**What it offers.**
- A general CRM (accounts, contacts, opportunities, activities, reports and dashboards) with 7,000+ AppExchange apps.
- Venues use it either raw, with custom objects, or through products built on it: Amadeus Sales & Event Management Advanced, the Delphi lineage ([Amadeus](https://www.amadeus-hospitality.com/advanced/central-sales/)); Thynk ([thynk.cloud](https://thynk.cloud/product/sales-and-catering)); and Blackthorn Events for registration ([blackthorn.io](https://blackthorn.io/)).
- Blackthorn covers registration and payments, not function-room hire (search summary).

**Praise.**
- Deep customisation, strong reports and dashboards, and the app ecosystem. G2 4.4 from 25,000+ reviews ([G2 Sales Cloud pros and cons](https://www.g2.com/products/salesforce-salesforce-sales-cloud/reviews?qs=pros-and-cons), search summary).

**Complaints.**
- Cost: licences, add-ons and storage. Realistic total cost is often 2-3 times the list price ([appreviewlab](https://appreviewlab.com/salesforce-review-2025/), [salesmate](https://www.salesmate.io/blog/salesforce-for-small-businesses-expensive/)).
- A steep learning curve, and an interface that "can sometimes feel cluttered or overwhelming" (G2 summary).
- Heavy admin load, and implementations that overrun.
- Hotel-specific: HotelTechReport ranks Salesforce **9th of 9** among hotel sales software for large hotels, on 5 reviews, with Thynk the top alternative ([HotelTechReport](https://hoteltechreport.com/meetings-and-events/hotel-sales-software/salesforce)). Its Salesforce-based rivals also say deployments "often require configuration decisions, data modelling, and integration planning before teams see full value" ([HotelTechReport, Thynk](https://hoteltechreport.com/meetings-and-events/hotel-sales-software/thynkcloud)).
- Email: Einstein Activity Capture's captured emails "aren't created as records". They appear only in the Lightning timeline, cannot be reported on, and those captured before a record exists do not attach ([Salesforce Help](https://help.salesforce.com/s/articleView?id=000384895&language=en_US&type=1), [Salesforce Ben](https://www.salesforceben.com/salesforce-einstein-activity-capture-for-gmail-or-outlook-pros-and-cons/)).
- Salesforce's own research: reps spend less than 30% of their time selling ([Salesforce newsroom](https://www.salesforce.com/news/stories/sales-research-2023/)).

**Exit route.** The weekly Data Export Service produces ZIPs of CSVs for all objects (Enterprise, Performance and Unlimited editions; monthly otherwise). The files are deleted 48 hours after the email ([Salesforce Help](https://help.salesforce.com/s/articleView?language=en_US&id=sf.admin_exportdata.htm)).

### 2.2 Cvent

**Event Management (planner side).**
- Offers registration, payments, attendee and budget management, room blocks (Passkey), sourcing, reporting and on-site check-in ([Cvent products](https://www.cvent.com/en/products), [Passkey](https://www.cvent.com/en/event-marketing-management/passkey-room-block-management)).
- Praise: "all under one umbrella", strong registration and check-in, and helpful support. G2 4.3 from about 3,083 reviews; Capterra 4.5 ([vfairs](https://www.vfairs.com/blog/cvent-review/), [checkthat.ai](https://checkthat.ai/brands/cvent/reviews)).
- Complaints:
  - "CVent is not user friendly at all. It takes 12-15 clicks what you should be able to do in 3-4, and the dropdowns don't make sense."
  - "clunky and took a while to navigate between sections"; "could use a modern refresh"; "options are so complex, it's extremely clunky"
  - bugs and slow performance; "constant change in feature/UI without proper communication"
  - All from [Capterra](https://www.capterra.com/p/26318/Cvent-Event-Management/reviews/?page=7) via search summaries.
  - On G2 its weakest scores are ease of use and ease of set-up.
  - Pricing is opaque, contracts auto-renew over several years, and renewals rise ([docket.io](https://docket.io/resources/research/cvent-review), competitor-published).
  - The Event Management certification takes about 25-35 hours of coursework ([Cvent](https://www.cvent.com/en/resources/event-management-prep-guide)). That is evidence of how much there is to learn.

**Venue sourcing, the Supplier Network (CSN) and RFPs (venue side).**
- CSN lists about 340,000 hotels and venues. Venues pay for advertising and manage RFPs from CSN, their own website form and other sources in one view, with "Response Assistant" drafting replies ([Cvent hotel RFP management](https://www.cvent.com/en/supplier-venue/hotel-rfp-management), [CSN](https://www.cvent.com/en/event-marketing-management/cvent-supplier-network)).
- Cvent also sells a **Sales & Catering CRM**: "Leads come in automatically from the Cvent Supplier Network … create custom contracts and BEOs" ([Cvent venue management](https://www.cvent.com/en/supplier-venue/venue-management-software), search summary).
- Industry context: hotels convert only about 3% of RFPs received (search summary citing [hospitalitynet](https://www.hospitalitynet.org/opinion/4095751.html) and [Hopskip](https://myhopskip.com/blog/if-your-rfp-is-getting-ignored-it-might-be-missing-these-things); unverified). Sending RFPs to too many properties "equals lower-quality bids and irritated sales managers".
- I found no independent reviews of CSN lead quality.

**Event Diagramming (formerly Social Tables).**
- Offers to-scale floor plans and seating, sharing with clients, crew and catering, 3D views, a catalogue of the venue's real inventory, and a new **AI BEO Uploader** that "upload[s] Banquet Event Orders from any external sales and catering system" ([Cvent release notes](https://release.cvent.com/supplierandvenuesolutions/announcements/cvent-event-diagramming-banquet-event-order-beo-uploader)).
- Praise: G2 4.4 from 158 reviews. "The changes are easy to make and you can share the floor plan with clients, crew, and catering"; "3D view … wow'ed our clients"; "it makes diagramming … so easy" ([TrustRadius](https://www.trustradius.com/products/cvent-social-tables/reviews), search summaries).
- Complaints:
  - "Social Tables crashes even when you are performing the simplest of tasks, such as dragging an object" ([HotelTechReport](https://hoteltechreport.com/meetings-and-events/event-management-software/social-tables)).
  - slow with complex diagrams and slow downloads
  - "The 3D view is almost useless … due to improper height rendering" ([spotsaas](https://www.spotsaas.com/product/social-tables/reviews?page=4))
  - "if industry standard is to have tables 4ft apart - I wish that was listed" (TrustRadius)
- Pricing: Essential is free; Professional is $199 a month on a 12-month commitment. Legacy tiers were $49, $150 and $320, and venues are quoted $149 per property ([eventdiagram.com](https://eventdiagram.com/blog/social-tables-pricing/)).

### 2.3 Amadeus Delphi, now Amadeus Sales & Event Management

**What it offers.** A function diary and meeting-room inventory, sales pipeline, contracts, BEOs, pace and group-revenue reporting, and mobile access. The Advanced version is built on Salesforce ([HotelTechReport](https://hoteltechreport.com/meetings-and-events/event-management-software/amadeus-delphi), [Amadeus](https://www.amadeus-hospitality.com/sales-catering-software/delphi/)).

**Praise.**
- It "keep[s] rooms, catering, and billing tied to one event file".
- Branded properties rate its ease of use and support 4.7/5.
- "They run much like other common computer programs which makes using them simple to learn" (search summaries).

**Complaints.**
- "tend[s] to freeze often and create random groups or functions without linking to the account you're trying to add it to" ([Capterra](https://www.capterra.com/p/96710/hotel-SalesPro/), [Software Advice](https://www.softwareadvice.com/catering/amadeus-sales-event-management-profile/reviews/)).
- Forced upgrade to Delphi.fdc: "no longer supporting the older software and Delphi is more expensive".
- "very slow and was difficult to use on Hilton computers because of firewalls".
- "Almost every time I call support the tech says let me check Google".
- Reporting "could use some work"; it could use "a more modern look"; integration trouble with OPERA ([TrustRadius](https://www.trustradius.com/products/amadeus-sales-event-management/reviews), [HotelTechReport comparison](https://hoteltechreport.com/compare/amadeus-delphi-vs-infor-sales-catering)).
- Delphi experience is a common hiring requirement for UK and US catering-sales jobs (job-board search). That is evidence it is a veteran's system of habit.

### 2.4 Oracle OPERA Sales & Catering / OPERA Cloud Sales and Event Management

**What it offers.** A function diary with multi-function space configurations; copying and moving events across properties; BEOs; group room blocks; and integration with the OPERA property management system (PMS) ([Oracle](https://www.oracle.com/hospitality/opera-sales-event-management/), [Oracle docs](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.5/ocsuh/c_managing_the_function_diary.htm), search summaries).

**Praise.** "Having everything from bedrooms, meeting rooms and diaries all in one system is very useful" (search summary).

**Complaints.**
- G2 3.9 from 28 reviews ([G2](https://www.g2.com/products/oracle-hospitality-opera-sales-and-catering/reviews)).
- "Often slow, and bugs can occasionally take some time to fix."
- It can take "several minutes" for an account to show up.
- "clunky, outdated, and unintuitive … navigating menus and configuring workflows requires extensive training" ([thehotelgm](https://thehotelgm.com/tools/oracle-opera-review/)).
- Support is "absolutely horrendous and impossible to get ahold of", with "complete disregard for the customer once the system is installed".
- Modular pricing brings high upfront and ongoing cost.

### 2.5 Tripleseat

**What it offers.** Lead forms, a colour-coded calendar, BEOs, proposals and contracts with e-signature, a guest portal with card-on-file payments (PartyPay, now in the UK), 2D/3D floor plans through partners, Outlook and Google sync, a Cvent RFP integration, and a Toast-free POS ecosystem ([Tripleseat guest portal](https://tripleseat.com/features/guest-portal/), [Cvent partnership](https://tripleseat.com/partners/cvent/)). It says it is used by more than 18,000 venues and is growing in the UK ([PR Newswire](https://www.prnewswire.com/news-releases/tripleseat-expands-global-footprint-with-growing-presence-in-australia-and-the-united-kingdom-302865832.html)).

**Praise.**
- G2 4.5, with 70% five-star reviews.
- "if you stare at it long enough, you'll probably figure out how to do what you are trying to do"
- "create proposals and BEOs in near record time"
- responsive support ([G2](https://www.g2.com/products/tripleseat-tripleseat/reviews?qs=pros-and-cons), search summaries).

**Complaints.**
- "The number of features it offers can feel overwhelming."
- Capabilities that are "not quite as obvious or easy to find"; "any small typo keeps what you are searching for from popping up".
- "almost all of our emails from tripleseat end up in spam … we probably have missed a ton of leads".
- A plan that looks monthly but is "a full 12-month contract".
- Data sometimes "not updated properly and [you] need to refresh the page a few times … missed or messed up catering orders".
- Google calendar export updates after "a random amount of time"; room-type mapping errors cause sync problems.
- No Toast integration.
- Sources: [G2](https://www.g2.com/products/tripleseat-tripleseat/reviews), [Capterra](https://www.capterra.com/p/118047/Tripleseat/reviews/), [SelectHub](https://www.selecthub.com/p/event-management-software/tripleseat/).
- Imports cost **$250 per file of up to 5,000 rows**, sent by email on templates ([Tripleseat support](https://support.tripleseat.com/hc/en-us/articles/1500010133582-Data-Imports-Overview)).
- "Tripleseat … the migration, guest confusion on payments, and staff training difficulties made it a messy process". This is a testimonial published by competitor Perfect Venue, so treat it as vendor-sourced ([perfectvenue.com](https://www.perfectvenue.com/perfect-venue-vs-tripleseat)).

### 2.6 Perfect Venue

**What it offers.** A central calendar including leads, BEO and proposal automation, a payments portal, AI-drafted email replies, and "express book" online booking with menu choice and deposit ([Perfect Venue features](https://www.perfectvenue.com/features)).

**Praise.**
- Capterra 4.8 from 75 reviews.
- "excels at maintaining visual organization"; "quick to learn, easy to use"; "easy to start a proposal from the calendar"; "reports dashboard is easy to read" ([Software Advice](https://www.softwareadvice.com/venue-management/perfect-venue-profile/), [Capterra](https://capterra.com/p/266878/Perfect-Venue/reviews/)).

**Complaints.**
- "lost events stay greyed on the calendar keeping it cluttered".
- "when I need to cancel certain dates, I think I need to cancel all instances".
- No Toast or OpenTable integration; "a little difficult to navigate, and bugs".
- Perfect Venue's own site claims switchers do "the same tasks … with half the clicks" (vendor claim).

### 2.7 iVvy

**What it offers.** A function diary, live online availability, instant booking and RFQs on websites and third-party channels, yield pricing, branded proposals, e-signed contracts, **version-controlled BEOs**, virtual run sheets on tablets, and automated invoicing ([iVvy](https://www.ivvy.com/venue-event-management-software/)).

**Praise.**
- "best in-market for price capability and flexibility"
- valued for its reliability by users of more than a decade, some at 15 years
- easy to update storefront information ([Capterra](https://capterra.com/p/141909/IVvy/reviews/), search summary).

**Complaints.**
- "The search function requires exact spelling".
- "only three invoices can be created automatically".
- No instalments or seasonal ("winter") discount.
- "Breakfast numbers don't always update when room numbers change".
- "doesn't integrate with hotel software"; "unless you are a manager … nothing can be deleted".
- Support callbacks do not come.
- Menu, contract and BEO template changes "have extra costs".
- "Searching for dates in the diary can be tricky".
- Sources: [Software Advice](https://www.softwareadvice.com/venue-management/ivvy-venues-profile/reviews/), [softwarefinder](https://softwarefinder.com/event-management-software/ivvy-venue-management/reviews).
- A conference and events manager's wish: a function-diary section for "public holidays, school holidays, and promotions … important when quoting".

### 2.8 Event Temple

**What it offers.** Group sales CRM, catering, proposals, contracts, BEOs, invoices and a guest portal with scheduled payments. It has two-way real-time PMS sync (Mews, Stayntouch, Cloudbeds, OPERA Cloud, Apaleo), native Gmail and Microsoft 365, QuickBooks, an open API, and Cvent RFP intake ([Event Temple PMS](https://www.eventtemple.com/pms), [integrations](https://www.eventtemple.com/integrations)).

**Praise.** Capterra 4.9 from 76 reviews: "extremely user friendly", with strong support and praised e-signing and email integration ([Capterra](https://www.capterra.com/p/157951/Event-Temple/reviews/)).

**Complaints.**
- Reporting is "the only weak area" and inflexible; set-up and integration are hard; the proxy phone number is not local; gratuity set-up is awkward ([JoinSecret](https://www.joinsecret.com/event-temple/reviews)).
- The earlier repo research found that any user could edit or delete an invoice without notice (`docs/research/r1-incumbent-teardown.md`, Event Temple section).

### 2.9 Priava (now Momentus Priava)

**What it offers.** Enterprise cloud venue booking for arenas, universities, museums, theatres and conference centres. It covers availability, quotes, invoices, run sheets, a CRM with several contacts per event, a branded checkout, and integrations with NetSuite, HubSpot, Salesforce, Mailchimp, Outlook and SAP ([SourceForge](https://sourceforge.net/software/product/Priava/), [Crozdesk](https://crozdesk.com/software/priava), [Momentus Priava sheet](https://infohub.gomomentus.com/hubfs/Sale%20Sheets/Momentus-PRIAVA-Sell-Sheet.pdf?hsLang=en)).

**Praise.** "easy & intuitive", with "helpful, knowledgeable and local customer service". Crozdesk scores it 79/100, with user trends "falling".

**Complaints.** None could be retrieved from accessible sources; this is a gap in the evidence, not proof of satisfaction.

### 2.10 Momentus (formerly Ungerboeck)

**What it offers.** CRM, booking, event management, catering, an event portal, room diagramming, accounting, reporting, an API and an AI assistant ("Ask Mo"). It claims more than 85% of the largest convention centres, including ExCeL London ([gomomentus.com](https://gomomentus.com/), [Momentus AI](https://gomomentus.com/ai)). It is the reference implementation for ranked holds (r1).

**Praise.** Capterra 4.3 from 98 reviews: "very user friendly"; "visually appealing … easy to use calendar"; event and service orders "very easy".

**Complaints.**
- Slow loading; "not [an] autosave feature when booking events".
- "The way the layout is makes it incredibly difficult to see each line".
- "since version 20 … booking procedures are a little cumbersome".
- "Onboarding … is a giant challenge"; training comes as "piece-meal webinars".
- "customer communications are very weak".
- "I need to reach the support team whenever I want to create a new report".
- Sources: [G2](https://www.g2.com/products/momentus-technologies-formerly-ungerboeck/reviews), [Software Advice](https://www.softwareadvice.com/venue-management/momentus-technologies-profile/reviews/).

### 2.11 Planning Pod

**What it offers.** Booking calendar, floor plans, BEOs (front of house, kitchen, client), proposals, contracts, e-signature, invoices, Adyen payments with instalments, client portals and hold deadlines ([Planning Pod](https://planningpod.com/features)).

**Praise.** Support staff "make our experience so easy"; "tremendously streamlined our process" ([techraisal](https://www.techraisal.com/software/planning-pod/)).

**Complaints.**
- "messages/email/payment receipts can show up under the wrong account … met with the 'it's you not us' mentality".
- A dated interface and editor; navigation split between links and pull-downs.
- The portal "will crash for hours"; clients find it "confusing and overwhelming"; calendar sync is unreliable.
- Sources: [Capterra](https://www.capterra.com/p/125947/Planning-Pod/reviews/); [perfectvenue.com](https://www.perfectvenue.com/post/planning-pod-review), competitor-published.

### 2.12 HoneyBook

**What it offers.** Proposals, contracts, invoices, a scheduler, automations and a client portal.

**Praise.** Automations are "a game changer", along with the portal and having everything in one place. G2 4.4 ([G2](https://www.g2.com/products/honeybook/reviews)).

**Complaints.**
- February 2025 repricing reported as an 89.5% rise, with the basic plan going from $19 to $36 ([taskip](https://taskip.net/honeybook-reviews/)).
- Templates and workflows are rigid.
- No BEOs, floor plans or supplier tools ([EverBridal](https://www.everbridal.com/blogs/honeybook-for-wedding-venues)).
- Card payouts take 2-3 days ([nurturepro](https://nurturepro.io/honeybook-reviews/), competitor-published).

**Its own survey of 455 US venues (July 2026):**
- 96.9% lack the tools to grow volume significantly.
- About two-thirds build BEOs by hand.
- Wedding enquiries arrive over six channels: email 27.2%, personal texts 26.7%, Instagram DMs 12.6%, and others.
- Sources: [GlobeNewswire](https://www.globenewswire.com/news-release/2026/07/27/3333569/0/en/honeybook-survey-reveals-97-of-event-venue-managers-lack-an-easy-system-to-organize-bookings.html), [TechStartups](https://techstartups.com/2026/08/04/wedding-venue-booking-inquiries-scattered-across-communication-channels-honeybook-data-shows/).

### 2.13 UK-specific tools

- **Artifax:** described as "the industry standard for performing arts centres", used by the Royal Albert Hall, the Barbican and the Royal Festival Hall. Users praise its calendar, documents and custom reports; "at first sight … can seem daunting to new users" ([Capterra UK](https://www.capterra.co.uk/software/128117/artifax-event), [artifax.com](https://artifax.com/)).
- **EventPro UK:** "doesn't include good floor plan design tools", a less modern UI, a noticeable learning curve, and no client portal, payment processing or marketing tools ([research.com](https://research.com/software/reviews/eventpro), [perfectvenue](https://www.perfectvenue.com/post/eventpro360-review), competitor-published).
- **Hotel conference and banqueting tools:**
  - Inntelligent: automated function sheets from quotes, staged payments, credit notes ([inntelligent.co.uk](https://inntelligent.co.uk/products/conference-banqueting-management/)).
  - Alacer: department-specific sheets ([alacer.co.uk](https://alacer.co.uk/modules/functions-events/)).
  - Guestline: automated function sheets ([guestline.com](https://www.guestline.com/products/property-management/cb-food-and-beverage-management/)).
  - No independent reviews were found for any of them.
- **VenueBook:** from £79 a month. Matches enquiries to rooms, day delegate rate bookings, function sheets with dietary breakdowns, Stripe deposits, Xero sync and a client portal ([venuebook.co](https://venuebook.co/corporate-event-venue-software)).
- **Community halls:** Hallmaster (endorsed by ACRE; used by Scottish village halls) and Bookteq ([hallmaster.co.uk](https://www.hallmaster.co.uk/), [bookteq.com](https://www.bookteq.com/venue-booking-software/)).
- **Scottish heritage venues:** I could not confirm the system used at any named Scottish heritage or conference venue (EICC, SEC or livery-style halls). That remains a gap. UK job adverts list "Delphi, TripleSeat, or similar" as desirable experience.
- **UK lead channels.** Hitched, Bridebook, Tagvenue and Add to Event (r11). Bridebook's UK Wedding Report 2026 found:
  - 79% of couples book within 4 weeks;
  - 43% expect a reply within 24 hours;
  - 81% felt frustrated with venue responses;
  - US-written CRM guides ignore these channels ([venuebot.io](https://venuebot.io/blog/2026-state-of-uk-wedding-venue-enquiries), [theweddingmarketers.com](https://www.theweddingmarketers.com/guide-best-wedding-venue-crm)).

---

## 3. Complaint themes across all products

Each theme below is a source of the daunted, tired and frustrated feeling the founder's principle forbids.

| Theme | Evidence | Design answer |
|---|---|---|
| Too many steps; features you cannot find | Cvent "12-15 clicks … 3-4"; Tripleseat "overwhelming", "not … obvious"; OPERA "extensive training"; Artifax "daunting" | An action budget per task; one clear next step in a fixed place (the Enquiries desk pattern) |
| Slowness, freezes, stale data | OPERA "several minutes"; Delphi "freeze often"; Momentus slow loading; Tripleseat "refresh the page a few times"; Social Tables crashes | A declared latency budget; optimistic updates with honest confirmation; live data without refresh |
| Search that fails on real names | Tripleseat typo; iVvy "exact spelling" | Typo- and accent-tolerant universal search |
| Lost work | Momentus has no autosave | Autosave everywhere, with a quiet "saved" state |
| Wrong or orphaned records | Delphi's "random groups … without linking"; Planning Pod's mis-filed messages and receipts | A visible match reason, one-step reassignment, audit |
| Email that does not arrive or is not captured | Tripleseat's spam; Salesforce captured email not stored as records | Send as the venue's own domain; capture threads as records |
| Reporting that needs support staff | Momentus; Event Temple; Delphi | Self-serve reports and a pace view |
| Clutter | Perfect Venue's greyed lost events; Momentus lines "difficult to see" | Show live business only; history one step away |
| Hostile commercial terms | Tripleseat's 12-month lock-in and $250 imports; Cvent's auto-renewals; HoneyBook's price rise; iVvy charging for template changes | Honest terms; free import and export; templates the venue owns |
| Support that vanishes | OPERA "impossible to get ahold of"; Delphi's "check Google"; iVvy callbacks; Planning Pod's "it's you not us" | Help and diagnostics inside the product; transparent status |
| Client portals that confuse clients | Planning Pod | A client surface simpler than the staff surface |

---

## 4. (a) Parity map: what Venviewer must offer so a veteran can leave Salesforce and Cvent

Status legend (from code inspection only; the UI and deployment were not verified):
- **Present:** a schema, service or route exists.
- **Partial:** a model exists but a key part is missing.
- **Absent:** not found.

| Capability incumbents have | Who has it | Venviewer status (inspected) | Gap / priority |
|---|---|---|---|
| Enquiry intake and triage | All | **Present.** Enquiries desk; `routes/enquiries.ts`, `routes/public-enquiries.ts`, `state-machines/enquiry.ts` | Add multi-channel intake (below) |
| Cvent Supplier Network RFP intake | Cvent S&C CRM, Tripleseat, Event Temple | **Partial.** `cvent` is listed as a provider in `packages/types/src/integration-layer.ts:21-30`, but the layer is "Metadata and guardrails only. No live provider calls" (lines 13-19) | **P1** if Trades Hall receives CSN RFPs |
| UK lead channels (Hitched, Bridebook, Tagvenue, Add to Event) | Not modelled by US tools; UK guides flag this | Absent | **P1** (email parsers per r11) |
| Accounts, contacts, opportunities, activities, tasks | Salesforce, all S&C tools | **Present.** `schema.ts:723-826`; `routes/crm.ts`, `clients.ts`, `opportunities.ts` | Needs import and email capture to be credible |
| Two-way email: send as the venue, capture threads | Event Temple (Gmail/M365), Tripleseat, Salesforce EAC | **Partial.** Outbound sends and templates exist (`schema.ts:948`, `2530`); the only inbound webhook is Clerk auth (`routes/webhooks.ts`) | **P1** |
| Two-way calendar sync | Tripleseat, Perfect Venue, Priava (Outlook) | **Partial.** `external_calendar_links` has a `syncDirection` field (`schema.ts:2494-2508`); no sync code found | **P1** (architecture in r8) |
| Function diary with holds, option ladder, conflicts, turnarounds | Momentus (ranked); others have flat holds | **Present and ahead.** `bookings` rank/jointFlag/decisionAt (`schema.ts:3271-3323`); `hold-hygiene.ts:64,132` reordering; T-7/3/1 reminders (`hold-reminders.ts:10-12`); `turnaround_rules` (`schema.ts:3343`) | Make it visible in the Diary rebuild |
| Recurring series, cancelling one occurrence | Perfect Venue (weak), Tripleseat | **Partial.** `seriesId` is "day-one nullable … a series table arrives with recurrence work" (`schema.ts`, bookings) | P2 |
| Proposals, versions, client accept | All | **Present.** `proposals`, `proposal_versions`, `share_tokens`, `comments` (`schema.ts:2090-2206`); client accept transitions (`state-machines/proposal.ts:17-45`) | Add e-signature evidence |
| Quotes, packages, pricing rules | All | **Present.** `schema.ts:843`, `2207-2286` | UK packages (below) |
| Day delegate and 24-hour rates, VAT apportionment, service charge, minimum spend | UK hotel conference and banqueting tools; VenueBook (day delegate rates) | **Absent.** No VAT or tax-rate fields found by grep over `packages/api/src` and `packages/types/src` | **P1** for a UK heritage venue |
| Agency commission | Hotel S&C tools (inference) | **Absent.** No commission fields found | P2 |
| Deposits and staged payments collected online | Tripleseat PartyPay, Planning Pod (Adyen instalments), Event Temple, HoneyBook, VenueBook (Stripe) | **Partial.** Deposit/balance maths in `services/money.ts:138-148`; Stripe only for platform subscriptions (`schema.ts:1008-1050`) | **P1** (rails in r9) |
| E-signature | Tripleseat, iVvy, Event Temple, Planning Pod, HoneyBook | **Partial.** `e_sign` provider is metadata only | P1 |
| BEO / function sheet with version tracking | iVvy (versioned), Delphi, OPERA, Tripleseat | **Present.** `beo_documents` (`schema.ts:1834`), `snapshot_diffs` (1846), `event_plan_changes` and acknowledgements (2287-2360), hallkeeper sheet PDFs | Show the highlighted diff and who has acknowledged |
| Floor plans, 2D/3D, shared with client and crew | Cvent Event Diagramming, Tripleseat (via partners), Planning Pod, Momentus | **Present and a differentiator.** Configurations, layouts, placed objects, runtime packages of the real reconstructed rooms | Spacing and capacity guidance; speed |
| Furniture and inventory | Cvent catalogue, Momentus | **Present.** `venue_inventory_*`, `inventory_reservations` | – |
| Supplier coordination | Momentus; HoneyBook lacks it | **Present.** `schema.ts:1681-1793` | – |
| Event-day run sheet and mobile ops | iVvy (tablet run sheets), Momentus (mobile ops) | **Present.** `event_missions*`, `ops_tasks`, `event_day_issues` | Check tablet-first use |
| Reporting: pipeline, pace, conversion, revenue | Salesforce (strength), Delphi (pace), Momentus Analytics | **Partial.** `routes/revenue-analytics.ts`, `analytics_snapshots` (`schema.ts:2439`), `ExecutiveAnalyticsView.tsx` | Self-serve builder, lost reasons, response time |
| Accounting export | Event Temple (QuickBooks), VenueBook (Xero), Priava (NetSuite/SAP) | **Partial.** `accounting` provider is metadata only | P2 |
| Data import | All vendors offer some; Tripleseat charges $250 per file | **Absent.** No importer found in routes, services or dashboard components | **P0**: the largest switching barrier |
| Free export, any time | Tripleseat reports; Salesforce weekly ZIP | CSV references were found only in analytics UI files; I did not confirm an export feature | P1 |
| AI assistance | Cvent Response Assistant and BEO Uploader, Momentus Ask Mo, Perfect Venue AI replies, Event Temple AI sales suite | **Present.** `routes/ai-assistant.ts`; desk AI drafts | Keep drafts factual; no praise copy |
| Room blocks and bedrooms | OPERA, Delphi, Cvent Passkey, Event Temple via PMS | Not applicable to Trades Hall (no bedrooms; inference) | Out of scope unless Blake says otherwise |

---

## 5. (b) The "wish it existed" list: small problems users say nobody solves

Each item below comes from a reported complaint or wish.
1. **Search that forgives typos.** Tripleseat: "any small typo keeps what you are searching for from popping up". iVvy: "requires exact spelling". *Venviewer's client search is ILIKE substring (`routes/clients.ts:68-70`), which does not forgive typos.*
2. **Emails that reach the client.** Tripleseat: "almost all of our emails … end up in spam".
3. **Never losing a half-made booking.** Momentus: no autosave.
4. **Numbers that flow through.** iVvy: breakfast numbers do not follow room numbers.
5. **A diary without clutter.** Perfect Venue's lost events stay greyed out.
6. **Cancelling one date of a series.** Perfect Venue.
7. **Holidays and promotions on the diary.** iVvy: a conference manager's explicit request.
8. **Built-in spacing guidance.** Social Tables: "tables 4ft apart - I wish that was listed".
9. **3D that matches the real room.** Social Tables' 3D is "almost useless" because of heights. Venviewer's measured rooms answer this directly.
10. **Reports without a support ticket.** Momentus; Event Temple's reporting is "the only weak area".
11. **Correspondence on the right client, every time.** Planning Pod; Delphi's "without linking to the account".
12. **Captured email that counts.** Salesforce: EAC emails are not records and do not appear in activity reports.
13. **Instalments and seasonal pricing.** iVvy: no instalments, no "winter discount".
14. **More than three automatic invoices.** iVvy.
15. **Templates staff can change without paying.** iVvy charges for menu, contract and BEO template changes.
16. **Delete and undo with a trail.** iVvy: nothing can be deleted unless you are a manager. Event Temple (r1): invoices deleted with no trace.
17. **A local phone number.** Event Temple's proxy number is not local.
18. **POS and restaurant links.** Toast/OpenTable are missing in Tripleseat and Perfect Venue. For the UK this is a Trades Hall question: which catering tills and systems?
19. **Honest commercial terms.** Tripleseat's 12-month lock-in; Cvent's auto-renewals; HoneyBook's 89.5% rise.
20. **A client portal clients can use.** Planning Pod clients find it "confusing and overwhelming".
21. **UK-native commercial maths.** Day delegate and 24-hour packages, VAT apportionment between exempt room hire and standard-rated catering (HMRC [VATLP11800](https://www.gov.uk/hmrc-internal-manuals/vat-land-and-property/vatlp11800), [UHY](https://www.uhy-uk.com/insights/applying-vat-exemption-room-hire)), and agency commission of about 8-10% ([MGN Events](https://www.mgnevents.co.uk/insights/venue-finding/), [Convene](https://convene.com/catalyst/office/standard-commission-for-third-party-agencies/)). *Inference: US-built tools are unlikely to model these natively. I did not verify this vendor by vendor.*
22. **Answering the whole question fast.** Planners want every RFP question answered (4 in 10), accurate prices (24%) and a reply within 4 days (80%) ([Cvent press release](https://www.cvent.com/en/press-release/new-study-reveals-planners-want-speed-and-accuracy-rfp-responses)). Only about 22% of planners are satisfied with hotel responses ([Hospitality Net / Knowland](https://www.hospitalitynet.org/opinion/4114871.html)).

---

## 6. (c) Switching costs and migration pains Venviewer should remove

| Pain | Evidence | What Venviewer should do |
|---|---|---|
| Paid, support-mediated imports | Tripleseat $250 per file, up to 5,000 rows, on emailed templates ([support](https://support.tripleseat.com/hc/en-us/articles/1500010133582-Data-Imports-Overview)) | A free self-serve import wizard: upload, map columns, preview, dedupe, create; one-click rollback of an import batch |
| Leaving Salesforce | The weekly Data Export ZIP of CSVs, deleted after 48 hours ([Salesforce Help](https://help.salesforce.com/s/articleView?language=en_US&id=sf.admin_exportdata.htm)) | Accept the ZIP as-is; recognise standard objects (Account, Contact, Opportunity, Task, Event, EmailMessage); map custom objects with a preview |
| Spreadsheets, paper, email | About two-thirds of venues build BEOs by hand ([HoneyBook survey](https://www.globenewswire.com/news-release/2026/07/27/3333569/0/en/honeybook-survey-reveals-97-of-event-venue-managers-lack-an-easy-system-to-organize-bookings.html)) | An importer that tolerates messy spreadsheets (r11 recommendation); photo or PDF function sheets turned into drafts using the existing `event-sheet-extractor.ts`, with every extracted field confirmed by staff |
| Losing correspondence history | r11: threads and attachments degrade on export; Salesforce EAC emails are not records | Import email history from the mailbox itself (M365/Gmail) by client address and date range, not from the old CRM |
| Losing future business | r11: future bookings plus contacts are the minimum core | Import future holds and confirmed bookings first, with ranks and decision dates; run a conflict check before commit |
| Email and calendar re-plumbing | Tripleseat's sync delays and mapping errors; Planning Pod's unreliable sync | Direct M365 and Google integration; delta sync plus reconciliation (r8) |
| Cvent RFPs arriving elsewhere | Tripleseat and Event Temple integrate CSN | CSN RFPs land in the Enquiries desk as new enquiries, with the RFP's questions shown as a checklist so every question gets an answer |
| Training time | Cvent certification is 25-35 hours; Momentus "piece-meal webinars"; OPERA "extensive training" | No training needed for the first task. Help appears where it is needed, and the vocabulary is the venue's own (option, decision date, function sheet, final numbers) |
| Double running during cut-over | Inference from r11 (switching seasons; fear of losing data) | A read-only "shadow" period: import nightly from the old export while staff start new work in Venviewer, with a clear handover date |
| Contract lock-in and exit fear | Tripleseat 12 months; Cvent auto-renewal | Monthly terms if commercially viable (Blake's decision); a full export at any time in documented CSV/JSON |
| Staff habit (Delphi and Salesforce muscle memory) | Delphi named in job adverts | Keyboard shortcuts and a command bar; "Delphi words" accepted as search synonyms (inference) |

---

## 7. What this means for the design direction

The founder asks for a tool that veterans feel proud of and never daunted by. The evidence says incumbents fail less on what they can do than on:
- how much effort each action takes (clicks, finding things, training);
- whether the data can be trusted (wrong records, stale data, lost work, email in spam);
- speed (freezes, minutes-long loads);
- how fairly customers are treated (lock-in, paid imports, paid template changes, absent support).

The design rules in this report turn each of those into a measurable requirement. Venviewer is already ahead of the market on three things: ranked holds with automatic reordering, operational change acknowledgement, and real-room 3D. It is behind on the four items that actually stop a switch: data import, live email and calendar, Cvent/UK lead intake, and client payments with UK VAT. Until those are live, a beautiful interface alone will not move a 50-year veteran. That last point is an inference from the evidence above.

## 8. Limits

- Review quotes are search-engine summaries of pages I could not open (G2, Capterra, TrustRadius, Software Advice, HotelTechReport, Trustpilot). Re-verify before any external use.
- Vendor and competitor sources are marked; treat their claims as marketing.
- Industry statistics come from vendors (Cvent, HoneyBook, Bridebook, Knowland) and have their own sampling limits. The Cvent speed statistics are from its 2017 report.
- I found no reviews of Priava or of the UK hotel conference and banqueting tools, and could not confirm which systems named Scottish heritage venues use.
- Venviewer statuses come from reading schema and services only. The UI, deployment and Blake's acceptance were not checked.

## Files inspected

- /home/user/omnitwin/.claude/conventions/product-experience.md
- /home/user/omnitwin/docs/design/enquiries-desk-2026-09-24/README.md
- /home/user/omnitwin/docs/research/r1-incumbent-teardown.md
- /home/user/omnitwin/docs/research/r11-migration-leads.md
- /home/user/omnitwin/docs/research/r2-ops-ethnography.md, r7-uk-operational-context.md, r8-calendar-sync.md and r9-payment-rails.md (opening sections only)
- /home/user/omnitwin/packages/types/src/integration-layer.ts
- /home/user/omnitwin/packages/api/src/db/schema.ts
- /home/user/omnitwin/packages/api/src/services/hold-reminders.ts, hold-hygiene.ts and money.ts
- /home/user/omnitwin/packages/api/src/state-machines/enquiry.ts and proposal.ts
- /home/user/omnitwin/packages/api/src/routes/clients.ts, webhooks.ts and integrations.ts"
