#!/usr/bin/env python3
"""Verify bundled runtime; optionally verify separately obtained build sources."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def check_files(files):
    for relative, expected in files.items():
        path = ROOT / relative
        if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise SystemExit(f'Integrity check failed: {relative}')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', action='store_true', help='Also verify external disassembly and compiler source checkouts')
    args = parser.parse_args()
    lock = json.loads((ROOT / 'sources.lock.json').read_text())
    files = dict(lock['files'])
    directories = ['web/vendor/jsnes/src']
    if args.build:
        for name, repo in lock['repositories'].items():
            path = ROOT / repo['path']
            if not (path / '.git').exists():
                parser.error(f'{name}: external checkout missing. See README build instructions.')
            actual = subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip()
            if actual != repo['commit']:
                raise SystemExit(f'{name}: source revision differs from pin')
        files.update(lock['buildFiles'])
        directories.append('vendor/nes-contra-us/src')
        for tool in ['ca65', 'ld65']:
            if not (ROOT / 'vendor/cc65/bin' / tool).is_file():
                parser.error(f'{tool}: local compiler missing. See README build instructions.')
    check_files(files)
    for directory in directories:
        for path in (ROOT / directory).rglob('*'):
            if path.is_file() and str(path.relative_to(ROOT)) not in files:
                raise SystemExit(f'Unreviewed source file: {path}')
    print(f'Verified SHA-256 of {len(files)} third-party files' + (' and pinned build-source revisions.' if args.build else '.'))

if __name__ == '__main__':
    main()
