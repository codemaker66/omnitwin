# Node to Rust inherited-OVERLAPPED-pipe proof

This is an isolated Windows integration proof. It does not activate the
production helper or add a user-facing capability. Its Rust executable imports
the production `data_plane_frame` and `data_plane_io` modules so the proof tests
the same transport implementation that an eventual runtime owner can call.

Run it from this directory or any parent directory:

```powershell
node --test .\verify.test.mjs
```

The test builds a locked, offline, Rust 1.87.0 release executable, copies it to
a temporary package directory, hashes the copied executable, and launches only
that copy. Node stdio slots 3 and 4 use `"overlapped"`, not ordinary `"pipe"`:

- child fd 3 is the Node-to-helper channel and accepts only VNSDP01 output frames;
- child fd 4 is the helper-to-Node channel and accepts only VNSDP01 source or
  catalog frames.

The native Windows run checks:

1. exact 1 MiB payload transfer;
2. headers and payloads split across separate writes;
3. two frames coalesced into one parent write;
4. the 160-byte oversize preflight before payload allocation;
5. invalid magic is terminal and never triggers magic resynchronization;
6. EOF in the middle of a header and in the middle of a payload;
7. cancellation of a blocked fd 3 read;
8. cancellation and final-completion draining of a backpressured fd 4 write;
9. 1,000 cancellation-generation completion races;
10. rejected source-on-fd-3 and output-on-fd-4 direction reversals;
11. distinct, present pipe mappings plus missing and non-pipe failures; and
12. exact child-close confirmation for timeout, diagnostic-bound, and parent
   write-error paths.

The production resolver calls `_get_osfhandle` for CRT descriptors 3 and 4,
rejects missing, detached, non-pipe, or equal results, and treats the returned
Windows handles as borrowed. It never calls `CloseHandle` on those borrowed
handles. The proof's eventual owner closes the descriptors with `_close` only
after every overlapped operation has reached a final completion.

Each read or write has its own `OVERLAPPED` and manual-reset completion event.
Cancellation uses a separate cloneable manual-reset event bound to one exact
generation. If cancellation and normal completion race, the implementation
targets the exact `OVERLAPPED` with `CancelIoEx` and then observes the final
completion before the stack state or I/O buffer can be reused or dropped.

On non-Windows systems the proof is skipped before Cargo runs. Windows on ARM
is reported as unsupported because the production helper is intentionally
limited to `x86_64-pc-windows-msvc`.

This proves inherited-pipe mapping, VNSDP01 transport, bounded framing,
cancellation, direction enforcement, and teardown behavior. It does not prove
source custody, output custody, executable trust in a packaged application, or
full runtime wiring.

Primary contracts:

- [Node child-process stdio](https://nodejs.org/api/child_process.html)
- [Microsoft `_get_osfhandle`](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/get-osfhandle?view=msvc-170)
- [Microsoft overlapped input/output](https://learn.microsoft.com/en-us/windows/win32/sync/synchronization-and-overlapped-input-and-output)
- [Microsoft `CancelIoEx`](https://learn.microsoft.com/en-us/windows/win32/fileio/cancelioex-func)
