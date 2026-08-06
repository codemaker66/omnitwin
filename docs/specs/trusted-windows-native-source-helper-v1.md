# Trusted Windows source helper V1

Status: implementation contract; no released helper exists yet.

## Plain-language purpose

This helper gives the Foundry app a normal Windows file picker without asking a
web page to know or type private file locations. When a person chooses a file or
folder, the helper opens it immediately, checks what Windows says it really is,
and keeps the trusted root handle open until the source-basket session ends.

The helper's own source-inspection code requests read access only. It does not
upload, publish, approve, train, or reconstruct anything. Its evidence describes
a bounded point-in-time check; it is not proof that a file can never change
later.

The standard Windows Common Item Dialog is Explorer-backed. Windows, shell
extensions, or the person using the dialog may expose file-management commands
or browse a network-backed location before the helper rejects the final choice.
The dialog flags below do not make that user interface read-only or prove that
it stayed offline. A release may claim those stronger properties only when an
operating-system sandbox/firewall policy enforces them, or when a separately
verified custom picker removes those capabilities.

## Chosen implementation

- Separate x64 Windows process written in Rust.
- Pinned Rust and Cargo toolchain plus pinned `windows`, `serde`, and
  `serde_json` dependencies.
- Locked, offline, static-CRT release build.
- Two clean builds must produce byte-identical executables.
- The executable SHA-256, exact source graph, dependency inventory, and license
  files are release-manifest inputs.
- The Node launcher uses inherited standard-input/output for bounded control
  messages and separate inherited pipes for bounded bulk-byte streaming. The
  helper does not listen on a network socket.

A Node native add-on is deliberately not used. Keeping the Windows code in a
separate process gives it process/crash isolation, lets the launcher terminate
it as one unit, and prevents native-memory faults from corrupting the local web
app process. By default it still has the same user token and authority as the
launcher; a smaller privilege boundary exists only if an exact tested restricted
token, AppContainer, ACL, or firewall policy enforces one.

## Required Windows mechanisms

The helper must use the operating-system APIs below, not language-level path
guesses:

- `IFileOpenDialog` and `IFileOpenDialog::GetResults` for file and folder
  selection.
- `NtCreateFile` with `OBJECT_ATTRIBUTES.OBJ_DONT_REPARSE` for the authoritative
  opened handle and every handle-relative descendant open. Any reparse point
  encountered in the open chain must fail with
  `STATUS_REPARSE_POINT_ENCOUNTERED`.
- `CreateFileW` is permitted only for bounded supporting checks. Directory
  handles use `FILE_FLAG_BACKUP_SEMANTICS`; final-component reparse inspection
  uses `FILE_FLAG_OPEN_REPARSE_POINT` where appropriate. That flag alone is not
  accepted as proof of a reparse-free ancestor chain.
- `GetFinalPathNameByHandleW` for the final resolved DOS path.
- `GetFileInformationByHandleEx(FileIdInfo)` for the volume serial number and
  128-bit file ID.
- `GetFileInformationByHandleEx(FileAttributeTagInfo)` for reparse evidence.
- `GetFileInformationByHandleEx(FileStandardInfo)` for regular-file and size
  evidence.
- `GetFileType` must report `FILE_TYPE_DISK`; a file inventory member must also
  have `FileStandardInfo.Directory == FALSE` and no reparse attribute/tag.
- `GetVolumePathNameW` and `GetDriveTypeW` must establish a local fixed or
  removable volume. `QueryDosDeviceW` must also resolve the drive-letter mapping;
  DOS-device alias chains, `SUBST` targets, UNC redirectors, and network-device
  targets are rejected, and the result is corroborated with the opened handle's
  volume identity. A drive letter plus `GetDriveTypeW` alone is not accepted as
  proof of a direct local volume.
- `CompareStringOrdinal(..., TRUE)` for case-insensitive ordinal path
  comparison.
- The parent retains direct process-termination control over the exact child and
  forcibly terminates it after the shutdown grace period. The helper's own
  non-dialog code must never start another process, worker executable, shell,
  browser, or network client. The Explorer-backed Common Item Dialog and loaded
  shell providers are outside that code-level guarantee, so a true no-network
  claim also requires an operating-system network boundary. A self-owned Job
  Object is not used because it gives the parent no additional teardown
  authority.

