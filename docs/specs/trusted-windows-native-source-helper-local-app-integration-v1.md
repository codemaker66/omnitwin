# Trusted Windows native source intake: local-app integration V1

**Status:** implementation contract; not a released capability

This document defines the smallest honest path from the Windows native helper
to the Reconstruction Foundry local app. It does not permit the existing
path-based local-app intake to be described as native custody.

## Boundary

```text
browser neutral basket UI
  -> loopback local-app routes
  -> TrustedWindowsNativeSourceBasketControllerV1
  -> production TrustedWindowsNativeSourceAdapterV1
  -> authenticated helper process bridge
  -> helper-owned Windows handles and byte pipes
```

Only the controller's neutral basket view and generic action result may cross
the HTTP boundary. Canonical paths, filenames, identities, inventories,
digests, helper/session/scope references, receipts, authentication material,
and native errors remain in the trusted process or helper.

The package-level source-set module stays OS-neutral. The browser assets never
import the adapter, bridge, or helper protocol.

## Production composition

The production adapter belongs in
`tools/reconstruction-foundry/src/trusted-windows-native-source-adapter-v1.ts`.
It owns exactly one helper session for one basket session and implements
`TrustedWindowsNativeSourceAdapterV1`. `FailClosedWindowsNativeSourceAdapterV1`
remains the default on unsupported or unconfigured systems.

The adapter configuration is derived only from the exact packaged release
manifest. The helper executable path, helper digest, adapter build digest, and
receipt-authentication key are not accepted from HTTP, ordinary CLI flags, a
dragged path, or an untrusted environment variable.

## Required helper operations

The high-level adapter requires exact, request/session-bound operations for:

- `pick_files` and `pick_folder`;
- `drop_sources`, returning one exact mixed file/folder batch selected by a
  genuine helper-owned Windows OLE `CF_HDROP` target;
- `resolve_output`;
- `compare_paths`;
- `revalidate_start` and `release_revalidated_start`;
- `create_run_output` and `create_output_file`;
- `read_source_bytes` and `write_output_bytes` over bounded binary pipes;
- out-of-band `cancel` and cooperative `close`.

All helper references are opaque, have strict syntax, belong to one live
session, and cannot be replayed or reused. New operations remain unavailable
until the helper advertises them in its authenticated handshake.

`drop_sources` is one modal helper operation. The browser may request that the
panel open, but it never receives `DataTransfer`, filenames or paths and cannot
submit a path. The helper accepts Copy or None, never Move. X/Escape is a
native cancellation. `/api/stop` may terminate the exact helper while the
panel is open; the browser does not claim that it can cancel an already active
modal drop through an ordinary basket event.

## Local-app routes

Native-selection mode adds:

- `GET /api/native-source-basket`;
- `POST /api/native-source-basket/action`;
- `POST /api/native-source-basket/cancel-active`.

The action body contains only the controller-issued event binding, action, and
optional basket position. Existing loopback-host, session-token, same-origin,
exact-key, and request-size checks apply. There is no browser file input and no
typed-path field.

The ordinary basket `cancel` event cannot interrupt an in-flight modal picker,
because its one-use event is consumed before the helper settles. The dedicated
cancel route targets only the current helper work request and requires an exact
cancel acknowledgement. That acknowledgement means only that the helper
accepted the cancellation request. Cancellation is complete only after the
target work has settled as cancelled, no partial binary frame remains, all
affected custody state is terminal or released, and the bridge has joined
those facts. A late cancel after successful work completion returns a defined
non-fatal "too late" outcome; it cannot rewrite success as cancellation.

## Custody and shutdown

An ordinary rejected `openRevalidatedStartScope` call guarantees that no live
scope was created or that cleanup was already confirmed. A resolved call
transfers scope ownership to the controller. The controller runs the inspection
sink, consumes the one-use receipt, invokes the retained release function
exactly once, and requires the exact release acknowledgement.

The sole exceptional rejection is the safe, trusted-process-only code
`HELPER_TEARDOWN_UNCONFIRMED`. It means no scope transferred to the controller,
but exact helper exit and cleanup could not be confirmed. The V1 controller
must preserve that code instead of relabelling it as private-evidence mismatch,
poison and clear its private basket state, and settle its internal V0 start as
`start_uncertain`. The trusted lifecycle owner must then retry cooperative
shutdown, force only the exact child after the grace period, await confirmed
child exit, and refuse to report a safe stop until that confirmation exists.
The code and all native error detail remain outside the browser boundary.

Missing, stale, forged, failed, or mismatched release acknowledgement is
terminal `start_uncertain`. It takes precedence over an earlier evidence error.

`/api/stop`, session expiry, programmatic shutdown, picker timeout, and process
error all close active scopes, request helper shutdown, force only the exact
child if the grace period expires, and await confirmed child exit before the
app reports a safe stop. No partial selection, inventory, receipt, or output is
published.

An unconfirmed teardown attempt does not permanently destroy the exact-child
exit observer. Each later lifecycle-owner retry receives a fresh bounded wait
and may prove a child exit that arrived after the earlier deadline. The caller
whose deadline expired still receives `HELPER_TEARDOWN_UNCONFIRMED`; a later
confirmed retry may then complete cleanup honestly.

## Existing path-based mode

The existing `local-app --source` flow reopens a pathname in Node and exposes a
source label and receipt-relative filenames to the browser. It remains a
separate legacy/local inspection mode. It is not native custody and is not an
acceptable implementation of this contract.

## Implemented native-selection / Node path-reopen preview

The current T-542 preview is narrower than the retained-handle custody design
above. Windows picker and OLE drop selection remain process-owned and the
browser stays path-free, but Node reopens the selected canonical paths for
inspection and T-541 local copying. Its exact public truth boundary is:

- mode `ordinary_windows_native_selection_node_path_reopen_preview`;
- filesystem model `node_path_reopen_after_native_selection`;
- `nativeCustodyClaimed: false` and `authority: none`;
- one T-541 child workspace per selected root plus one durable collection
  index;
- a successful mixed drop is one browser-list update, while any later
  admission conflict terminally fails the preview session and requires exact
  helper teardown. This is browser-list atomicity, not a claim that a rejected
  provisional adapter result can be rolled back inside an otherwise reusable
  helper session.

The preview therefore proves genuine Windows drop selection followed by local
path reopen only. It does not prove retained native byte custody, rights,
registration, reconstruction, training, enhancement, cloud handoff, signing,
publication or release.

## Smallest end-to-end acceptance fixture

On Windows, use two tiny regular source files and a separate empty output
directory. The exact packaged helper must:

1. select both files through the production Common Item Dialog;
2. expose only `File 1`, `File 2`, kinds, counts, and generic messages to the
   captured browser traffic;
3. retain and freshly revalidate both sources plus the output root;
4. read the exact source bytes through the helper-owned binary pipe;
5. create one fresh run directory and output file with handle-relative
   `FILE_CREATE` semantics;
6. consume the exact receipt and release the exact custody scope once;
7. stop with no helper process remaining.

Every captured HTML/JSON/network body is scanned for both fixture basenames,
absolute paths, file IDs, volume serials, helper/session/scope references,
adapter identifiers/digests, source/manifest digests, receipts/HMACs, and native
errors. Any finding fails the acceptance test.

The next mandatory adversarial fixture races rename, reparse, mutation,
hardlink, output collision, cancellation, timeout, and helper failure. A new
Windows release remains prohibited until both fixtures pass against the exact
packaged bytes.
