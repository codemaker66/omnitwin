"""Runs one build step in the work directory (cwd), as one process, the way build.sh runs one
Grand Hall script:

    python -X utf8 roombuild/step.py <step> <room.json> [args]

Steps: inputs [base-url] | project-wall <name> | project-ceiling | project-dome <id> |
project-floor | windows | corners | atlas | wall-depth | ceiling-relief | overhead [out-dir] |
flatten-floor <in.npz> <out.npz> <ppm> | pack-floor <in.npz> <out-dir>
"""
import os
import sys

ROOMS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOMS not in sys.path:
    sys.path.insert(0, ROOMS)

from roombuild import atlas, corners, floor, inputs, overhead, relief, surfaces, windows  # noqa: E402
from roombuild.context import Room  # noqa: E402


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    step, room_json, args = sys.argv[1], sys.argv[2], sys.argv[3:]
    room = Room(room_json, os.getcwd())
    if step == 'inputs':
        inputs.run(room, *args)
    elif step == 'project-wall':
        surfaces.project_wall(room, args[0])
    elif step == 'project-ceiling':
        surfaces.project_ceiling(room)
    elif step == 'project-dome':
        surfaces.project_dome(room, args[0])
    elif step == 'project-floor':
        surfaces.project_floor(room)
    elif step == 'windows':
        windows.run(room)
    elif step == 'corners':
        corners.run(room)
    elif step == 'atlas':
        atlas.run(room)
    elif step == 'wall-depth':
        relief.walls(room)
    elif step == 'ceiling-relief':
        relief.ceiling(room)
    elif step == 'overhead':
        overhead.run(room, *args)
    elif step == 'flatten-floor':
        floor.flatten(room, args[0], args[1], float(args[2]))
    elif step == 'pack-floor':
        floor.pack(room, args[0], args[1])
    else:
        sys.exit(f"unknown step {step}\n{__doc__}")


if __name__ == '__main__':
    main()
