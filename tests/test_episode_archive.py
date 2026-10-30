import base64
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import episode_archive


class ArchiveTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        spec = importlib.util.spec_from_file_location('episode_test_server', ROOT / 'server.py')
        self.app = importlib.util.module_from_spec(spec)
        with mock.patch.object(sys, 'argv', ['server.py']):
            spec.loader.exec_module(self.app)
        self.app.DATA = self.temp.name + '/data'
        self.app.IMAGES = self.app.DATA + '/images'
        self.app.RESULTS = self.temp.name + '/results'
        self.blob = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB7sAAAAASUVORK5CYII=')
        self.put('blob','frame_a',self.blob,'image/png')
        self.put('files','frame_a',{'id':'frame_a','name':'a.png','patchW':3.4,'unit':'cm'})
        self.put('patches','frame_a',{'fileId':'frame_a','patches':[{'points':[[0,0],[1,0],[1,1]],'measurements':{'sArea':.5}}]})
        self.put('frameinfo','frame_a',{'fileId':'frame_a','timestamp':'2026-10-27T00:00:00Z','notes':'Keep this note','sensors':{'front':120}})
        self.put('projects','frame_a',{'format':'sector-map-outline-project','dashboardImageId':'frame_a','image':{'name':'a.png'},'episode':{'id':'ep_a'}})
        self.put('episodes','ep_a',{'id':'ep_a','name':'Session','notes':'Episode note','frames':['frame_a']})
        self.app.save_result({'image':{'id':'frame_a','name':'a.png'},'scope':'cell','area_shoelace':.5,'circles':[{'rank':1,'freq_k':1,'amplitude':2}],'cell_areas':[]},'tester')

    def put(self, store, rid, value, kind='application/json'):
        return self.app.store_request('PUT',[store,rid],value if isinstance(value,bytes) else json.dumps(value).encode(),kind)

    def get(self, store, rid):
        return json.loads(self.app.store_request('GET',[store,rid])[2])

    def test_backup_restore_roundtrip_preserves_content_and_existing_records(self):
        archive=episode_archive.export_episode(self.app,'ep_a')
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            original=json.loads(z.read('manifest.json'))
            self.assertEqual(original['frames'][0]['records']['frameinfo']['notes'],'Keep this note')
        result=episode_archive.restore_episode(self.app,archive,'restorer')
        ep=self.get('episodes',result['episode_id']);fid=ep['frames'][0]
        self.assertNotEqual(fid,'frame_a');self.assertEqual(self.get('episodes','ep_a')['frames'],['frame_a'])
        self.assertEqual(self.get('frameinfo',fid)['sensors']['front'],120)
        self.assertEqual(self.get('projects',fid)['dashboardImageId'],fid)
        self.assertEqual(self.app.store_request('GET',['blob',fid])[2],self.blob)
        rows=self.app.read_rows('measurements.csv');self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]['saved_at'],rows[1]['saved_at']);self.assertEqual(rows[0]['saved_by'],rows[1]['saved_by']);self.assertNotEqual(rows[0]['measurement_id'],rows[1]['measurement_id'])
        circles=self.app.read_rows('circles.csv');self.assertEqual(circles[1]['measurement_id'],rows[1]['measurement_id'])

    def test_invalid_archive_and_unsafe_paths_leave_workspace_untouched(self):
        before=self.app.read_rows('measurements.csv')
        with self.assertRaises(ValueError):episode_archive.restore_episode(self.app,b'not a zip','tester')
        archive=episode_archive.export_episode(self.app,'ep_a')
        with zipfile.ZipFile(io.BytesIO(archive)) as z:manifest=json.loads(z.read('manifest.json'))
        manifest['frames'][0]['image']='../outside.png';buf=io.BytesIO()
        with zipfile.ZipFile(buf,'w') as z:z.writestr('manifest.json',json.dumps(manifest));z.writestr('../outside.png',self.blob)
        with self.assertRaises(ValueError):episode_archive.restore_episode(self.app,buf.getvalue(),'tester')
        self.assertEqual(self.app.read_rows('measurements.csv'),before)
        self.assertEqual(self.get('episodes','ep_a')['frames'],['frame_a'])

    def test_failure_publishing_restore_rolls_back_database_and_images(self):
        archive=episode_archive.export_episode(self.app,'ep_a')
        before=set(Path(self.app.IMAGES).iterdir())
        with mock.patch('episode_archive.os.replace', side_effect=OSError('simulated disk failure')):
            with self.assertRaises(OSError):episode_archive.restore_episode(self.app,archive,'tester')
        self.assertEqual(set(Path(self.app.IMAGES).iterdir()),before)
        episodes=json.loads(self.app.store_request('GET',['episodes'])[2])['records'];self.assertEqual(len(episodes),1)
        self.assertEqual(len(self.app.read_rows('measurements.csv')),1)

    def test_failure_after_first_csv_publish_restores_original_history(self):
        archive=episode_archive.export_episode(self.app,'ep_a')
        original={name:Path(self.app.csv_path(name)).read_bytes() for name in self.app.FILES}
        before=set(Path(self.app.IMAGES).iterdir())
        replace=episode_archive.os.replace
        calls=[]
        def fail_late(source,dest):
            calls.append(dest)
            if len(calls)==4:
                raise OSError('simulated failure publishing circles')
            return replace(source,dest)
        with mock.patch('episode_archive.os.replace',side_effect=fail_late):
            with self.assertRaises(OSError):episode_archive.restore_episode(self.app,archive,'tester')
        self.assertEqual(set(Path(self.app.IMAGES).iterdir()),before)
        for name,data in original.items():self.assertEqual(Path(self.app.csv_path(name)).read_bytes(),data)
        self.assertEqual(len(json.loads(self.app.store_request('GET',['episodes'])[2])['records']),1)


if __name__=='__main__':unittest.main()
