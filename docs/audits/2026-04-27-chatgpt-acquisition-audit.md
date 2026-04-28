# Acquisition-Readiness Audit — ChatGPT, 2026-04-27

Source: ChatGPT analysis of Venviewer codebase against
acquisition-readiness standards. Triggered by the user under
the S+ tier operating principle.

Findings landed as backlog tasks T-080 through T-099 in
`docs/state/tasks.md`. See those for tracking.

## Severity histogram

- **P0**: 8 findings (F-001, F-002, F-003, F-004, F-007, F-008,
  F-010, F-015)
- **P1**: 11 findings (F-005, F-006, F-009, F-011, F-012, F-013,
  F-014, F-016, F-017, F-018, F-019)

## Synthesis

> "The gap to WOW is evidence. The codebase has real engineering
> momentum, but its public claims are ahead of the implemented
> system: the renderer is procedural, the splat pipeline is not
> proven, the revenue funnel is a stub, the browser E2E suite is
> red, and the operational/security controls are not
> diligence-ready. Close the gap by narrowing claims to what
> exists, making CI green, proving one captured venue end-to-end
> with measurable visual quality, and turning ops/security from
> docs into exercised systems."

## Estimated remediation

70–110 person-days for the P0/P1 set, excluding SOC 2 Type II
formal audit time.

## User caveats accepted

- **F-012 framing.** ChatGPT framed the brief as "publicly served
  static content," which is technically correct but overstated
  for a brief deployed with `noindex` meta tags and `robots.txt`
  blocking, at an unguessable URL, for a single in-person
  meeting. The secondary critique — that the brief makes claims
  (Black Label, independent scoring) not yet evidenced — is
  accepted and tracked in T-097.

## Full audit text

[Full audit text — paste here]
