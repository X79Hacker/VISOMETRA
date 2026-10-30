import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import http.cookiejar

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import sam_backend


class PromptsTest(unittest.TestCase):
    def test_real_prompt_contract_and_invalid_coordinates(self):
        mode, points, box, text = sam_backend.validate_prompts({"points": [{"x": 10, "y": 5, "label": 1}], "box": {"x1": 0, "y1": 0, "x2": 80, "y2": 40}}, 100, 50)
        self.assertEqual(mode, "tracker")
        self.assertEqual(box, [0, 0, 80, 40])
        for payload in ({"points": [{"x": float('nan'), "y": 5, "label": 1}]}, {"points": [{"x": 101, "y": 5, "label": 1}]}, {"mode": "concept", "text": "leaf", "points": points}):
            with self.assertRaises(sam_backend.SamError):
                sam_backend.validate_prompts(payload, 100, 50)
        self.assertEqual(sam_backend.validate_prompts({"mode": "concept", "text": "leaf"}, 100, 50)[3], "leaf")

    @unittest.skipUnless(importlib.util.find_spec("numpy"), "NumPy optional for the base app")
    def test_rle_roundtrip_preserves_foreground_at_the_first_pixel(self):
        import numpy as np
        encoded = sam_backend.encode_mask(np.array([[1, 1, 0], [0, 1, 1]], dtype=bool))
        self.assertEqual(encoded, {"width": 3, "height": 2, "counts": [0, 2, 2, 2]})


class RoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        import socket
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            cls.port = sock.getsockname()[1]
        env = dict(os.environ, SECTOR_MAP_DATA_DIR=cls.temp.name+'/data', SECTOR_MAP_RESULTS_DIR=cls.temp.name+'/results', SITE_USERS='tester:test-password', SAM3_MODEL_PATH=cls.temp.name+'/missing-model')
        cls.process = subprocess.Popen([sys.executable, str(ROOT/'server.py'), str(cls.port), '--no-browser'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        cls.base = f'http://127.0.0.1:{cls.port}'
        for _ in range(50):
            try:
                urllib.request.urlopen(cls.base+'/login.html', timeout=1).close()
                break
            except OSError:
                time.sleep(.1)
        else:
            raise RuntimeError('Test server did not start')

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.communicate(timeout=5)
        cls.temp.cleanup()

    def test_authentication_and_honest_missing_model_response(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(self.base+'/api/sam/status')
        self.assertEqual(error.exception.code, 401)
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        body = json.dumps({'username':'tester','password':'test-password'}).encode()
        opener.open(urllib.request.Request(self.base+'/api/login',data=body,headers={'Content-Type':'application/json'})).close()
        with opener.open(self.base+'/api/sam/status') as response:
            state=json.load(response)
        self.assertFalse(state['available'])
        request=urllib.request.Request(self.base+'/api/sam/segment',data=b'{}',headers={'Content-Type':'application/json'})
        with self.assertRaises(urllib.error.HTTPError) as error:
            opener.open(request)
        self.assertEqual(error.exception.code,503)
        self.assertIn('setup-sam3-windows.bat',json.load(error.exception)['error'])
        with opener.open(self.base+'/api/me') as response:
            self.assertEqual(json.load(response)['user'],'tester')

    def test_real_store_preserves_ai_geometry_and_serves_worker_assets(self):
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        body=json.dumps({'username':'tester','password':'test-password'}).encode()
        opener.open(urllib.request.Request(self.base+'/api/login',data=body,headers={'Content-Type':'application/json'})).close()
        record={'fileId':'sam-test','nodes':[{'p':[0,0],'hi':[0,0],'ho':[0,0],'mode':'corner','line':True},{'p':[8000,0],'hi':[8000,0],'ho':[8000,0],'mode':'corner','line':True},{'p':[0,8000],'hi':[0,8000],'ho':[0,8000],'mode':'corner','line':True}], 'closed':True,'finished':False,'samMeta':{'engine':'SlimSAM','width':410,'height':410,'tolerance':1}}
        request=urllib.request.Request(self.base+'/api/store/traces/sam-test',method='PUT',data=json.dumps(record).encode(),headers={'Content-Type':'application/json'})
        opener.open(request).close()
        with opener.open(self.base+'/api/store/traces/sam-test') as response:
            self.assertEqual(json.load(response),record)
        with opener.open(self.base+'/sam-bundle/engine.js') as response:
            self.assertIn('javascript',response.headers['Content-Type'])
            self.assertIn(b'/sam-bundle/assets/',response.read())
        with opener.open(self.base+'/runtime/ort-wasm-simd-threaded.jsep.wasm') as response:
            self.assertEqual(response.headers['Content-Type'],'application/wasm')
            self.assertEqual(response.read(4),b'\x00asm')


if __name__ == '__main__':
    unittest.main()
