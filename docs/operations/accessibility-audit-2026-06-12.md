# Accessibility Audit

Date: 2026-06-12
Status: hardening audit, codebase-local
Scope: landing, planner, dashboard, proposal client page, hallkeeper, event-day mobile

This audit records the current accessibility posture and test coverage added during SS++ hardening. It does not replace a manual WCAG audit on production hardware.

## Route Findings

| Route | Current posture | Follow-up |
|---|---|---|
| Landing `/` | Semantic hero CTA, room picker label, responsive no-overflow E2E coverage. | Keep keyboard CTA regression. |
| Planner `/plan` | Canvas route has visible chrome, loading/error states, no-overflow mobile tests, and performance smoke. | Manual screen-reader pass still needed for dense planner controls. |
| Dashboard `/dashboard` | Sidebar buttons are keyboard-focusable; analytics view has loading/error/empty states. | Add a fuller keyboard workflow once dashboard forms stabilize. |
| Proposal `/proposal/:shareCode` | Client-safe page has loading, unavailable, status, quote, response, and error states. | Add manual screen-reader review of quote table and response form. |
| Hallkeeper `/hallkeeper/:configId` | Checkbox rows expose ARIA checked state; existing E2E covers keyboard-relevant control state. | Manual tablet review with venue staff still needed. |
| Event-day `/ops/events/:eventId` | Mobile-first structure, large controls, focus-visible styling, loading/error/empty/sync states. | Manual phone review under time pressure still needed. |

## Regression Coverage

- Playwright hardening spec captures deterministic screenshots for `/plan`, `/dev/trades-hall-visual`, landing room showcase, client proposal, and dashboard analytics.
- Keyboard checks cover landing CTA focus and event-day task status activation.
- Existing Hallkeeper tests cover checkbox ARIA state and route protection.

## Remaining Manual Checks

- NVDA or VoiceOver pass for planner controls and modal focus order.
- iPhone and iPad touch target pass for event-day operations.
- Keyboard-only proposal response flow on the deployed domain.
- Reduced-motion review of 3D planner, Trades Hall visual route, and event-day sync spinner.
- Contrast pass after final brand tokens are frozen.