## Trust boundary

The path returned by the Windows picker is only an untrusted locator. The
helper must immediately:

1. reject UNC, device, volume-GUID-only, and non-drive-letter locations;
2. open the selected item without write access;
3. make the opened handle, not the picker text, authoritative;
4. derive the final path and file identity from that handle;
5. inspect every path component and discovered entry for reparse points;
6. reject non-regular files and unsupported entries;
7. retain the selected root and output handles until the helper-owned byte
   custody operation has completed, or until cancel, failure, or launcher
   termination.

For a folder, the helper records the complete regular-file identity inventory.
Immediately before handoff it enumerates the folder again and requires the same
root identity, file-identity set, file count, and total byte count. A changed
set is rejected and produces no trusted start input.

That identity inventory does **not** by itself preserve relative filenames or
directory layout. Structure-dependent inputs such as XGRIDS, COLMAP, and other
multi-file projects also need a helper-private identity-to-relative-path table
and a stable layout digest, retained and rechecked inside custody. Those names
must never be sent to the browser. Until that extension is implemented, folder
custody can prove which bytes were read but cannot claim to preserve a raw
project's meaningful on-disk structure.

This recheck reduces race risk but does not create an atomic filesystem
snapshot, even while the root directory handle remains open. File systems can
reuse identifiers over time, and a writable file can change in place. The later
byte-inspection pass must therefore open and hash each file again, compare
beginning and ending metadata, re-enumerate the source, and fail if it observes
a change. Accepted V1 evidence reports that the reparse count was zero; it does
not publish an auditable per-component traversal transcript.

### Handle custody

A Windows `HANDLE` is meaningful only inside a process unless it is explicitly
duplicated into another process. JSON cannot transfer one. Therefore V1 uses a
helper-owned custody model: the Rust helper performs every trusted source-byte
read/hash and every trusted output create/write while its authoritative handles
remain open. The Node controller may address private items only by opaque,
session-bound references and must not reopen an emitted path and call that a
trusted read.

Bulk bytes use separate inherited, bounded, back-pressured binary pipes; they
are not embedded in JSON. Any future external reconstruction worker must either
consume bytes through those pipes or use a separately specified and tested
`DuplicateHandle` custody protocol. Until one of those paths is implemented end
to end, retained handles do not justify a claim that a Node callback or worker
consumed the same file identity.

## Process protocol

The protocol is newline-delimited UTF-8 JSON. Every message is a strict plain
object: no unknown fields, duplicate JSON object names, non-integer numbers,
unbounded strings, or messages above the fixed byte cap are accepted.

### Handshake

The launcher first hashes the exact packaged helper bytes and compares that
digest with the release manifest. It then creates the helper with inherited
anonymous pipes and sends one private handshake containing:

- protocol schema version;
- opaque session reference;
- 32-byte random challenge;
- exact helper executable SHA-256 expected by the release manifest.

The helper returns its schema version, process architecture, build identifier,
self-observed image SHA-256, and a response bound to the challenge. The launcher
checks all of them before any picker is shown. The parent-side pre-launch hash
is the content binding; a helper's self-reported hash cannot authenticate the
helper because substituted code could lie. In a writable unsigned release
folder, hashing one open handle and later starting a pathname do not prove that
Windows executed the same file. The challenge cannot fix that because
substituted code can echo expected values. A release described as trusted must
use either a protected/signed installation with verified signature and policy,
or a native race-resistant launch that holds the verified image without
write/delete sharing across process creation. The current Node-only pathname
launch is a content-checking checkpoint, not that final authenticity boundary.
None of this handshake is sent to the browser.

### Operations

The only accepted operations are:

