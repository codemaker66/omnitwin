"""One explicitly admitted local GPU run. No network, credentials or publisher.

Source/dependencies/browser/pnpm must already be prepared from reviewed source.
The GPU benchmark lease serializes this controller's jobs, not the host desktop.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
BWRAP_SHA256 = '52231e1caf55bcbc667b269f49c63599a6f7db4767ae6a039580d0ff853db712'
ENV = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/tmp'}
RUNNER_FILES = ['run-worker.py', 'worker-inner.sh', 'probe-runtime.cjs', 'gpu-tests.txt']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def runner_check(source):
    hashes = {name: digest(HERE / name) for name in RUNNER_FILES}
    if any(source['sourceHashes'].get('.github/gpu/' + name) != value for name, value in hashes.items()):
        raise ValueError('Runner helpers are not the admitted committed source')
    return hashes


def read_json(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 20 * 1024 * 1024:
        raise ValueError('Invalid input file')
    return json.loads(path.read_bytes())


def source_check(workspace, source):
    mismatches = []
    for name, expected in source['sourceHashes'].items():
        path = workspace / name
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(workspace.resolve()) or digest(path) != expected:
            mismatches.append(name)
    # Frozen installation produces only these two workspace build outputs.
    # In particular, an extra vite.config.js must never override tracked TS.
    generated = {'packages/types/dist', 'packages/reconstruction-foundry/dist'}
    generated_files = {'packages/types/tsconfig.build.tsbuildinfo',
                       'packages/reconstruction-foundry/tsconfig.build.tsbuildinfo'}
    unexpected = []
    for parent, directories, files in os.walk(workspace, followlinks=False):
        kept = []
        for name in directories:
            path = Path(parent) / name
            relative = path.relative_to(workspace).as_posix()
            if name == 'node_modules' or relative == '.git' or relative in generated:
                continue
            if path.is_symlink():
                unexpected.append(relative)
            else:
                kept.append(name)
        directories[:] = kept
        for name in files:
            relative = (Path(parent) / name).relative_to(workspace).as_posix()
            if relative not in source['sourceHashes'] and relative not in generated_files:
                unexpected.append(relative)
    if mismatches or unexpected:
        raise ValueError(f'Source mismatch or unexpected file: {mismatches + unexpected}')
    return {'commitSha': source['commitSha'], 'treeSha': source['treeSha'],
            'checkedFiles': len(source['sourceHashes']), 'state': 'pass'}


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def save(path, value):
    with path.open('x', encoding='utf8') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['workspace', 'request-dir', 'output', 'bwrap', 'browser-cache', 'pnpm', 'lease']:
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    paths = {name: Path(value).absolute() for name, value in vars(args).items()}
    workspace, output = paths['workspace'], paths['output']
    if output.exists() or output.is_symlink() or not output.parent.is_dir():
        raise ValueError('Output must be a new directory under an existing parent')
    if workspace.is_symlink() or not workspace.is_dir() or workspace == Path('/'):
        raise ValueError('Explicit prepared workspace required')
    if digest(paths['bwrap']) != BWRAP_SHA256:
        raise ValueError('Unreviewed bubblewrap binary')
    request_bytes = (paths['request_dir'] / 'request.json').read_bytes()
    request = read_json(paths['request_dir'] / 'request.json')
    trusted = read_json(paths['request_dir'] / 'trusted.json')
    if not re.fullmatch('[A-Za-z0-9_-]{32}', request['runNonce']):
        raise ValueError('Invalid run nonce')
    if (request['runNonce'] != trusted['runNonce']
            or request['sourceCommit'] != trusted['source']['commitSha']
            or request['sourceTree'] != trusted['source']['treeSha']
            or request['trustedSha256'] != digest(paths['request_dir'] / 'trusted.json')):
        raise ValueError('Request binding mismatch')
    expiry = datetime.datetime.fromisoformat(request['expiresAt'].replace('Z', '+00:00')).timestamp()
    if time.time() >= expiry:
        raise ValueError('Request expired')
    if not paths['lease'].parent.is_dir() or paths['lease'].is_symlink():
        raise ValueError('Explicit existing lease parent required')
    with paths['lease'].open('a') as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = source_check(workspace, trusted['source'])
        runner_hashes = runner_check(trusted['source'])
        # New cache mounts make Vite writable without exposing mutable source.
        cache_paths = ['node_modules/.vite', 'node_modules/.vite-temp',
                       'packages/web/node_modules/.vite', 'packages/web/node_modules/.vite-temp']
        for name in cache_paths:
            path = workspace / name
            if path.is_symlink() or not path.resolve().is_relative_to(workspace.resolve()):
                raise ValueError('Cache mount must remain inside workspace without a symlink')
            path.mkdir(exist_ok=True)
        output.mkdir(mode=0o700)
        save(output / 'source-before.json', before)
        command = ['timeout', '--signal=TERM', '--kill-after=5s', '180s', str(paths['bwrap']),
                   '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-net', '--unshare-uts', '--unshare-cgroup',
                   '--uid', '65534', '--gid', '65534', '--cap-drop', 'ALL', '--disable-userns',
                   '--new-session', '--die-with-parent', '--clearenv',
                   '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/sbin', '/sbin',
                   '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
                   '--dir', '/etc', '--ro-bind', '/etc/ld.so.cache', '/etc/ld.so.cache',
                   '--ro-bind', '/etc/fonts', '/etc/fonts', '--ro-bind', '/etc/os-release', '/etc/os-release',
                   '--proc', '/proc', '--dev', '/dev', '--dev-bind', '/dev/dxg', '/dev/dxg',
                   '--tmpfs', '/tmp', '--tmpfs', '/run', '--dir', '/home', '--dir', '/home/worker',
                   '--ro-bind', str(workspace), '/workspace', '--ro-bind', str(HERE), '/runner',
                   '--ro-bind', str(paths['browser_cache']), '/opt/playwright',
                   '--ro-bind', str(paths['pnpm']), '/opt/pnpm', '--bind', str(output), '/results']
        for name in cache_paths:
            command += ['--tmpfs', '/workspace/' + name]
        for key, value in {'HOME': '/home/worker', 'PATH': '/opt/pnpm/bin:/usr/local/bin:/usr/bin:/bin',
                           'GALLIUM_DRIVER': 'd3d12', 'LD_LIBRARY_PATH': '/usr/lib/wsl/lib',
                           'MESA_D3D12_DEFAULT_ADAPTER_NAME': 'NVIDIA', 'DISPLAY': ':99',
                           'PLAYWRIGHT_BROWSERS_PATH': '/opt/playwright', 'CI': 'true', 'E2E_PORT': '5337',
                           'PLAYWRIGHT_JSON_OUTPUT_NAME': '/results/results.json'}.items():
            command += ['--setenv', key, value]
        command += ['--chdir', '/workspace', '/usr/bin/bash', '/runner/worker-inner.sh']
        started, monotonic_start = utc(), time.monotonic_ns()
        with (output / 'run.log').open('xb') as log:
            result = subprocess.run(command, env=ENV, stdout=log, stderr=subprocess.STDOUT, check=False)
        elapsed_ms, ended = (time.monotonic_ns() - monotonic_start) / 1e6, utc()
        after = source_check(workspace, trusted['source'])
        if runner_hashes != {name: digest(HERE / name) for name in RUNNER_FILES}:
            raise ValueError('Runner changed during execution')
        save(output / 'source-after.json', after)
        save(output / 'execution.json', {'schemaVersion': 1, 'requestSha256': hashlib.sha256(request_bytes).hexdigest(),
             'runNonce': request['runNonce'], 'source': trusted['source'], 'exitCode': result.returncode,
             'startedAt': started, 'endedAt': ended, 'elapsedMs': elapsed_ms,
             'exclusiveBenchmarkLease': True, 'bwrapSha256': BWRAP_SHA256, 'runnerHashes': runner_hashes})
        if time.time() >= expiry:
            raise ValueError('Request expired during execution')
        if result.returncode:
            raise ValueError(f'GPU benchmark failed with exit {result.returncode}; raw log retained')
        print(json.dumps({'state': 'executed', 'casesRequireIndependentVerification': True, 'elapsedMs': elapsed_ms}))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(f'GPU worker failed: {error}', file=sys.stderr)
        sys.exit(1)
