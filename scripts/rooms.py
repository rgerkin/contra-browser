"""Small in-memory WebRTC signaling store. Never accepts ROMs or game state."""
import secrets
import threading
import time

class RoomError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message

class Rooms:
    def __init__(self, ttl=1800, capacity=128, clock=time.monotonic):
        self.ttl, self.capacity, self.clock = ttl, capacity, clock
        self.rooms = {}
        self.lock = threading.Lock()

    def _expire(self):
        now = self.clock()
        self.rooms = {k:v for k,v in self.rooms.items() if now-v['updated'] < self.ttl}

    def create(self):
        with self.lock:
            self._expire()
            if len(self.rooms) >= self.capacity:
                raise RoomError(503, 'Room capacity reached; try later.')
            room = secrets.token_urlsafe(18)
            host, invite = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
            self.rooms[room] = {'host':host,'invite':invite,'guest':None,'offer':None,'answer':None,'updated':self.clock()}
            return {'room':room,'token':host,'invite':invite,'player':1}

    def join(self, room, invite):
        with self.lock:
            self._expire()
            r = self.rooms.get(room)
            if not r or not isinstance(invite,str) or not secrets.compare_digest(r['invite'],invite):
                raise RoomError(404, 'Room or invitation not found.')
            if r['guest']:
                raise RoomError(409, 'Room already has two players. Ask the host for a new room.')
            r['guest'] = secrets.token_urlsafe(24)
            r['updated'] = self.clock()
            return {'room':room,'token':r['guest'],'player':2}

    def access(self, room, token, description=None):
        with self.lock:
            self._expire()
            r = self.rooms.get(room)
            if not r or not isinstance(token,str) or not token:
                raise RoomError(404, 'Room expired or not found.')
            player = 1 if secrets.compare_digest(r['host'],token) else 2 if r['guest'] and secrets.compare_digest(r['guest'],token) else 0
            if not player:
                raise RoomError(403, 'Invalid room credentials.')
            key = 'offer' if player == 1 else 'answer'
            if description is not None:
                if not isinstance(description,dict) or description.get('type') != key or not isinstance(description.get('sdp'),str) or not 1 <= len(description['sdp']) <= 60000:
                    raise RoomError(400, 'Invalid session description.')
                if r[key] is not None and r[key] != description:
                    raise RoomError(409, 'Description already set. Create a new room to reconnect.')
                r[key] = {'type':key,'sdp':description['sdp']}
            r['updated'] = self.clock()
            # Never expose another participant's credentials or the invitation.
            return {'player':player,'offer':r['offer'],'answer':r['answer'],'joined':bool(r['guest'])}