- `pick_files`: show a multi-select file dialog and inspect each chosen file;
- `pick_folder`: show a single-folder dialog and inspect the complete tree;
- `drop_sources`: create one helper-owned, topmost Windows OLE drop panel,
  accept exactly one `CF_HDROP` / `TYMED_HGLOBAL` gesture containing a mixed
  batch of files and folders, negotiate `DROPEFFECT_COPY` or `NONE` (never
  `MOVE`), and inspect the complete batch before returning one response. The
  parent window and its visible instruction surface are both registered with
  the same `IDropTarget`, so the panel has no visual hit-test hole. Escape or
  closing the panel cancels without returning a partial batch;
- `resolve_output`: show or validate one existing output root, open it, and
  inspect its root-to-folder boundary;
- `create_run_output`: while an exact custody scope is active, create beneath
  its retained output-root handle a fresh random run directory with
  handle-relative `NtCreateFile(FILE_CREATE)` semantics, bind the retained
  handle to that scope, and return only an opaque run reference. Every
  collision fails; an existing directory is never reused;
- `create_output_file`: create each output handle-relatively beneath the fresh
  run directory with `FILE_CREATE`/`CREATE_NEW` semantics. Existing entries are
  never opened, overwritten, or truncated. This prevents a pre-existing or
  racing hardlink from turning an output write into a source-file mutation;
- `read_source_bytes` and `write_output_bytes`: transfer bounded chunks through
  the dedicated binary pipes while the helper remains the handle custodian;
- `compare_paths`: compare two already-canonical private paths using
  `CompareStringOrdinal` and return only same, ancestor, descendant, or
  disjoint;
- `revalidate_start`: recheck the exact retained source set and selected output
  root immediately before helper-owned byte custody begins, retain those exact
  handles, and return an opaque one-use custody-scope reference. It does not
  create or reuse a run directory;
- `release_revalidated_start`: close the exact request/session-bound custody
  scope, including every source, output-root, run-directory, and output-file
  handle owned by that scope, clear its opaque references, and return an exact
  release acknowledgement. A missing, stale, replayed, or mismatched release
  acknowledgement is terminal `start_uncertain`;
- `cancel`: an out-of-band control message read on a dedicated protocol thread.
  It sets an atomic enumeration cancellation flag and asks the picker STA to
  call `IFileDialog::Close(HRESULT_FROM_WIN32(ERROR_CANCELLED))`;
- `close`: close all handles, clear private session material, and exit.

### Private binary data plane

The helper inherits two additional, direction-named pipes. Their direction is
part of the protocol and must not be inferred from ambiguous words such as
"input" or "output":

- child descriptor 3 is `node_to_helper_output_frames`;
- child descriptor 4 is `helper_to_node_source_and_catalog_frames`.

The parent and helper must prove that both inherited endpoints are distinct
pipes before the handshake may advertise any byte-transfer capability. On
Windows the launcher creates these two slots with Node's `overlapped` stdio
mode so the child handles carry `FILE_FLAG_OVERLAPPED`. The helper converts the
C-runtime descriptors with `_get_osfhandle`, validates `FILE_TYPE_PIPE`, and
uses one operation-specific `OVERLAPPED` plus manual-reset event per pending
read or write. Cancellation calls `CancelIoEx` for that exact operation and
then observes its final completion before the buffer or `OVERLAPPED` storage is
released. A cancellation request may race with normal completion, so the
cancellation generation is checked again after every completed I/O.

A partial header, partial payload, unexpected end of pipe, unsolicited frame, or
stream error is terminal for the session. Neither side scans ahead for another
magic marker after framing has been lost.

Every `VNSDP01` frame has a fixed 160-byte header, a payload of at most 1 MiB,
and an SHA-256 over that frame's payload. The header binds the frame to the
exact kind, work sequence, chunk sequence, session, request, custody scope,
container, object, and one-use transfer reference. Chunk sequence is an
unsigned 32-bit integer starting at 1 for each object and increasing by exactly
one. Objects are contiguous within a transfer: the sender may switch objects
only after the current object's terminal frame and may never return to a
completed object. Duplicate, skipped, decreasing, zero, reordered, wrong-
binding, duplicate-terminal, and post-terminal frames fail closed.

A zero-length non-terminal frame is invalid because it permits an unbounded
no-progress stream. An empty object is represented by exactly one frame with
chunk sequence 1, an empty payload, and the terminal flag. A non-empty object
uses positive-length payloads and its last positive-length frame carries the
terminal flag.

