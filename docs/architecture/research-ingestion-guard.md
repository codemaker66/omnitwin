# Research Ingestion Guard

Status: Active planning doctrine  
Date: 2026-05-01  
Source: RIG-001  
Depends on: Claim-Aware Copy Guard, Exposure Tier, Venue Data Request Pack, Calibrated Reliance Principle  
Relates to: architecture research incorporation, public claims, venue onboarding

## Purpose

The Research Ingestion Guard separates transferable methodology from unverified venue facts.

Venviewer can adopt methods, taxonomies, failure modes, and architectural patterns from research reports before every venue-specific factual statement has been verified. It must not import unverified venue facts into product docs, public copy, partner briefs, policy bundles, evidence packs, or operational claims.

This doctrine is planning only. It does not implement scanners, public copy changes, runtime behavior, dependencies, or package renames.

## Core Rule

Methodology may be adopted. Venue facts must be verified.

Examples of transferable methodology:

- data sufficiency outcomes
- review gate patterns
- route validation vs route finding boundary
- probe leakage guard
- multi-seed simulation summaries
- photometric chain-of-custody
- residual disable testing

Examples of venue facts requiring verification:

- named venue capacities
- door widths
- stair/lift/ramp dimensions
- fire strategy details
- licensing terms
- heritage protected surfaces
- supplier routes
- room names and jurisdiction-specific policy facts

## Ingestion Classification

Every research-derived item should be classified as:

- `transferable_methodology`: safe to incorporate into doctrine after technical review.
- `unverified_venue_fact`: may be tracked internally but cannot support evidence, copy, or policy until verified.
- `rejected_wrong_venue_fact`: explicitly not applicable to the current venue.
- `verified_venue_fact`: accepted through Venue Data Request Pack, source review, or another documented evidence path.

## Trades Hall Glasgow Guardrail

Facts about Australian Trades Hall venues, Solidarity Hall, or any other similarly named venue must not be applied to Trades Hall Glasgow.

Name similarity is not evidence. If a report references a different Trades Hall, that fact is `rejected_wrong_venue_fact` for Trades Hall Glasgow unless a separate verified source proves the same fact applies.

## Documentation Rules

- Architecture docs may cite research methodology when clearly marked as methodology.
- Venue-specific docs must cite verified venue sources before carrying operational facts.
- Public copy must not use research-derived venue facts unless Claim-Aware Copy Guard and Exposure Tier checks pass.
- Policy bundles and Layout Evidence Packs must cite Venue Data Request Pack fields, verified documents, or explicit assumptions for venue facts.
- Research reports can remain archived even if their venue facts are rejected; rejection applies to ingestion, not archival preservation.

## Non-Goals

- No research ingestion automation.
- No public copy rewrite.
- No route guard implementation.
- No database schema.
- No package rename.
