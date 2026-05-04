# Internal Engine Naming: venkernel, venreplay, venlight

Status: Active planning note  
Date: 2026-05-01  
Source: ENGINE-NAMING-001  
Depends on: Layout Proof Object, Guest Flow Replay, Lighting Context Package  
Relates to: Deterministic Validator Kernel, `.venreplay.zip`, Operational Geometry Compiler, Planning Evidence Disclosure, License & IP Compliance Ledger

## Purpose

Venviewer now has several reusable internal engine boundaries. Concise internal names make architecture discussion easier, but names must not create package churn or public-brand confusion.

This note defines three internal subsystem names:

- `venkernel` = deterministic validator kernel
- `venreplay` = guest/crowd flow replay system
- `venlight` = lighting context package / inserted-object lighting system

These names are internal architecture shorthand only. They are not public product names and are not package names yet.

## Naming Rules

- Public product/company language remains Venviewer.
- Internal repository/package scopes remain `omnitwin` / `@omnitwin/*` until an explicit rename plan exists.
- `venkernel`, `venreplay`, and `venlight` may be used in architecture discussion, task names, planning notes, and future package-boundary reviews.
- Do not create packages, folders, imports, CLI names, product copy, URLs, or customer-facing labels from these names without a separate ADR/task.
- Package creation requires a package-boundary review and explicit implementation task.
- Existing docs should not be mechanically renamed. Use the names where they clarify subsystem boundaries.

## Subsystem Names

| Internal name | Meaning | Current doctrine boundary | Not yet |
|---|---|---|---|
| `venkernel` | Deterministic validator kernel for machine-checkable planning/evidence checks. | Layout Proof Object, Scotland Policy Bundle, Review Gate Engine, Planning Evidence Disclosure. | Not a package, service, CLI, or public validator product. |
| `venreplay` | Guest/crowd flow replay system, including scenario templates/instances, replay bundles, trajectory playback, flow metrics, and replay evidence. | Crowd Simulation Replay Bundle, `.venreplay.zip`, Flow Zone Authoring Layer, Operational Geometry Compiler. | Not a full simulator implementation or package yet. |
| `venlight` | Lighting context / inserted-object lighting system for zone-aware probes, cubemaps, influence volumes, and object insertion lighting. | Lighting Context Package, Probe Leakage Guard, Residual Radiance fallback/object insertion doctrine. | Not a renderer package, shader system, or WebGPU dependency yet. |

## Package Boundary Review Requirement

Before any of these become packages, the review should answer:

- What problem requires a package boundary rather than a module folder?
- Which package owns types, runtime logic, tests, fixtures, and docs?
- Does the package run in browser, server, offline tooling, or all three?
- What dependencies would it introduce?
- Does it need separate licensing/IP review?
- How does it interact with `@omnitwin/types`, API routes, web runtime, training tools, and artifact manifests?
- What public/product language is forbidden?
- What tests prove the boundary is useful?

## Non-Goals

- No package creation.
- No package rename.
- No import changes.
- No runtime code.
- No public copy change.
- No CLI/service naming.
- No broad terminology rewrite.