Frame kind 1 carries source bytes, kind 2 carries output bytes, and kind 3
carries a private binary source catalogue. A source-set read uses one work
request and one transfer reference for the complete selected source set, not
one request per file or chunk. Source objects are emitted in the deterministic
catalogue order; chunk sequence restarts at 1 for each source-file object.

The catalogue is not JSON. It carries each owning source reference, a private
catalogue reference, file and directory records (including empty directories),
native identity, expected file size, generated source-file reference, and exact
length-prefixed raw UTF-16 path components. It preserves unpaired UTF-16 code
units and stays within the existing 80 MiB private-layout bound. Catalogue
names, identities, references, digests, and bytes never cross the browser
boundary.

A frame payload hash detects accidental or hostile corruption on the exact
inherited endpoint; it is not sender authentication. Trust in the sender still
depends on exact endpoint inheritance and the executable-authenticity boundary
above. Each successful control response additionally binds the complete
transfer's decimal byte count and SHA-256. Success settles only after the
receiver has observed all valid terminal frames and matching final control
evidence, regardless of which pipe becomes readable first.

Source bytes remain staged and untrusted until every frame, complete-transfer
count and digest, and final helper revalidation agree. The helper independently
hashes output bytes, enforces a trusted total-byte ceiling before each write,
and calls the existing output finalization check. Cancellation, malformed
framing, pipe failure, binding/count/digest disagreement, or helper failure
poisons the affected scope or run. A partial output file is never registered,
published, or described as valid.

`FILE_CREATE` prevents an existing target entry—including an existing
hardlink—from being opened or truncated. The helper also requires a fresh
output file's link count to begin and finish at one, which detects a persistent
outside alias. That check cannot prove that another local process did not add
and remove an alias entirely between checkpoints. Excluding that stronger
reverse-hardlink race requires a separately specified and tested operating-
system policy or oplock; V1 must not claim it from link-count checks alone.

Here, **clear** means removing logical references from the live helper,
closing every owned handle, clearing secret/session buffers where the
implementation can do so reliably, and terminating the helper process. It is
not a claim that Windows RAM, crash dumps, or the page file have been
forensically sanitised. Any stronger physical-memory-erasure claim requires a
separate threat model, a non-optimisable zeroisation implementation, and an
exact packaged audit. Release text and the browser UI must not imply that
private paths or source bytes never existed in process memory.

Each work request carries a unique request reference and monotonically
increasing sequence number. Each response repeats both. Missing, repeated,
reordered, cross-session, late, or unsolicited responses are rejected. Only one
work request runs at a time, while the dedicated control reader remains able to
receive cancel or close. A controller event is consumed before awaiting the
helper, so a browser retry cannot start a second native operation.

File mode pins `IFileOpenDialog::SetOptions` to
`FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_FILEMUSTEXIST |
FOS_ALLOWMULTISELECT | FOS_NODEREFERENCELINKS | FOS_DONTADDTORECENT |
FOS_NOCHANGEDIR`. Folder mode uses `FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST |
FOS_PICKFOLDERS | FOS_NODEREFERENCELINKS | FOS_DONTADDTORECENT |
FOS_NOCHANGEDIR`; it deliberately omits `FOS_FILEMUSTEXIST` and
`FOS_ALLOWMULTISELECT`. The helper obtains completed file selection through
`GetResults` and requests `SIGDN_FILESYSPATH`. That returned path remains only a
locator. `GetFinalPathNameByHandleW` must return normalized
`\\?\C:\...` DOS form; the helper strips only that exact prefix before emitting
the private canonical path and rejects UNC, volume-GUID, NT-device, or
drive-less results. Canonical DOS-name checks reject every reserved device
alias, including the superscript-digit forms `COM¹` through `COM³` and `LPT¹`
through `LPT³`. File identity support is mandatory: unsupported file
systems fail closed. Volume serials are uppercase fixed 16-hex values and
opaque `FILE_ID_128` values are uppercase fixed 32-hex values.

