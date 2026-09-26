**Read this when:** planning or reviewing any surface rebuild, design-system change or platform capability under T-635.

# Venviewer platform audit and design programme — 26 September 2026 (T-635)

Blake asked for the design preferences behind the Enquiries desk to reach every aspect of the app, guided by his supreme principle: **make everyone's life easier**. The principle is recorded verbatim in [the product experience brief](../../../.claude/conventions/product-experience.md), which governs everything here.

## What was done

This was a read-only workflow of 20 agents:
- 12 surface audits, one per area of the app;
- a live screenshot sweep of 46 views against a mocked API;
- 4 research reports: competitors, venue workflows, the psychology of all-day tools, and premium craft;
- a design-system synthesis and a roadmap synthesis;
- a completeness critique.

Nothing in the product changed. Conformance scores are the auditors' judgements, not Blake's; he remains the aesthetic judge.

## The documents, and which one wins

| Document | What it is |
| --- | --- |
| [critique.md](critique.md) | Corrections to the two syntheses. **Where it conflicts with them, the critique wins.** |
| [design-system.md](design-system.md) | The proposed single design system: principles, tokens, components, patterns and migration. A draft proposal. |
| [roadmap.md](roadmap.md) | Where every surface stands, the rebuild order (Now / Next / Later), platform capabilities, and questions only Blake can answer. |
| [research/](research/) | The four research reports with their sources. Some competitor quotes came from search summaries because review sites were blocked; treat those as leads. |
| [audits.json](audits.json) | Raw findings per surface, with file and line citations. |
| [sweep/](sweep/) | Screenshots of the app as it stood before this programme, captured against mocked data: the "before" set. |

Blake's answers and the brief outrank all of these.

Four corrections from the critique apply now:
- **Overridable defaults, not laws:** "one accent", "one hero image per view", "no glass or blur in the content layer" and "motion only for state change". None of them is linted. Blake's brief says such prescriptions must not narrow his ambition.
- **Cyan focus ring:** it measures **1.22:1 on ivory** (1.43:1 on white), not 1.4:1.
- **Existing tokens and chips:** the House semantic tokens (`packages/web/src/styles/house-tokens.css`), the shared `packages/types/src/design-tokens.ts` and the EvidenceChip grammar must be reconciled, not bypassed.
- **Unaudited surfaces:** the emails, PDFs and link previews clients receive were never audited. The approve email opens "Great news!", against the brief.

## Founder decisions so far (26 September)

- **Style reach:** staff tools plus everything clients receive or work in. Public marketing keeps its own voice in the same family.
- **Hover bounce:** remove it everywhere.
- **What we replace:** Salesforce, Cvent, venue sales-and-catering software, and email, spreadsheets and paper.
- **Next surfaces:** the Diary with holds, then hallkeeper and event day.

## Order of work

Following the roadmap as corrected by the critique:
1. **N1 — calm foundation, first.** Global hover, cursor and scrollbar; focus rings; register tokens; canvas; type; component kit.
2. **N5 — truth and safety sweep, alongside everything.** Screens that say something untrue or hide a consequence; this includes the client emails.
3. **Then, in parallel:** N2 shell and navigation, N3 Diary and holds, N4 hallkeeper and event day, and N6 desk hand-offs.

Each rebuild gets its own design record, committed baselines and Blake's verdict.
