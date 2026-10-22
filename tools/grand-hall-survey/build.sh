#!/usr/bin/env bash
# Rebuilds the Grand Hall's survey images and wall relief from the public scan.
#
#   bash tools/grand-hall-survey/build.sh <work-dir> [<publish-dir>]
#
# Every step runs in <work-dir>; downloads and per-station depth maps already
# there are kept. With <publish-dir> (normally
# packages/web/public/rooms/grand-hall/survey-2026-07-11) the finished files
# are copied there. See README.md for what each step measures.
set -euo pipefail

SURVEY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${1:?usage: build.sh <work-dir> [<publish-dir>]}"
PUBLISH="${2:-}"
if [ -n "$PUBLISH" ]; then PUBLISH="$(cd "$PUBLISH" && pwd)"; fi
mkdir -p "$WORK"
cd "$WORK"
mkdir -p proj relief

step() { printf '\n== %s\n' "$*"; }

step "Inputs: manifest, dollhouse mesh, 49 station panoramas (hash-checked)"
python3 "$SURVEY/fetch_inputs.py"
if [ ! -f data/mesh/indices.u32 ]; then node "$SURVEY/dump-mesh.mjs" data/dollhouse.glb data/mesh; fi

step "Occlusion: each station's distance cubemap"
node "$SURVEY/render-depth.mjs" 1024 data/depth1024

step "Surfaces: the walls' and ceiling's measured positions"
node "$SURVEY/render.mjs" "$SURVEY/views-walls.json" out-walls
node "$SURVEY/render.mjs" "$SURVEY/views-ceiling.json" out-walls

step "Walls: the corners' fins moved back onto their walls"
python3 "$SURVEY/fix-corners.py" --positions-only

step "Walls: each 40 mm block's sharpest station, and the depth where the best views agree"
for wall in window door end fire; do python3 "$SURVEY/label-views.py" "$wall"; done

step "Walls: coloured from those stations, seams levelled (2.5 mm and 5 mm orthophotos)"
for wall in window door end fire; do python3 "$SURVEY/project-walls.py" "$wall" --labels; done

step "Projection: ceiling, dome and floor"
python3 "$SURVEY/project-ceiling.py"
python3 "$SURVEY/project-dome.py"
python3 "$SURVEY/project-floor.py"

# The glass mask and the windows' layered depth are read from the window wall's
# photograph and its rendered (uncorrected) positions.
step "Windows: glass mask and layered depth"
python3 "$SURVEY/window-relief.py"

step "Packing for the web"
python3 "$SURVEY/pack-atlas.py" ${PUBLISH:+--alpha-from "$PUBLISH"}
if [ -n "$PUBLISH" ]; then python3 "$SURVEY/check-atlas.py" proj "$PUBLISH" --json proj/check-atlas.json; fi
python3 "$SURVEY/wall-depth.py" window door end fire
node "$SURVEY/relief-mesh.mjs" proj/walls-relief.bin
python3 "$SURVEY/pack-overhead.py" proj
python3 "$SURVEY/flatten-floor.py" proj/floor.npz proj/floor-flat.npz 120
python3 "$SURVEY/pack-floor.py" proj/floor-flat.npz proj

# The same best-view photographs at 2 mm, cut into the tiles the planner
# streams where it looks closely at a wall (hall-detail.ts); the atlas's alpha
# marks the window glass, which the tiles leave out.
step "Walls at 2 mm: the detail tiles"
for wall in window door end fire; do python3 "$SURVEY/project-detail.py" "$wall"; done
python3 "$SURVEY/pack-detail.py" --atlas proj

OUTPUTS=(walls-4096.webp walls-2048.webp walls-relief.bin ceiling-3072.webp ceiling-1536.webp
  dome-4096.webp dome-2048.webp floor-2560.webp floor-1280.webp)
if [ -n "$PUBLISH" ]; then
  step "Publishing to $PUBLISH"
  for file in "${OUTPUTS[@]}"; do cp "proj/$file" "$PUBLISH/$file"; done
  rm -rf "$PUBLISH/detail" && cp -r proj/detail "$PUBLISH/detail"
fi
step "Done"
for file in "${OUTPUTS[@]}" detail/index.json; do printf '%s  %s\n' "$(sha256sum "proj/$file" | cut -c1-16)" "$file"; done
