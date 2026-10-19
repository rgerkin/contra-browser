import io
import json
from email.message import Message
from types import SimpleNamespace
import threading
import unittest
from rooms import Rooms, RoomError
from serve import Handler

class StoreTests(unittest.TestCase):
    def setUp(self):
        self.now=0
        self.store=Rooms(ttl=10,capacity=2,clock=lambda:self.now)
        self.host=self.store.create()
    def test_invitation_claims_exactly_one_slot(self):
        guest=self.store.join(self.host['room'],self.host['invite'])
        self.assertEqual(guest['player'],2)
        self.assertNotIn('invite',guest)
        with self.assertRaises(RoomError) as error:self.store.join(self.host['room'],self.host['invite'])
        self.assertEqual(error.exception.status,409)
    def test_host_and_guest_cannot_replace_each_others_sdp(self):
        guest=self.store.join(self.host['room'],self.host['invite'])
        offer={'type':'offer','sdp':'v=0 host'}
        self.store.access(self.host['room'],self.host['token'],offer)
        with self.assertRaises(RoomError):self.store.access(self.host['room'],guest['token'],offer)
        answer={'type':'answer','sdp':'v=0 guest'}
        state=self.store.access(self.host['room'],guest['token'],answer)
        self.assertEqual(state['offer'],offer)
        self.assertEqual(state['answer'],answer)
        self.assertNotIn('host',state)
        self.assertNotIn('invite',state)
        with self.assertRaises(RoomError):self.store.access(self.host['room'],'invalid')
    def test_changed_offer_rejected_and_identical_retry_allowed(self):
        offer={'type':'offer','sdp':'first'}
        self.store.access(self.host['room'],self.host['token'],offer)
        self.store.access(self.host['room'],self.host['token'],offer)
        with self.assertRaises(RoomError):self.store.access(self.host['room'],self.host['token'],dict(offer,sdp='different'))
    def test_expiration_and_capacity(self):
        self.store.create()
        with self.assertRaises(RoomError):self.store.create()
        self.now=11
        with self.assertRaises(RoomError):self.store.access(self.host['room'],self.host['token'])
        self.store.create()
    def test_bad_invitation_and_large_sdp(self):
        with self.assertRaises(RoomError):self.store.join(self.host['room'],'wrong')
        with self.assertRaises(RoomError):self.store.access(self.host['room'],self.host['token'],{'type':'offer','sdp':'x'*60001})

class MemoryHandler(Handler):
    def respond(self,value,status=200):self.result=(status,value)

class ApiTests(unittest.TestCase):
    def setUp(self):
        self.server=SimpleNamespace(public_origin=None,allowed_hosts={'localhost:8788'},rooms=Rooms(),
            rate_lock=threading.Lock(),creators={},ice_servers=[])
    def request(self,path,body=None,headers=None):
        h=object.__new__(MemoryHandler)
        h.path=path;h.command='GET' if body is None else 'POST'
        h.server=self.server;h.client_address=('127.0.0.1',1)
        h.connection=SimpleNamespace(settimeout=lambda _:None)
        h.headers=Message();h.headers['Host']='localhost:8788'
        if body is not None:
            raw=json.dumps(body).encode();h.headers['Content-Type']='application/json';h.headers['Content-Length']=str(len(raw));h.rfile=io.BytesIO(raw)
        for key,value in (headers or {}).items():
            if key in h.headers:del h.headers[key]
            h.headers[key]=value
        h.api()
        return h.result
    def test_full_signaling_flow(self):
        status,host=self.request('/api/rooms',{})
        self.assertEqual(status,201)
        auth={'Authorization':'Bearer '+host['token']}
        self.assertEqual(self.request('/api/rooms/'+host['room'],{'description':{'type':'offer','sdp':'v=0'}},auth)[0],200)
        _,guest=self.request('/api/rooms/'+host['room'],{'invite':host['invite']})
        self.assertEqual(guest['player'],2)
        self.assertEqual(self.request('/api/rooms/'+host['room'],headers={'Authorization':'Bearer '+guest['token']})[1]['offer']['sdp'],'v=0')
    def test_origin_and_dns_rebinding_rejected(self):
        self.assertEqual(self.request('/api/config',headers={'Host':'attacker.example'})[0],403)
        self.assertEqual(self.request('/api/rooms',{},headers={'Origin':'https://attacker.example'})[0],403)
    def test_wrong_content_type_and_oversize_body(self):
        self.assertEqual(self.request('/api/rooms',{},headers={'Content-Type':'text/plain'})[0],415)
        self.assertEqual(self.request('/api/rooms',{},headers={'Content-Length':'999999'})[0],413)
    def test_room_creation_rate_limited(self):
        for _ in range(10):self.assertEqual(self.request('/api/rooms',{})[0],201)
        self.assertEqual(self.request('/api/rooms',{})[0],429)

if __name__=='__main__':unittest.main()
