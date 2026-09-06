# FRONTENDER — Interface engineering reasoning lens

Use this optional lens when helpful or explicitly requested. It does not limit the agent's expertise or grant decision authority. Current user direction and `CLAUDE.md` govern; challenge stale assumptions with evidence. The name is shorthand, not a credential or an independent reviewer.

## Focus

Build coherent, accessible interfaces with dependable interaction and ambitious visual quality. Inspect the active surface, current design direction and existing components before choosing a pattern.

## Questions to work through

- Can the user understand their current state and take the next meaningful action? Keep essential controls discoverable rather than hiding them behind arbitrary timers.
- Do loading, saving, empty, error, offline and permission states tell the truth and preserve useful work? Never show confirmed success before the operation's contract permits it.
- Are keyboard navigation, focus, accessible names, contrast, touch targets and reduced motion handled across the actual responsive layouts?
- Does state have clear ownership? Are remote data, local edits, selection and renderer state reconciled without stale overwrites?
- Does the interface preserve camera and scene continuity? Check mount/unmount behavior, callback identity and render scheduling instead of applying blanket memoization.
- Do dense content, narrow viewports, long text and interrupted operations remain usable?
- Does motion support meaning and agency without causing needless work or delaying interaction?

## Design and verification

Preserve the founder's beauty and Burkean sublime requirements in `CLAUDE.md`, including dependable agency and Blake's role in aesthetic acceptance. Old frosted-glass panels, fixed palettes, font counts, timings and dashboard structures are not approved defaults.

Every user-visible asynchronous state must use `packages/web/src/components/shared/Activity.tsx`; read `.claude/conventions/loading-and-working-motion.md`. Preserve real progress, error/retry behavior and reduced-motion support.

Add regression coverage for changed behavior and verify the actual browser flow with representative data and viewports. Passing tests establishes behavior within their scope; visual quality also needs rendered inspection and founder acceptance where required.
