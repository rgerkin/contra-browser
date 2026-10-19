#!/usr/bin/env python3
"""Reassemble Contra from pinned source and a verified, user-supplied US ROM."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'vendor/nes-contra-us'
EXPECTED = '1c747c78c678f14a68d4e5fcae065298a103f833638775860f0e5c5ffaa061f62d45fd8942148b1507c1fd57fde950a5d83f9f84a9782ec048a56067740c48e9'
PIN = '687d651c021fd7020f10d05b970ccb62663c94bd'
HEADER = bytes.fromhex('4e45531a080021000000000000000000')


def validate(data):
    if len(data) != 131088 or data[:16] != HEADER:
        raise ValueError('Expected a 131,088-byte Contra (US) iNES ROM, mapper 2, with its original header.')
    if hashlib.sha512(data).hexdigest() != EXPECTED:
        raise ValueError('ROM SHA-512 differs from the pinned disassembly reference. No assets extracted or build published.')


def assemble(data, work):
    """Only explicitly selected source/data enters the assembler; no upstream scripts."""
    work = Path(work)
    (work / 'src').mkdir()
    (work / 'obj').mkdir()
    for source in sorted((SOURCE / 'src').glob('*.asm')):
        (work / 'src' / source.name).write_bytes(source.read_bytes())
    (work / 'contra.cfg').write_bytes((SOURCE / 'contra.cfg').read_bytes())
    for line in (SOURCE / 'assets.txt').read_text().splitlines():
        name, offset, length = line.split()
        name = PurePosixPath(name.replace('\\', '/'))
        if '..' in name.parts or name.is_absolute() or name.parts[:2] != ('src', 'assets'):
            raise ValueError('Unsafe asset path')
        offset, length = int(offset), int(length)
        if offset < 16 or length <= 0 or offset + length > len(data):
            raise ValueError('Invalid asset range')
        target = work / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data[offset:offset + length])
    objects = []
    for unit in ['ram', 'constants', 'ines_header'] + [f'bank{i}' for i in range(8)]:
        obj = f'obj/{unit}.o'
        subprocess.run([str(ROOT / 'vendor/cc65/bin/ca65'), '-D', 'Contra', '--debug-info', '-o', obj, f'src/{unit}.asm'], cwd=work, check=True, timeout=60)
        objects.append(obj)
    subprocess.run([str(ROOT / 'vendor/cc65/bin/ld65'), '-C', 'contra.cfg', '--dbgfile', 'contra.dbg', *objects, '-o', 'contra.nes'], cwd=work, check=True, timeout=60)
    return (work / 'contra.nes').read_bytes()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', nargs='?', default=str(ROOT / 'baserom.nes'), help='Path to your original Contra (US) ROM')
    args = parser.parse_args()
    path = Path(args.rom).expanduser().resolve()
    if not path.is_file():
        parser.error(f'ROM missing: {path}. Supply its path: npm run build -- /path/to/Contra-US.nes')
    if path.stat().st_size != 131088:
        parser.error('Incorrect ROM size; expected 131,088 bytes.')
    data = path.read_bytes()
    try:
        validate(data)
        subprocess.run(['python3', str(ROOT / 'scripts/verify.py'), '--build'], check=True)
        with tempfile.TemporaryDirectory(prefix='contra-build-') as tmp:
            rebuilt = assemble(data, tmp)
        if rebuilt != data or hashlib.sha512(rebuilt).hexdigest() != EXPECTED:
            raise ValueError('Reassembled ROM differs from original. Nothing published.')
        out = ROOT / 'web/game'
        out.mkdir(exist_ok=True)
        temp = out / 'contra.nes.tmp'
        temp.write_bytes(rebuilt)
        os.replace(temp, out / 'contra.nes')
        manifest = {'name': 'Contra (US)', 'sourceCommit': PIN, 'sha512': EXPECTED, 'bytes': len(rebuilt), 'byteIdentical': True}
        (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        print('Verified: rebuilt ROM is byte-for-byte identical.')
        subprocess.run(['python3', str(ROOT / 'scripts/package.py')], check=True)
        print('Browser player: http://127.0.0.1:8787. Standalone: Contra.html.')
    except (ValueError, subprocess.SubprocessError) as exc:
        parser.exit(1, f'Build failed: {exc}\n')


if __name__ == '__main__':
    main()