`FOS_FORCEFILESYSTEM` limits accepted results to file-system items; it does not
mean local disk only. Mapped drives, UNC locations, sync providers, and other
shell-backed locations may still be visible while the dialog is open. Final
selection is accepted only after the local-volume checks above pass.

### Private and public data

Private helper responses may contain canonical absolute paths, file identities,
and complete identity inventories. They are accepted only by the native
controller.

The browser source-basket view may contain only:

- neutral labels such as `File 1` or `Folder 2`;
- basket position and source kind;
- file count and total bytes;
- a one-use opaque event binding;
- a plain success, cancellation, or generic failure message.

It must never contain a filename, path, file ID, volume serial, session nonce,
adapter identifier, adapter build digest, comparison transcript, source digest,
manifest digest, receipt, authentication tag, native error text, or command.

## Limits and cancellation

The first production implementation is intentionally stricter than the package
contract:

- at most 128 selected roots;
- at most 100,000 discovered files across the basket;
- at most 4 TiB per selected root and 8 TiB in total;
- at most 32,767 UTF-16 code units per private canonical path;
- at most 1 MiB for one work request, 64 KiB for one control message, and
  32 MiB for one helper response;
- one active work request at a time, plus the dedicated out-of-band control
  reader;
- 10 seconds for handshake, 4 hours for a human picker, 4 hours for one bounded
  enumeration/revalidation, 5 seconds for one path comparison, and 5 seconds
  for cooperative shutdown;
- cooperative atomic cancellation checked throughout enumeration and marshalled
  picker closure on the COM STA;
- direct forced helper-process termination if cooperative shutdown misses its
  deadline.

The OLE panel runs on its own initialized STA (`OleInitialize`) and processes
the ordinary Windows message loop until one drop, cancellation or teardown.
It calls `RegisterDragDrop` for every visible drop surface and matches each
registration with `RevokeDragDrop` before destroying the associated window.
Only `CF_HDROP` offered through `TYMED_HGLOBAL` is accepted. A hover or drop
that does not offer Copy is reported as `DROPEFFECT_NONE`; the helper never
silently converts a Move request. The accepted batch is still only a set of
untrusted locators until every root has been opened and inspected under the
same handle-based rules as picker selection. One rejected member rejects the
whole returned batch; no partial selection is emitted.

Cancellation or timeout is fail-closed. No partial selection, partial identity
inventory, source-set manifest, or trusted receipt is emitted.

## Source-set evidence and receipt

The V1 controller builds the existing strict private V1 source-set input only
after `revalidate_start` succeeds. The package validator then builds an
inspection-only, authority-none public manifest.

The controller creates a separately authenticated, native-only start receipt
bound to the exact manifest digest, controller session, helper build digest,
counts, fixed authority/use, and one-use receipt reference. This receipt says
only that the trusted controller accepted the recorded point-in-time evidence.
It is not a signature by Microsoft, the file owner, or a reconstruction worker,
and it grants no execution or publication authority.

The receipt-authentication key is generated for one controller session, never
sent to the browser, and cleared after the controller-owned revalidation scope
is released or the session otherwise becomes terminal. The controller opens
that scope, receives evidence plus an exact release guard (not a Windows
handle), runs its native sink while helper custody remains active, consumes the
exact receipt once, and then requires the matching release acknowledgement. No
controller-side auto-consume fallback is permitted. A missing, duplicate, or
mismatched release acknowledgement makes the start state uncertain and fails
closed. Receipt consumption therefore proves only that the controller sink saw
that handoff receipt while the scope was active; it does not prove that Node
accessed retained handles or that later inspection or reconstruction work
completed.

A rejected or synchronously failed scope-open call is allowed only when the
adapter has already confirmed that no live custody scope was created, or that
any partially created scope was closed. Once a scope-open call resolves,
ownership transfers to the controller even if the returned envelope or evidence
is malformed. The controller retains an own, data-property release guard before
strict parsing and invokes it exactly once. Malformed evidence followed by a
valid, request-bound release acknowledgement is a private-evidence rejection;
a missing release guard or any failed, stale, forged, or mismatched release
acknowledgement is terminal `start_uncertain` and takes precedence over the
evidence error.

