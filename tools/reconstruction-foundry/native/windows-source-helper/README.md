# Windows source helper core

This crate is the first Windows-only native core for the Reconstruction Foundry
source helper. It is private, accepts no command-line arguments, and
communicates only through newline-delimited JSON on inherited standard pipes.

This checkpoint implements a launcher-pinned content-binding/liveness handshake,
strict private DOS-path validation, Windows ordinal path comparison, retained
source/output selection, request-bound combined custody, fresh run/file
creation, exact scope release, cancellation state, and close. The Windows
Common Item Dialog service owns a
dedicated COM STA, uses the exact V1 option sets, obtains selections with
`IFileOpenDialog::GetResults` and `SIGDN_FILESYSPATH`, limits selected roots to
128, and marshals dialog closure back onto the STA through a private
message-only window. User cancellation is a distinct result from dialog
failure, and path-bearing Windows errors are not retained in its error type.

The helper also exposes one visible, one-shot OLE `IDropTarget` panel for a
single atomic mixed file/folder intake. It accepts only `CF_HDROP` in
`TYMED_HGLOBAL`, negotiates only copy, bounds the batch to 128 roots, and treats
window close or Escape as native cancellation. The registration is revoked
before its helper-owned window is destroyed. While active, the small one-shot
panel is topmost so it stays exposed over Explorer, and both its parent client
surface and instruction control delegate to the same OLE target. Dropped
locators remain untrusted until the same handle-based custody checks used for
picker selections accept the complete batch; any rejected item leaves the
session unchanged.

Picker and OLE-drop paths remain untrusted locators. The process protocol
consumes them immediately in the native custody/output layer with reparse-safe
`NtCreateFile` opens, proves a direct fixed/removable local volume, retains and
revalidates identity inventories, hashes bytes read from restrictive retained
handles, and creates fresh handle-relative outputs with `FILE_CREATE`. Its
bounded read/write APIs accept cooperative cancellation checks and return hash
evidence only after their final revalidation.

The native layer now also has one request-bound combined custody type. It
acquires the restrictive output-root handle without creating a run, then
acquires every exact retained source read custody as one fail-closed unit. A
failure or cancellation during acquisition drops the output and every source
handle already acquired. Empty and nested directories participate in identity
collision checks, every discovered source directory stays restrictively open,
and run/output creation exists only on the active combined scope. A consuming
release destroys the whole scope before returning its path-free acknowledgement.
The controller-facing local-volume evidence records fixed versus removable,
the direct physical DOS-device mapping result, and the corroborated volume
serial; it never exposes a drive letter, device target, filename, or path.
Source/output overlap is rejected in both ancestry directions. If two canonical
DOS names use different drive letters for the same corroborated volume, the
scope conservatively rejects the pair because string ancestry cannot prove it
disjoint across aliases.

Any observed cancellation, source mutation, output-chain failure, identity
collision, or link-count failure makes an acquired scope terminal. The failed
condition cannot be removed and retried to obtain evidence; only consuming
release remains an operational exit. A run or file handle is adopted by the
scope immediately after `FILE_CREATE`, before its fallible identity checks and
final cancellation poll. Therefore even a post-create failure remains owned,
bounded, counted in release evidence, and closed before release is acknowledged.

Fresh output files must have exactly one hardlink at creation and at every
write, flush, and finish checkpoint. This rejects a persistent alias created in
another writable directory. A hardlink created and removed entirely between
those point-in-time checks is not observable through `FILE_STANDARD_INFO`;
excluding that transient race requires an additional verified OS policy or a
separately specified and tested oplock design.

The control plane is now wired into the process protocol and its strict Node
bridge. It exposes picker selection, retained output resolution, path
comparison, one request-bound revalidated scope, consuming release, and fresh
run/file creation. The native response includes an opaque source-file table for
future trusted data-plane binding; the bridge validates and removes that table
from the adapter DTO.

