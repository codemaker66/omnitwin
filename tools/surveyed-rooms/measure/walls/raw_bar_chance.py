"""How often compare_builds.py's per-wall tests, were each read raw at 0.05, would show some p under it by chance
alone, in either direction. (The bar itself names a wall only where more of its patches turned worse: rarer still.)

    python -X utf8 raw_bar_chance.py [--out <out.json>] [--level 0.05] <compare_builds_out.json> ...

compare_builds.py's bar tests every wall and judgement with a sign test by patch, and corrects the family with
Holm's method (wallviews.holm). This reads, from each of its outputs, the family's tests (per_wall_tests) and each
one's patches that changed (worse + better, the ties left out), and prints, taking the tests as independent:

  the chance that at least one test comes out under the level by chance alone (wallviews.chance_of_any),
  how many tests cannot come out under it at all (on 0.05, those of 5 changed patches or fewer),
  and beside them 1 - (1 - level)^k, what k tests would give were they continuous.

The first is what a raw bar's false name costs on those walls' patch counts; the last overstates it, because a
sign test on a few patches seldom or never reaches the level. Neither is a p value of the comparison itself. With
--out the same figures are written as JSON, file by file.

Reads the JSON files only, never a build."""
import json
import os
import sys

import wallviews as wv


def family(tests, level):
    """The figures for one family of per-wall tests (compare_builds.wall_tests' rows)."""
    ns = [int(t['worse']) + int(t['better']) for t in tests]
    return dict(tests=len(ns), changed_patches=ns, chance_of_some_name=wv.chance_of_any(ns, level),
                cannot_reach=sum(1 for n in ns if wv.chance_of_reaching(n, level) == 0.0),
                were_they_continuous=1.0 - (1.0 - level) ** len(ns))


def main(argv):
    args = list(argv)
    out_path, level = None, 0.05
    if '--out' in args:
        i = args.index('--out')
        out_path = os.path.abspath(args[i + 1])
        del args[i:i + 2]
    if '--level' in args:
        i = args.index('--level')
        level = float(args[i + 1])
        del args[i:i + 2]
    if not args:
        raise SystemExit(__doc__)
    record = []
    for path in args:
        with open(path, encoding='utf-8') as f:
            tests = json.load(f)['per_wall_tests']
        row = dict(file=os.path.basename(path), level=level, **family(tests, level))
        record.append(row)
        print(f"{row['file']}: {row['tests']} tests, {row['cannot_reach']} of them unable to reach {level:g};"
              f" some wall named by chance {row['chance_of_some_name']:.4f}"
              f" (were they continuous, {row['were_they_continuous']:.4f}) | changed patches {row['changed_patches']}", flush=True)
    if out_path:
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(record, f, indent=1)


if __name__ == '__main__':
    main(sys.argv[1:])
