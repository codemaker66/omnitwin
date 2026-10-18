#!/usr/bin/env bash
# Builds a surveyed room's survey files from its config (see build-room.py for the steps).
#
#   bash tools/surveyed-rooms/build-room.sh <room.json> <work-dir> [<publish-dir>]
#
# Every step runs in <work-dir>; downloads and per-station depth maps already there are kept.
# With <publish-dir> (the config's survey.publish.folder) the finished files are copied there.
# PYTHON overrides the interpreter: in Git Bash on Windows `python3` can be the Store stub.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOM="${1:?usage: build-room.sh <room.json> <work-dir> [<publish-dir>]}"
WORK="${2:?usage: build-room.sh <room.json> <work-dir> [<publish-dir>]}"
exec "${PYTHON:-python}" -X utf8 "$HERE/build-room.py" "$ROOM" "$WORK" ${3:+--publish "$3"}
