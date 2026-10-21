#!/usr/bin/env python3
"""Serve the player and temporary signaling rooms; loopback by default."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import argparse
import json
import os
import time
import threading
from rooms import Rooms, RoomError
from build import validate, EXPECTED

WEB = Path(__file__).resolve().parents[1] / 'web'
CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

def shared_cartridge(path):
    """Validate one local cartridge before exposing these two exact URLs."""
    path=Path(path).expanduser()
    if path.stat().st_size!=131088:
        raise ValueError('Shared ROM must be the original 131,088-byte Contra (US) image.')
    data=path.read_bytes()
    validate(data)
    manifest={'name':'Contra (US)','sha512':EXPECTED,'bytes':len(data),
              'byteIdentical':True,'rebuilt':False}
    return {'/game/contra.nes':('application/octet-stream',data),
            '/game/manifest.json':('application/json',json.dumps(manifest).encode())}

class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def end_headers(self):
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
        super().end_headers()

    def log_message(self, fmt, *args):
        # No request paths/room credentials or SDP in logs.
        pass

    def respond(self, value, status=200):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def api(self):
        self.connection.settimeout(10)
        path = urlsplit(self.path).path
        try:
            origin = self.headers.get('Origin')
            if origin and origin != self.server.public_origin and origin != 'http://' + self.headers.get('Host',''):
                raise RoomError(403, 'Origin not allowed.')
            # Host checks prevent DNS-rebinding against the local signaling API.
            if self.headers.get('Host','') not in self.server.allowed_hosts:
                raise RoomError(403, 'Host not allowed.')
            now = time.monotonic()
            with self.server.rate_lock:
                self.server.creators = {k:v for k,v in self.server.creators.items() if now-v[0]<60}
                if path == '/api/rooms' and self.command == 'POST':
                    key=self.client_address[0]
                    window,count=self.server.creators.get(key,(now,0))
                    if count>=10 or len(self.server.creators)>=1024:
                        raise RoomError(429,'Too many rooms; try again in a minute.')
                    self.server.creators[key]=(window,count+1)
            body = {}
            if self.command == 'POST':
                if self.headers.get('Content-Type','').split(';')[0] != 'application/json':
                    raise RoomError(415,'Expected JSON.')
                try: length=int(self.headers.get('Content-Length','-1'))
                except ValueError: raise RoomError(400,'Invalid content length.')
                if not 0 <= length <= 65536:
                    raise RoomError(413,'Signaling message too large.')
                try: body=json.loads(self.rfile.read(length))
                except (ValueError,UnicodeError): raise RoomError(400,'Invalid JSON.')
                if not isinstance(body,dict): raise RoomError(400,'Expected a JSON object.')
            if path == '/api/config' and self.command == 'GET':
                return self.respond({'iceServers':self.server.ice_servers})
            if path == '/api/rooms' and self.command == 'POST':
                return self.respond(self.server.rooms.create(body.get('players',2)),201)
            parts=path.strip('/').split('/')
            if len(parts) not in (3,4) or parts[:2]!=['api','rooms']:
                raise RoomError(404,'API route not found.')
            room=parts[2]
            token=self.headers.get('Authorization','').removeprefix('Bearer ')
            if len(parts)==4:
                if parts[3]=='events' and self.command=='GET':
                    self.server.rooms.open_stream(room,token)
                    try:
                        self.send_response(200)
                        self.send_header('Content-Type','application/x-ndjson')
                        self.send_header('Transfer-Encoding','chunked')
                        self.send_header('X-Accel-Buffering','no')
                        self.end_headers()
                        def chunk(data):
                            raw=(json.dumps(data)+'\n').encode()
                            self.wfile.write(f'{len(raw):x}\r\n'.encode()+raw+b'\r\n');self.wfile.flush()
                        chunk([])
                        while True:chunk(self.server.rooms.read(room,token))
                    except (OSError,RoomError):self.close_connection=True
                    finally:self.server.rooms.close_stream(room,token)
                    return
                raise RoomError(404,'API route not found.')
            if self.command=='POST' and 'invite' in body:
                return self.respond(self.server.rooms.join(room,body['invite']))
            if self.command not in ('GET','POST'):raise RoomError(405,'Method not allowed.')
            if self.command=='POST':
                if body.get('transport')=='relay':return self.respond(self.server.rooms.enable_relay(room,token))
                if 'messages' in body:return self.respond(self.server.rooms.send(room,token,body['messages']))
                if 'description' not in body:raise RoomError(400,'Session description missing.')
            return self.respond(self.server.rooms.access(room,token,body.get('description')))
        except RoomError as exc:
            self.respond({'error':exc.message},exc.status)
        except (TimeoutError, OSError):
            self.close_connection=True

    def do_POST(self):
        if self.path.startswith('/api/'):
            return self.api()
        self.send_error(405)

    def serve_shared_cartridge(self):
        asset=getattr(self.server,'shared_cartridge',{}).get(urlsplit(self.path).path)
        if asset is None:return False
        content_type,data=asset
        self.send_response(200)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        if self.command!='HEAD':self.wfile.write(data)
        return True

    def do_GET(self):
        if self.serve_shared_cartridge():return
        if urlsplit(self.path).path.startswith('/game/') and not getattr(self.server,'share_game',False):
            self.send_error(404)
            return
        if self.path.startswith('/api/'):
            return self.api()
        path = Path(self.translate_path(self.path)).resolve()
        if (path.is_relative_to(WEB / 'game') and not getattr(self.server,'share_game',False)) or not path.is_relative_to(WEB) or path.is_dir() and urlsplit(self.path).path != '/':
            self.send_error(403)
            return
        super().do_GET()

    def do_HEAD(self):
        if self.serve_shared_cartridge():return
        if urlsplit(self.path).path.startswith('/game/') and not getattr(self.server,'share_game',False):
            self.send_error(404)
            return
        path=Path(self.translate_path(self.path)).resolve()
        if (path.is_relative_to(WEB / 'game') and not getattr(self.server,'share_game',False)) or not path.is_relative_to(WEB) or path.is_dir() and urlsplit(self.path).path != '/':
            self.send_error(403)
            return
        super().do_HEAD()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8787)
    parser.add_argument('--host',default='127.0.0.1')
    parser.add_argument('--lan-address',help='Exact private LAN IP to bind and allow, e.g. 192.168.1.20')
    parser.add_argument('--share-rom',nargs='?',const=str(WEB / 'game/contra.nes'),metavar='PATH',
                        help='Serve a verified local ROM to LAN browsers; optional path defaults to web/game/contra.nes. Requires --lan-address.')
    parser.add_argument('--public-origin',help='Exact HTTPS origin of your reverse proxy, e.g. https://play.example.org')
    args=parser.parse_args()
    if args.share_rom and (not args.lan_address or args.public_origin):
        parser.error('--share-rom requires --lan-address and cannot be combined with --public-origin')
    shared={}
    if args.share_rom:
        try:shared=shared_cartridge(args.share_rom)
        except (OSError,ValueError) as exc:parser.error(f'Cannot share cartridge: {exc}')
    if args.public_origin and (urlsplit(args.public_origin).scheme!='https' or urlsplit(args.public_origin).path not in ('','/')):
        parser.error('--public-origin must be an HTTPS origin without a path')
    if args.lan_address:
        import ipaddress
        try: address=ipaddress.ip_address(args.lan_address)
        except ValueError: parser.error('--lan-address must be an IP address')
        if address.version!=4 or not any(address in ipaddress.ip_network(net) for net in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')):
            parser.error('--lan-address must be a private IPv4 interface address')
        args.host=args.lan_address
    server=ThreadingHTTPServer((args.host,args.port),partial(Handler,directory=str(WEB)))
    server.daemon_threads=True
    server.shared_cartridge=shared
    server.share_game=not args.public_origin and args.host in ('127.0.0.1','localhost','::1')
    server.rooms=Rooms()
    server.public_origin=args.public_origin.rstrip('/') if args.public_origin else None
    server.allowed_hosts={f'127.0.0.1:{args.port}',f'localhost:{args.port}'}
    if args.lan_address:server.allowed_hosts.add(f'{args.lan_address}:{args.port}')
    if server.public_origin:server.allowed_hosts.add(urlsplit(server.public_origin).netloc)
    server.creators={};server.rate_lock=threading.Lock()
    try:
        server.ice_servers=json.loads(os.environ.get('CONTRA_ICE_SERVERS','[{"urls":"stun:stun.l.google.com:19302"}]'))
        if not isinstance(server.ice_servers,list):raise ValueError('Expected a list')
    except ValueError as exc:parser.error(f'Invalid CONTRA_ICE_SERVERS JSON: {exc}')
    print(f'Contra player: http://{args.lan_address or "127.0.0.1"}:{args.port}',flush=True)
    if shared:print('LAN cartridge sharing enabled: visiting browsers will load the verified ROM automatically.',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:server.server_close()
