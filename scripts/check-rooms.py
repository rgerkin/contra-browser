import io
import json
from email.message import Message
from types import SimpleNamespace
import threading
import unittest
from rooms import Rooms, RoomError
from serve import Handler, WEB

class PrivateAssetTests(unittest.TestCase):
    def test_network_hosts_cannot_fetch_private_builds_or_encoded_variants(self):
        class DenyHandler(Handler):
            def send_error(self,code,*args):self.code=code
        for method in ('do_GET','do_HEAD'):
            for path in ('/game/contra.nes','/game/manifest.json','/%67ame/contra.nes','/x/../game/contra.nes'):
                h=object.__new__(DenyHandler);h.path=path;h.directory=str(WEB)
                h.server=SimpleNamespace(share_game=False)
                getattr(h,method)();self.assertIn(h.code,(403,404))

    def test_opted_in_cartridge_download_and_head(self):
        class CaptureHandler(Handler):
            def send_response(self,code):self.code=code
            def send_header(self,name,value):self.captured[name]=value
            def end_headers(self):pass
        assets={'/game/contra.nes':('application/octet-stream',b'local cartridge fixture'),
                '/game/manifest.json':('application/json',b'{"rebuilt":false}')}
        for method in ('GET','HEAD'):
            for path,(content_type,data) in assets.items():
                h=object.__new__(CaptureHandler);h.path=path+'?v=1';h.command=method
                h.server=SimpleNamespace(shared_cartridge=assets,share_game=False)
                h.captured={};h.wfile=io.BytesIO()
                getattr(h,'do_'+method)()
                self.assertEqual(h.code,200)
                self.assertEqual(h.captured['Content-Type'],content_type)
                self.assertEqual(h.captured['Content-Length'],str(len(data)))
                self.assertEqual(h.wfile.getvalue(),data if method=='GET' else b'')
        h.path='/game/other.nes';self.assertFalse(h.serve_shared_cartridge())

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

class PartyTests(unittest.TestCase):
    def test_two_player_hello_is_queued_before_guest_claim(self):
        store=Rooms();host=store.create();store.enable_relay(host['room'],host['token'])
        store.send(host['room'],host['token'],['hello'])
        guest=store.join(host['room'],host['invite'])
        self.assertEqual(store.read(host['room'],guest['token'],timeout=0),[{'from':1,'data':'hello'}])

    def test_four_authenticated_slots_broadcast_once_without_echo(self):
        store=Rooms();host=store.create(4)
        peers=[host]+[store.join(host['room'],host['invite']) for _ in range(3)]
        self.assertEqual([p['player'] for p in peers],[1,2,3,4])
        with self.assertRaises(RoomError):store.join(host['room'],host['invite'])
        for peer in peers:store.send(host['room'],peer['token'],[str(peer['player'])])
        for peer in peers:
            events=store.read(host['room'],peer['token'],timeout=0)
            self.assertEqual({e['from'] for e in events},set(range(1,5))-{peer['player']})
            self.assertEqual(len(events),3)
        state=store.access(host['room'],peers[3]['token'])
        self.assertEqual(state['roster'],[1,2,3,4]);self.assertTrue(state['relay'])
        self.assertNotIn('tokens',state)
    def test_bad_party_sizes_and_atomic_backpressure(self):
        store=Rooms()
        for size in [True,0,1,5,'4',None]:
            with self.assertRaises(RoomError):store.create(size)
        host=store.create(3);p2=store.join(host['room'],host['invite']);p3=store.join(host['room'],host['invite'])
        for _ in range(16):store.send(host['room'],host['token'],['a']*16)
        store.read(host['room'],p2['token'],timeout=0)
        with self.assertRaises(RoomError):store.send(host['room'],host['token'],['rejected'])
        events=store.read(host['room'],p2['token'],timeout=0)
        self.assertTrue(all(e['data']!='rejected' for e in events))

class RelayTests(unittest.TestCase):
    def setUp(self):
        self.store=Rooms();self.host=self.store.create()
        self.guest=self.store.join(self.host['room'],self.host['invite'])
        self.store.enable_relay(self.host['room'],self.host['token'])
    def test_only_partner_receives_messages_with_trusted_sender(self):
        self.store.send(self.host['room'],self.host['token'],['hello','input'])
        self.assertEqual(self.store.read(self.host['room'],self.host['token'],timeout=0),[])
        events=self.store.read(self.host['room'],self.guest['token'],timeout=0)
        self.assertEqual(events,[{'from':1,'data':'hello'},{'from':1,'data':'input'}])
        self.assertEqual(self.store.read(self.host['room'],self.guest['token'],timeout=0),[])
    def test_relay_uses_room_credentials(self):
        with self.assertRaises(RoomError):self.store.send(self.host['room'],'wrong',['input'])
        with self.assertRaises(RoomError):self.store.read(self.host['room'],'wrong',timeout=0)
    def test_queue_and_message_size_bounds(self):
        with self.assertRaises(RoomError):self.store.send(self.host['room'],self.host['token'],['x'*4097])
        for _ in range(16):self.store.send(self.host['room'],self.host['token'],['input']*16)
        with self.assertRaises(RoomError):self.store.send(self.host['room'],self.host['token'],['overflow'])
    def test_one_stream_per_player_and_clean_close(self):
        self.store.open_stream(self.host['room'],self.host['token'])
        with self.assertRaises(RoomError):self.store.open_stream(self.host['room'],self.host['token'])
        self.store.close_stream(self.host['room'],self.host['token'])
        self.store.open_stream(self.host['room'],self.host['token'])

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