## Windows API evidence

The operating-system claims in this specification were checked against the
Microsoft documentation available on 2026-07-19:

- [`IFileOpenDialog::GetResults`](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileopendialog-getresults)
  requires a successful `Show` before results are available and returns the
  selected `IShellItemArray`;
- [`FILEOPENDIALOGOPTIONS`](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/ne-shobjidl_core-_fileopendialogoptions)
  defines the picker flags used above;
- [`OBJECT_ATTRIBUTES`](https://learn.microsoft.com/en-us/windows/win32/api/ntdef/ns-ntdef-_object_attributes)
  states that `OBJ_DONT_REPARSE` follows no reparse points in the associated
  object name and fails with `STATUS_REPARSE_POINT_ENCOUNTERED`;
- [`NtCreateFile`](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)
  defines root-handle-relative names and `FILE_CREATE` fail-if-present
  semantics;
- [`FILE_ID_INFO`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)
  defines the volume serial plus 128-bit file identifier used for identity;
- [`FILE_ID_EXTD_DIR_INFORMATION`](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-file_id_extd_dir_information)
  requires the structure, and every non-final `NextEntryOffset` in a returned
  record chain, to fall on an 8-byte boundary;
- [`CreateFileW`](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
  independently defines `CREATE_NEW` as fail-if-present.
- [`OleInitialize`](https://learn.microsoft.com/en-us/windows/win32/api/ole2/nf-ole2-oleinitialize)
  initializes OLE on the drop-panel thread;
- [`IDropTarget`](https://learn.microsoft.com/en-us/windows/win32/api/oleidl/nn-oleidl-idroptarget)
  defines the drag-enter, drag-over, leave and drop callbacks used by the
  panel;
- [`RegisterDragDrop`](https://learn.microsoft.com/en-us/windows/win32/api/ole2/nf-ole2-registerdragdrop)
  requires an OLE-initialized caller and a pumping message loop;
- [`RevokeDragDrop`](https://learn.microsoft.com/en-us/windows/win32/api/ole2/nf-ole2-revokedragdrop)
  removes each window registration before that window is destroyed.

These API guarantees do not prove that this implementation uses them
correctly. The exact packaged adversarial tests remain mandatory.

## Release gate

No Windows release may claim multi-source native selection until all of the
following pass on the exact packaged bytes:

1. two clean offline Rust builds from genuinely different source roots are
   byte-identical, and ASCII plus UTF-16 scans find no user name, user-home,
   repository, workspace, source-root, target-root, Cargo-registry, or toolchain
   path in the executable;
2. the helper, launcher, Node bundle, dependency licenses, build graph, and
   release manifest are re-read and re-hashed after publication;
3. helper protocol, picker cancellation, timeout, forced teardown, stale/replay,
   malformed JSON, path, reparse, hardlink, duplicate identity, source overlap,
   output overlap, mutation, fresh-output collision, racing hardlink, and
   privacy tests pass. The tests prove outputs use handle-relative
   `FILE_CREATE`/`CREATE_NEW` and never open or truncate an existing entry;
4. deterministic automated tests cover the non-UI protocol and fixture
   inspection path. A packaged manual or OS-level UI-Automation smoke selects
   fixture files through the exact production picker, produces a V1 manifest
   and one-use controller receipt, and starts the local inspection coordinator
   without exposing a private filename or path to the browser. The production
   binary accepts no hidden path-injection test seam;
5. an end-to-end adversarial rename/reparse/mutation test proves the helper-owned
   byte reader and output writer consume the same retained identities. Reopening
   a path in Node is not accepted as this proof;
6. the exact executed helper bytes are bound by protected-install/signature
   verification or by a native no-write/no-delete-share launch held across
   process creation. A pre-launch pathname hash plus self-report is insufficient;
7. any claim that the picker is fully read-only or cannot contact a network is
   backed by an exact packaged OS-level policy test (for example, a deny-by-
   default network boundary), rather than inferred from Common Item Dialog
   flags;
8. the human guide states the point-in-time and non-authority limits in plain
   language.

Until those gates pass, the released V5 one-file-or-folder launcher remains the
current verified release.
