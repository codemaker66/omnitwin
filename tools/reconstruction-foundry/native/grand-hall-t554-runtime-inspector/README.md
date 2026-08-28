# Grand Hall T554 runtime inspector

This Windows-only Node-API addon is a low-level input to the isolated Grand
Hall native-decoder candidate attestor. It is not, by itself, proof of loaded
bytes and it cannot mint production review authority.

It exports four functions:

- `addDllDirectory(absoluteExistingDirectory)` applies
  `SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_DEFAULT_DIRS)`, registers one
  local directory with `AddDllDirectory`, and returns an opaque external.
- `removeDllDirectory(handle)` removes the active directory exactly once. It
  returns `true` for the successful removal and `false` after that removal.
- `revalidateDllDirectory(handle)` reopens the registered pathname and requires
  the same retained volume/file identity while the handle is still active.
- `enumerateLoadedModules()` obtains Windows' current PSAPI module list,
  resolves and canonicalizes every path, sorts by the exact UTF-16 code-unit
  sequence, and returns all observations without pathname deduplication.

The input path crosses Node-API as UTF-16. Embedded NULs and unpaired
surrogates are rejected. UNC, device, drive-relative, missing, file, and
reparse-point paths are rejected, including reparse points in every ancestor.
The addon opens the canonical local directory with a retained non-delete,
non-write-shared handle, records its volume/file identity, registers the DLL
directory, opens it again, and rejects an identity change across registration.
The retained handle is released only after `RemoveDllDirectory` succeeds.
The pathname revalidation is required immediately before and after the native
decoder load; retaining a directory handle alone does not stop Windows from
renaming the directory and creating a replacement at the registered pathname.

Only one active DLL directory is permitted per loaded inspector image. Each
external is keyed by its live heap allocation's exact address in an
addon-private registry, so a handle from a separately loaded copy is rejected.
Node-API dynamic-table initialization is serialized exactly once per image.
Cleanup failures abort the dedicated process because continuing would make
later loader observations unsafe.

## Build and verify

Run from Windows x64:

```powershell
.\build.ps1
```

The build is intentionally host-specific and fails unless these bounded,
reviewed anchors are present. This is not a complete compiler supply-chain
attestation:

- Rust `1.87.0`, pinned by `rust-toolchain.toml`;
- target `x86_64-pc-windows-msvc`;
- Node `22.18.0` x64;
- exact SHA-pinned Cargo, rustc, rustfmt, Clippy, Node, MSVC linker and
  dumpbin executables;
- MSVC tools `14.44.35207` and Windows SDK `10.0.26100.0`, with fixed x64
  MSVC/UCRT/UM library counts and inventory hashes;
- a fixed `CARGO_HOME`, Cargo offline/frozen mode, no user Cargo configuration,
  and no environment override of the reviewed Rust flags.

The checked-in `grand_hall_t554_runtime_inspector.node` is the path-remapped,
authority-none candidate: 304,128 bytes, SHA-256
`e6feb1e3266da498aab4417d356da26c83160bed7be24aef7bc0ab4f5455929b`.
Keeping these fixed bytes with the source lets a fresh Windows checkout verify
the compiled pack without silently substituting a locally different addon.
Any source or binary change requires a new reproducibility and review cycle.

The committed target flags use the static CRT, `/Brepro`, and a deterministic
PDB alternative path. The script replaces ambient compiler/linker discovery
with an exact PATH/LIB/INCLUDE closure, binds Cargo to the reviewed `link.exe`,
and remaps the crate, Cargo home, and user profile before compilation. It runs
formatting, tests, strict Clippy, two isolated clean release builds, requires
their SHA-256 values to be equal, and rejects the listed host, username,
workspace, and host-Cargo-registry path spellings in ASCII and both UTF-16LE
byte alignments. Deterministic virtual remapped source paths may remain.

The bounded build evidence does not inventory every Rust sysroot rlib,
unpacked Cargo dependency source, compiler/linker support DLL, or complete
MSVC/SDK bin and include tree. The exact final candidate bytes are therefore
the runtime anchor; the build script proves repeatability for the explicitly
bound executable and library inventories above, not universal reproduction on
an independently provisioned toolchain.
It then requires one x64 Node-API export and this exact direct dependency set:

- `api-ms-win-core-synch-l1-2-0.dll`
- `kernel32.dll`
- `ntdll.dll`
- `psapi.dll`

The Node probe checks strict arity and types, adversarial UTF-16 and path cases,
one-active-directory enforcement, one-shot removal, forced-GC finalizer
cleanup, cross-copy handle rejection, rename/replacement detection, exact
canonical Node/addon paths, and three identical module snapshots. The script
prints the candidate artifact's
byte count and SHA-256; that emitted digest still requires independent review
before a candidate attestor may pin it.

## Exact security boundary

- `SetDefaultDllDirectories` changes process-wide loader policy and Windows has
  no supported operation to restore the prior policy. Use only a fresh,
  dedicated child process that exits after one observation.
- `LOAD_LIBRARY_SEARCH_DEFAULT_DIRS` still includes trusted application and
  system locations; the future bootstrap must bind the complete reviewed pack,
  baseline target modules as absent, and the exact post-load module inventory.
- The directory handle retains the original directory object but does not pin
  the pathname used by `AddDllDirectory` and does not lock every child DLL.
  The attestor must revalidate the pathname and hash/identity-check every
  allowed file immediately before and after import, in a trusted child with no
  concurrent writer, and fail on any change.
- PSAPI is not an atomic snapshot and cannot detect every hostile manual map.
  The candidate protocol therefore requires a trusted same-user host, no
  Workers or concurrent native loads, repeated stable observations, and a
  short-lived child. It is not a hostile-process security boundary.
- A canonical loaded-image path does not prove that relocated memory equals
  the reviewed on-disk bytes. File identities and pre/post full-pack hashes are
  separate required evidence.
- A different copied inspector image has its own registry and could register a
  directory. The compiled bootstrap must allow exactly one reviewed inspector
  module and reject any extra copy in the module inventory.
- The runtime addon performs no network calls, configuration discovery, file
  writes, or process spawning. The build and compiled bootstrap are separate
  components with separate custody requirements.

Passing these gates supports only an authority-none runtime-attestation
candidate. Production authority remains unavailable until the complete fixed
decoder pack, bootstrap, trust root, and independent review are all accepted.
