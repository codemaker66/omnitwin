# Martyn's Law readiness on the hallkeeper sheet (T-648)

The hallkeeper setup sheet carries a "Martyn's Law readiness" section for the
Terrorism (Protection of Premises) Act 2025. It records what the venue's
operator entered for one event and prints it on the web sheet, the printed
sheet and the PDF. This note holds the rule the section keeps, the legal facts
it rests on and where they were checked.

## The rule: prompts, never claims

- Nothing may say or imply that a venue or event is compliant, approved,
  certified or safe. The section prints the operator's entries and prompts
  for the rest; it is not a legal assessment.
- Every value comes from operator entry. Absence prints "Not set" (people,
  briefing time, door supervision, notes) or "Not checked" (the four
  procedures). Nothing is defaulted, inferred or pre-filled.
- Tier applicability depends on the premises, not on one event. The sheet may
  show the entered guest count (`configurations.guest_count`; 0, the column
  default, reads as not set) beside the Act's thresholds as information. It
  never says an event "triggers" or "falls within" a tier, and it leaves the
  determination to the venue's responsible person.
- Venviewer holds no venue-entered premises occupancy, so the section shows
  none. The 200 and 800 figures are legal constants, not venue capacities.
- `packages/web/src/__tests__/public-claim-guard.test.ts` pattern
  `martyns-law-claim` scans the shared copy (`packages/types/src/protected-premises.ts`),
  the hallkeeper and editor components and the PDF renderer for claim
  wording. `packages/types/src/__tests__/protected-premises.test.ts` checks
  the rendered wording for every combination of empty, partial and full
  records and guest counts.

## Implementation

| Part | Where |
| --- | --- |
| Schema, normalisation and the one wording builder | `packages/types/src/protected-premises.ts` |
| Field on `EventInstructions` | `packages/types/src/hallkeeper-instructions.ts` (`protectedPremises`) |
| Editor block ("+ Add Martyn's Law readiness") | `packages/web/src/components/editor/EventDetailsPanel.tsx` |
| Hallkeeper sheet section (Prepare stage, Brief & contacts, print) | `packages/web/src/components/hallkeeper/ProtectedPremisesBlock.tsx`, `pages/HallkeeperPage.tsx` |
| PDF section | `packages/api/src/services/hallkeeper-pdf-v2.ts` (`renderProtectedPremisesPdf`) |

Storage is `configurations.metadata.instructions.protectedPremises` (JSONB); no
migration. Every field is optional with no default. A defaulted key would
change the parsed metadata that `event-sheet-extractor.ts` hashes, move the
`sourceHash` of every configuration and force new snapshot versions nobody
asked for. The extractor test pins pre-T-648 hashes to prove they did not move.
The live sheet reads the JSONB without parsing, so an absent key is treated as
empty (`hasProtectedPremisesContent`, `hasInstructionContent`). Approved
snapshots taken before the field existed still parse through
`HallkeeperSheetV2Schema` and do not gain the key.

The configuration PATCH shallow-merges top-level metadata, so the editor sends
the whole `instructions` object on every save. `normalizeForSave` trims the
block and drops it when empty; an entered block always travels with the save.
Permissions are unchanged: writes use the configuration edit gates
(`requireEditableConfig`, `canAccessResource`) and reads use sheet access.
`packages/api/src/__tests__/protected-premises-postgres.test.ts` proves, against
a disposable PostgreSQL database, that another venue's admin or hallkeeper can
neither write nor read the block.

## Legal facts and sources

Checked on 8 October 2026 against the primary sources below.

