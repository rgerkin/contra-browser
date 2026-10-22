#!/usr/bin/env python3
"""Prepare only public browser code for a future Cloudflare deployment."""
import mimetypes
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]
WEB=ROOT/'web'
OUTPUT=ROOT/'build/cloudflare-assets'
MARKER=ROOT/'build/cloudflare-assets.manifest.json'


def prepare():
    subprocess.run(['python3',str(ROOT/'scripts/verify.py')],check=True)
    # Explicit entry points and code directories: never copy web/ wholesale.
    files=[WEB/name for name in ('index.html','style.css','app.js','audio-worklet.js')]
    for folder in ('netplay','gameplay'):
        files.extend(sorted((WEB/folder).glob('*.mjs')))
    files.extend(sorted((WEB/'vendor/jsnes/src').rglob('*.js')))
    files.append(WEB/'vendor/jsnes/LICENSE')
    manifest={}
    (ROOT/'build').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='contra-cloudflare-',dir=ROOT/'build') as tmp:
        staging=Path(tmp)/'assets';staging.mkdir()
        for source in files:
            if source.is_symlink() or not source.is_file():
                raise ValueError(f'Expected an ordinary source file: {source.relative_to(ROOT)}')
            resolved=source.resolve()
            if not resolved.is_relative_to(WEB.resolve()):
                raise ValueError('Asset source escapes web/')
            relative=source.relative_to(WEB)
            if relative.parts[0]=='game' or source.suffix.lower() in ('.nes','.rom','.bin','.png','.jpg'):
                raise ValueError('Private game content cannot enter Cloudflare assets')
            # Reject symlinked code-directory parents as well as symlinked files.
            if any(parent.is_symlink() for parent in source.parents if parent!=ROOT and parent.is_relative_to(ROOT)):
                raise ValueError('Symlinked asset directory')
            target=staging/relative;target.parent.mkdir(parents=True,exist_ok=True)
            data=source.read_bytes();target.write_bytes(data)
            manifest[str(relative)]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
        for name in ('LICENSE','THIRD_PARTY_NOTICES.md'):
            data=(ROOT/name).read_bytes();(staging/name).write_bytes(data)
            manifest[name]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
        if OUTPUT.exists():
            if OUTPUT.is_symlink() or not MARKER.is_file():
                raise ValueError('Refusing to replace a directory not identified as generated assets')
            shutil.rmtree(OUTPUT)
        shutil.move(str(staging),OUTPUT)
    MARKER.write_text(json.dumps(manifest,indent=2)+'\n')
    inline={}
    for name in manifest:
        mime='text/javascript' if Path(name).suffix in ('.js','.mjs') else mimetypes.guess_type(name)[0] or 'text/plain'
        inline['/'+name]={'text':(OUTPUT/name).read_text(),'type':mime+'; charset=utf-8'}
    (ROOT/'build/cloudflare-assets.inline.json').write_text(json.dumps(inline))
    print(f'Prepared {len(manifest)} public assets in {OUTPUT}')
    print('No ROM, local game manifest, screenshots, disassembly, or standalone HTML copied.')
    print('This prepares browser files only; no Worker has been created or deployed.')


if __name__=='__main__':
    prepare()
