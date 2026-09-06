# Editor save lifecycle — isolated local fix, 6 September 2026

Prepared on `codex/editor-save-lifecycle`, starting from `b7724403`, in
`D:/claude/venviewer-save-lifecycle-20260906`. This is a T-596 demo qualification
slice. It is not deployed or browser-qualified; the parent task owns integration
and the real browser rehearsal. No API, fixture, production record or external
delivery was changed.

## Result

- The newest configuration load owns its response. Saves and room reads belong
  to the committed editor session, so A → B → A does not revive an old request.
  Successful load/create clears the prior session's busy/error/conflict state;
  failed navigation preserves the existing session and recoverable local work.
- Late saves cannot change another session's revision, objects, ID mapping,
  selection, undo history, action log or saved feedback. B can save while A's
  older request is still outstanding. An older same-configuration GET cannot
  roll back a revision already acknowledged by a save.
- A superseded public creation remains in the existing bounded recovery list,
  but does not open the created draft or return a successful navigation result.
- The toolbox derives its status directly from the store; its two-second saved
  flash no longer hides a newer edit. The reference header offers **Reload
  layout** for conflicts and checks the live phase-preview lock before acting.
- Save-to-enquiry preparation and its modal-opening continuations retain the
  original editor session across flush, capture and thumbnail upload. Switching
  sessions cancels preparation, including A → B → A. Thumbnail transport failure
  remains best-effort only for the same session. No enquiry was sent in tests.

## Evidence

Receipts are retained in the isolated worktree, outside the committed source:

- `ownership-baseline-red-expanded.json`: 15 failures / 23 tests before the
  original request-ownership and flash repairs.
- `ownership-review-baseline-red.json`: the stale same-config GET and conflict
  recovery action each failed before their fixes.
- `send-baseline-red.json`: six session-boundary failures / seven tests before
  the send-preparation fix.
- `final-regressions-corrected.json`: 205/205 focused tests passed, covering
  deferred responses, public/auth routing, local recovery, in-flight edits,
  history and ID remapping, action-log behavior, save status and phase locks.
- Web and E2E TypeScript checks passed. Vite test-mode build passed. Scoped
  ESLint passed (`lint-final.log`), and the final test-only lint cleanup was
  rechecked with 36/36 passing tests (`test-cleanup-verification.json`). No
  production build or deployment is implied.

The first broad run also retained two failed source-spelling checks. One already
failed on `b7724403` because `SaveSendPanel` gained an `embedded` prop; the test now
preserves its actual avoidance binding while allowing additional props. The other
asserted the old exact guard expression; executed deferred save/preview/session
tests replace that expression check. Failed receipts were not deleted.

Independent read-only review by the training-review lane found no remaining
material issue in this scope after the lower-revision and live-preview corrections.

## Limits

Requests already accepted by the server are not rolled back when navigation
changes. The fix withdraws their authority over the current editor and prevents
stale continuation. Existing optimistic revision conflicts remain explicit; no
cross-session merge or silent overwrite is introduced. Real browser qualification
and integration with the separately owned drag-history fix remain pending.