- **The Act.** [Terrorism (Protection of Premises) Act 2025 (c. 10)](https://www.legislation.gov.uk/ukpga/2025/10/contents),
  Royal Assent 3 April 2025.
  - [s.2](https://www.legislation.gov.uk/ukpga/2025/10/section/2): premises
    qualify where "it is reasonable to expect that from time to time 200 or
    more individuals may be present on the premises at the same time" in
    connection with a Schedule 1 use; they are enhanced duty premises at 800
    or more, standard duty premises otherwise.
  - [Schedule 1](https://www.legislation.gov.uk/ukpga/2025/10/schedule/1)
    para 6 lists "a venue for hire for events or activities", an exhibition
    hall and a conference centre; para 2 lists food and drink for consumption
    on the premises.
  - [s.3](https://www.legislation.gov.uk/ukpga/2025/10/section/3): a
    qualifying event is held at premises that are not enhanced duty premises,
    is open to the public, may reasonably be expected to have 800 or more
    present at the same time, and has entry checks (payment, tickets or
    passes, or club membership or guest status).
  - [s.5](https://www.legislation.gov.uk/ukpga/2025/10/section/5): so far as
    reasonably practicable, procedures for evacuating, moving people to a
    place with less risk of physical harm, preventing entry or exit, and
    providing information.
  - s.4 (responsible person: the person in control of the premises), s.7
    (documenting, enhanced and qualifying events only), s.9 (notifying the
    SIA), s.10 (designated senior individual).
  - [s.37](https://www.legislation.gov.uk/ukpga/2025/10/section/37): Parts 1
    and 2 commence by regulations. The [Commencement No. 2 Regulations 2026
    (SI 2026/622)](https://www.legislation.gov.uk/uksi/2026/622/made) brought
    only s.12(2)–(3) (SIA guidance) and s.18(5)–(7) into force on 15 June 2026.
    The duties in ss.2–9 were not in force on the date checked.
- **Statutory guidance.** [Home Office, Terrorism (Protection of Premises) Act
  2025: statutory guidance](https://www.gov.uk/government/publications/the-terrorism-protection-of-premises-act-2025/terrorism-protection-of-premises-act-2025-statutory-guidance),
  presented 15 April 2026, page updated 25 August 2026.
  - Tiers: standard "200 to 799 individuals to be present at the same time,
    from time to time"; enhanced "800 or more".
  - Paras 4.23–4.25: use a reasonable, evidenced method for the greatest
    expected number at the busiest times, including staff. Para 4.31's
    example shows a fire-safety occupancy figure is not the test.
  - Para 7.11: the four procedures are evacuation, invacuation, lockdown and
    communication.
  - Paras 7.51–7.53: no statutory requirement for specific counter-terrorism
    training, but staff who carry out procedures must be made aware of them
    and their role; team briefings are one method.
  - Para 7.32: standard tier premises have no legal duty to document
    procedures, though the guidance says they should.
  - Para 6.5: for an event at hired premises, the responsible person is
    whoever controls the premises for the event.
  - Para 2.10: the implementation period is at least 24 months from Royal
    Assent.
- **Regulator.** [SIA, understanding Martyn's Law and the SIA's role as
  regulator](https://www.gov.uk/guidance/understanding-martyns-law-and-the-sias-role-as-regulator),
  published 17 July 2026: the Act is expected to come into force in spring
  2027, with the date to be confirmed.

### Where the research notes differed

The research notes (`docs/design/platform-2026-09-26/research/completeness.md`)
were followed where the primary sources agree. Differences:

1. The notes say "200–799 capacity". The Act's test is how many people may
   reasonably be expected to be present at the same time, from time to time,
   including staff; it is not a capacity or fire-safety occupancy figure. The
   copy follows the Act.
2. The suggested "responsible person on duty (name, role)" conflates two
   things. The Act's responsible person is the individual or organisation in
   control of the premises (often an organisation). The editor records that as
   "Responsible person" and the person leading the procedures on the day as
   "Lead on duty".
3. Door supervision and SIA licensing are not duties of this Act. The field
   records an operational arrangement only and makes no legal statement.
4. The statutory guidance page now reads "Updated 25 August 2026" (with a
   correction dated 6 August 2026); it was presented on 15 April 2026.

## Keep it current

When commencement regulations bring ss.2–9 into force, update the timing
sentence in `buildProtectedPremisesSummary` and the PDF and web tests that
quote it. If the Act or guidance changes a threshold or procedure, change
`MARTYNS_LAW_THRESHOLDS` or `PROTECTION_PROCEDURE_COPY`, re-check the copy
guard, and record the source and date here.