Bulk binary pipes are still absent, so `read_source_bytes`,
`write_output_bytes`, source-read finalisation, and output-write finalisation
are not protocol capabilities. A created output file therefore cannot yet be
used by the Node bridge as a production output data sink. The executable's
stdin loop is also synchronous: although the protocol engine has atomic cancel
state, the packaged process cannot read a cancel frame while a modal picker or
enumeration is in flight. `cancel` is consequently not advertised. On close or
deadline failure, the Node bridge requests cooperative shutdown and then
repeatedly terminates only the exact child until its exit is observed; an
unconfirmed exit remains fatal. Its diagnostic `close()` call preserves a
graceful-shutdown or protocol failure, while `close_and_confirm_no_live_scopes()`
reports success after the exact child exit is confirmed because Windows has
then closed every handle owned by that process. These gaps prohibit an
end-to-end native custody or production-readiness claim.

Folder custody currently binds identities and bytes, not a helper-private
identity-to-relative-path table or layout digest. Structure-dependent XGRIDS,
COLMAP, and similar projects therefore remain unsupported as semantically
preserved folder inputs even after control-plane revalidation succeeds.

The Explorer-backed Common Item Dialog is not a read-only or offline security
boundary. Windows, shell extensions, or the person using it may expose file
management commands or browse network-backed locations before final selection.
Only the later authoritative inspection layer may accept or reject a selected
locator; stronger read-only or no-network claims require a separately verified
operating-system policy.

The Rust and TypeScript path validators both reject the Windows-reserved
superscript device spellings `COM¹`–`COM³` and `LPT¹`–`LPT³`, with focused parity
tests on both sides.

## Handshake binding

The challenge response is a non-authenticating liveness/content-binding value.
The launcher authenticates packaged bytes with its own pre-launch hash check.

The response preimage is exactly:

1. 43 ASCII bytes: `OMNITWIN.WINDOWS_SOURCE_HELPER.HANDSHAKE.V1`
2. one zero byte
3. 32 bytes decoded from the lowercase hexadecimal challenge
4. one zero byte
5. 71 ASCII bytes: the exact canonical `sha256:`-prefixed helper digest
6. one zero byte
7. 37 ASCII bytes: `venviewer-windows-source-helper/0.2.0`

The response is `sha256:` followed by the lowercase hexadecimal SHA-256 of that
preimage. The shared cross-language vector is:

- challenge: `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`
- helper digest: `sha256:abababababababababababababababababababababababababababababababab`
- response: `sha256:a2d319a17c56f8755cf37077967ab50f97a6529fda17ac809e4443ffa247873a`

Work requests use an exact monotonic `sequence` beginning at 1. Parsed `cancel`
and `close` messages use a separate exact monotonic `control_sequence`
beginning at 1. The packaged serial loop cannot interleave them with active
work.

The authenticated capability list is exactly, in order: `pick_files`,
`pick_folder`, `drop_sources`, `resolve_output`, `compare_paths`, `revalidate_start`,
`release_revalidated_start`, `create_run_output`, `create_output_file`, and
`close`. It deliberately omits `cancel`, all byte-transfer operations, and all
finalisation operations until their actual process data/control planes exist.

## Reproducible private-path-free build

Release evidence must use `scripts/build-release.ps1`, not a direct Cargo build.
The script pins the cached compiler version, preserves static CRT and `/Brepro`,
and maps the source, target, Cargo, Rustup, temporary, and user roots to fixed
neutral prefixes before invoking Cargo in locked offline mode. This prevents
developer names and local source paths from entering panic and source-location
strings in the executable.

Every candidate executable must then pass
`scripts/verify-release-binary-privacy.ps1`. The scanner checks raw ASCII/UTF-8
and UTF-16LE byte sequences for the Windows user-root prefix, the current user
name, user/Cargo/Rustup roots, and caller-supplied repository or workspace
markers. A finding fails the release gate without printing the private marker.
