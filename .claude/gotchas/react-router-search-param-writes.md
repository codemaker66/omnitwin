**Read this when:** writing a URL search param with React Router, above all where
two hooks share one address or a write runs from a timer, frame loop or effect.

# setSearchParams builds on its render, not on the address

`setSearchParams(fn)` hands `fn` the params of the render that created that
`setSearchParams`, and React Router's documentation says so: "Multiple calls to
`setSearchParams` in the same tick will not build on the prior value."
Navigations also render inside a transition, so a render can lag the address it
is writing to. Each of these undid a step in the twin (found on 18 October 2026):

- One handler, two writes. A dive from the dollhouse wrote `?node=` and then
  `?mode=` from the same copy, which still named the old node, so the walk
  snapped back to the room the visitor had left.
- A callback that outlives its render. A hop lands from a frame loop started
  0.65 s earlier and wrote the address as it was then, dropping a `?mode=` the
  visitor chose during the glide.
- A write behind a pending render. A teleport made while the dollhouse render
  was still pending wrote the address without its new mode.

Mocked tests rarely show it: each write is right on its own, and a test that
makes two writes passes or fails on React's scheduling.

Use `useLiveSearchParams()` from `packages/web/src/hooks/use-live-search-params.ts`.
`latest()` copies the address as the router holds it when called, including
navigations not yet rendered, and `write()` navigates to the result. It skips a
write that changes nothing, and any write once the router has moved to another
page, where it would pull the visitor back to the page they are leaving:

```ts
const params = latest();
params.set("node", id);
write(params, { replace: true });
```

Decide anything that depends on the current value from `latest()`, not from
the render: whether a mode change crosses the dollhouse and pushes history, for
one. `useTwinWalk` and `useTwinMode` work this way, and `useTwinWalk.test.ts`
reproduces each case above on a data router, with the handler holding the
functions of the last committed render as a real click handler does. A page
with one writer, writing once per event, can keep `setSearchParams`.
