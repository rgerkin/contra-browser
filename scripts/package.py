#!/usr/bin/env python3
"""Create a self-contained, network-blocked HTML player for the rebuilt ROM."""
import base64
import hashlib
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import ROOT, validate

def sha(text):
    return base64.b64encode(hashlib.sha256(text.encode()).digest()).decode()

def main():
    data = (ROOT / 'web/game/contra.nes').read_bytes()
    validate(data)
    css = (ROOT / 'web/style.css').read_text()
    core = (ROOT / 'web/vendor/jsnes/dist/jsnes.min.js').read_text()
    app = (ROOT / 'web/app.js').read_text().replace("import NES from './vendor/jsnes/src/nes.js';", 'const NES = jsnes.NES;')
    modules = []
    for name in ['digest', 'frame-sync', 'relay', 'room', 'party-room', 'direct-room', 'game', 'game-session']:
        source = (ROOT / f'web/netplay/{name}.mjs').read_text()
        source = '\n'.join(line for line in source.splitlines() if not line.startswith('import '))
        modules.append(source.replace('export async function ', 'async function ').replace('export function ', 'function ').replace('export class ', 'class '))
    extension=(ROOT / 'web/gameplay/four-player.mjs').read_text().replace('export class ', 'class ')
    modules.insert(0,extension)
    app = '\n'.join(line for line in app.splitlines() if not line.startswith('import '))
    app = '\n'.join(modules) + '\n' + app
    # Offline packages contain the local player; room signaling needs a server.
    app += "\ndocument.querySelector('.net-panel').hidden = true;\n"
    script = core + '\n;(async()=>{\n' + app + '\n})();\n'
    audio = (ROOT / 'web/audio-worklet.js').read_text()
    license_text = (ROOT / 'web/vendor/jsnes/LICENSE').read_text()
    html = (ROOT / 'web/index.html').read_text()
    csp = f"default-src 'none'; script-src 'sha256-{sha(script)}' blob:; style-src 'sha256-{sha(css)}'; img-src data:; connect-src 'none'; worker-src blob:; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    html = html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n  <meta http-equiv="Content-Security-Policy" content="' + csp + '">')
    html = html.replace('<link rel="stylesheet" href="style.css">', '<style>' + css + '</style>')
    html = html.replace('  <script type="module" src="app.js"></script>', '')
    html = html.replace('href="/"', 'href="#"')
    html = html.replace('</body>', '<script type="application/octet-stream" id="cartridge">' + base64.b64encode(data).decode() + '</script>\n<script type="text/plain" id="audio-source">' + audio + '</script>\n<script>' + script + '</script>\n<!-- JSNES Apache-2.0 license:\n' + license_text + '\n-->\n</body>')
    output = ROOT / 'Contra.html'
    output.write_text(html)
    print(f'Created {output} ({output.stat().st_size:,} bytes). Open directly in Chrome, Edge, or Firefox.')

if __name__ == '__main__':
    main()
