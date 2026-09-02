**Read this when:** calling `pycolmap` (feature extraction, matching,
`triangulate_points`, `Database`) from Python on this Windows machine, building
or reading a COLMAP `database.db`, or writing a `sparse/0` model that COLMAP
must load next to a database (the `tools/xgrids-xbag/xbag_colmap.py` bridge).

# pycolmap 4.2.0 on Windows: five traps met while building the XBAG bridge (2026-09-02)

1. **pycolmap's CPU SIFT dies at start-up, nondeterministically, in roughly
   half of all launches** (exit 3221225477 = 0xC0000005 or 3221226505 =
   0xC0000409, nothing processed, a camera row already written). Measured
   2026-09-02 over about twenty launches of the same `features-one` command
   on 40 to 150 frames: direct launches from a shell mostly survive, children
   of a Python that had imported pycolmap died far more often, and a second
   extraction call inside one process died every time; the run that finally
   worked still needed three attempts for one slot. Neither `os.environ` nor
   the process's real environment block changes on import, so the channel is
   unknown; passing the parent's `os.environ` to the child and keeping
   pycolmap unimported in the parent did not help (4 survivals in 12 child
   launches against 8 of 8 shell launches). What never crashed: the FIRST
   `extract_features` call in the tool's own process, launched from the
   shell. So the bridge's `features` step is one extraction pass over every
   folder with a provisional camera, followed by `assign_database_cameras`
   rewriting each folder's camera to its lens; if that one pass ever dies,
   re-run it (COLMAP skips frames already in the database). Never run two
   COLMAP processes at once. Too-small runs hide the crash (3 frames per slot
   never crashed). There is no CUDA build of the pip wheel
   (`pycolmap.has_cuda` is False), so SIFT stays on the CPU.

2. **Deleting `database.db` is not a fresh database.** COLMAP's SQLite runs in
   WAL mode and leaves `database.db-wal` / `database.db-shm` beside it; a new
   `database.db` opened next to a stale WAL inherits the old rows (a "fresh"
   run started skipping images and processing camera #3). Remove
   `database.db*`.

3. **`triangulate_points` loads the database alongside the model and insists
   a model camera and the database camera with the same id share a lens
   model** (`reconstruction.cc:302 Check failed: existing_camera.model_id ==
   camera.model_id`). Give each image folder the camera id the database
   assigned it (`build_model_entries(..., folder_camera_ids)`); the model's
   params may differ from the database's, the model id may not.

4. **Exhaustive matching is unaffordable on the CPU at 4000x3000:** about
   0.3 s per pair at 12k features. Use `match_image_pairs` with a pose-guided
   pair list (`ImportedPairingOptions.match_list_path`, one `name_a name_b`
   per line) and `max_num_features` 8192.

5. **API shapes:** `pycolmap.Database` has no constructor, use
   `Database.open(path)`; `read_two_view_geometries()` returns a tuple of two
   lists (pair ids, geometries), `pair_id_to_image_pair(pid)` decodes an id;
   `read_two_view_geometry(id_a, id_b)` gives one pair with `.inlier_matches`
   as index pairs ordered (smaller id, larger id); `read_keypoints(image_id)`
   is `(N, 6)` with x, y first; pybind functions have no `inspect.signature`,
   read `__doc__`.

Diagnosis notes live in `docs/reports/xbag-colmap-zone-2026-09-02.md`.
