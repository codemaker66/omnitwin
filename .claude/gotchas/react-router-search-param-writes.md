**Read this when:** writing a URL search param with React Router, above all where
two hooks share one address or a write runs from a timer, frame loop or effect.

# setSearchParams builds on its render, not on the address

`setSearchParams(fn)` hands `fn` the params of the render that created that
setter, and React Router's documentation says so: "Multiple calls to
`setSearchParams` in the same tick will not build on the prior value."
Navigations also render inside a transition, so a render can lag the address it
writes to. In the tour, where the walk writes `?node=` and the mode writes
`?mode=`, this undid the visitor's steps:

- One handler, two writes. A dive from the dollhouse wrote `?node=` and then
  `?mode=` from the same copy, which still named the old node, so the walk
  landed in the room the visitor had left.
- A callback that outlives its render. A hop lands from a frame loop started
  when the glide began, and wrote the address as it was then, dropping a
  `?mode=` chosen during the glide.
- A write behind a pending render. A teleport made while the dollhouse render
  was still pending wrote the address without its new mode.

Mocked tests rarely show it: each write is right on its own, and a test that
makes two writes passes or fails on React's scheduling. (Found on 18 October
2026 by running the web suite with React's scheduler delayed, and fixed on
master on 26 October by T-674.)

The tour's fix is `useTwinSearchParams()` in
`packages/web/src/twin/twin-search-params.ts`. Each edit reads the address the
router holds at that moment (a data router's state, or the place a pending
navigation is going; a declarative router's history), decides from it whether
to write and whether to push or replace, changes only its own keys, and writes
nothing once the visitor has left the page. `twin-url-writes.test.tsx` holds
each case above, with the handler keeping the functions of an older render as
a real one does. A page with more than one writer, or with writes from timers,
loops or effects, needs the same read; a page with one writer, writing once per
event, can keep `setSearchParams`.
