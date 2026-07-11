# Proposal — the Constellation view (owner-register calendar skin)

Status: PROPOSAL ONLY (per Canon authority rule). Not scheduled. For architect review after Diary P2.
Author: Claude (Cowork), 11 Jul 2026. Fits Canon §8/§12; evidence per R4.

## What it is

A display mode over the *existing* `GET /calendar` read model: the venue's year rendered as a night sky. Confirmed (ink) dates burn gold; holds flicker amber with their decision-date countdowns; empty dates glow faint violet — unsold inventory made emotionally visible. Drag an enquiry from the holding tray onto a dark night to test the fit; conflict arcs appear between dates sharing crews or flips. Optional yield overlay: hot/cold bands (Canon §5) as constellation brightness.

## Where it fits per the Hallkeeper Test (Canon §18)

It fails the Hallkeeper Test as an operating surface — a rushed hallkeeper cannot extract room/state/time from a starfield in under a second, and R4's evidence is unambiguous that rooms-as-lanes is the operational winner. Therefore this is **not** the Board and never replaces it. It is an **owner/director register**: the emotional instrument for "how full is my year, where is money dying," used in monthly reviews and sales conversations, reachable as a view toggle next to yield heat (P3 territory). Same data, zero new domain objects, no write paths beyond what the Board already has.

## Cost honesty

A rendering skin + drag adapter over existing entries and conflicts; no schema, no new state machines. Estimated one to two build cards after Diary P2 ships. Risk: pure delight-layer scope creep — it must never be scheduled before the Board, Day Sheet, and hold hygiene are excellent.

## Decision requested

Park until Diary P2 completes, then re-assess against real owner usage of the Board. If directors already get what they need from lanes + footer counts + Monday briefing, this stays parked indefinitely.
