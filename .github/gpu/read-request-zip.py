"""Read only the three bounded, regular request files; never extract an archive."""
import base64
import io
import json
from pathlib import Path
import stat
import sys
import zipfile

EXPECTED = {'request.json', 'trusted.json', 'READY.json'}
MAX_ARCHIVE = 8 * 1024 * 1024
MAX_FILE = 2 * 1024 * 1024


def read_request_zip(raw):
    if not raw or len(raw) > MAX_ARCHIVE:
        raise ValueError('Request archive size rejected')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        if len(entries) != 3 or {entry.filename for entry in entries} != EXPECTED:
            raise ValueError('Archive must contain exactly three fixed request files')
        values = {}
        for entry in entries:
            mode = stat.S_IFMT(entry.external_attr >> 16)
            if entry.is_dir() or mode not in {0, stat.S_IFREG} or entry.flag_bits & 1:
                raise ValueError('Archive entry must be an unencrypted regular file')
            if entry.file_size <= 0 or entry.file_size > MAX_FILE:
                raise ValueError('Archive entry size rejected')
            with archive.open(entry) as stream:
                content = stream.read(MAX_FILE + 1)
            if len(content) != entry.file_size or len(content) > MAX_FILE:
                raise ValueError('Archive entry content size rejected')
            values[entry.filename] = base64.b64encode(content).decode('ascii')
        return values


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('One archive path required')
        path = Path(sys.argv[1])
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_ARCHIVE:
            raise ValueError('Archive must be a bounded regular file')
        print(json.dumps(read_request_zip(path.read_bytes())))
    except (OSError, ValueError, zipfile.BadZipFile, RuntimeError) as error:
        print(f'Request archive rejected: {error}', file=sys.stderr)
        sys.exit(1)
