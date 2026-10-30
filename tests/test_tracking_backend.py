import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import tracking_backend as backend
import tracking_worker as worker


def manifest():
    return {'width': 3, 'height': 2, 'frames': [{'id': 'a'}, {'id': 'b'}],
            'seeds': [{'frame': 0, 'mask': {'width': 3, 'height': 2, 'counts': [0, 1, 5]}}], 'target_id': 'person-a'}


class TrackingTests(unittest.TestCase):
    def tearDown(self):
        for key, job in list(backend._jobs.items()):
            backend.cancel(key, job['owner'])

    def test_rejects_invalid_or_empty_seed_and_duplicate_frames(self):
        self.assertEqual(backend.validate_manifest(manifest())['target_id'], 'person-a')
        for counts in ([6], [0, -1, 7], [0, 1.5, 4.5], [0, 1, 4], [True, 5]):
            data = manifest(); data['seeds'][0]['mask']['counts'] = counts
            with self.assertRaises(backend.TrackingError): backend.validate_manifest(data)
        data = manifest(); data['frames'][1]['id'] = 'a'
        with self.assertRaises(backend.TrackingError): backend.validate_manifest(data)
        data = manifest(); data['seeds'][0]['frame'] = 1
        with self.assertRaises(backend.TrackingError): backend.validate_manifest(data)

    def test_jobs_are_owned_uploads_bounded_and_missing_images_cannot_start(self):
        with patch.object(backend, 'status', return_value={'available': True}):
            job = backend.create(manifest(), 'alice')['id']
        with self.assertRaises(backend.TrackingError): backend.poll(job, 'bob')
        with self.assertRaises(backend.TrackingError): backend.start(job, 'alice')
        backend.upload(job, 'alice', {'frame': 0, 'image': 'data:image/png;base64,AAAA'})
        with self.assertRaises(backend.TrackingError): backend.upload(job, 'alice', {'frame': 0, 'image': 'data:image/png;base64,AAAA'})
        self.assertEqual(backend.poll(job, 'alice')['next'], 0)
        path = backend._jobs[job]['directory']; backend.cancel(job, 'alice'); self.assertFalse(path.exists())

    @unittest.skipUnless(importlib.util.find_spec('numpy'), 'numpy required for tensor contract test')
    def test_official_predictor_contract_preserves_target_and_order(self):
        import numpy as np
        class Tensor:
            def __init__(self, value): self.value = np.array(value)
            def __getitem__(self, value): return Tensor(self.value[value])
            def __gt__(self, value): return Tensor(self.value > value)
            def detach(self): return self
            def cpu(self): return self
            def numpy(self): return self.value
        class Predictor:
            def __init__(self): self.seeds = []
            def add_new_mask(self, state, **kwargs): self.seeds.append(kwargs)
            def propagate_in_video(self, state, start_frame_idx):
                self_start = start_frame_idx
                assert self_start == 0
                yield 0, [1], Tensor([[[[1, -1, -1], [-1, -1, -1]]]])
                yield 1, [1], Tensor([[[[-1, 1, -1], [-1, -1, -1]]]])
        with tempfile.TemporaryDirectory() as d:
            directory = Path(d); (directory / 'results').mkdir(); p = Predictor()
            worker.propagate(p, {}, manifest(), directory)
            a = json.loads((directory / 'results/000000.json').read_text()); b = json.loads((directory / 'results/000001.json').read_text())
            self.assertEqual(a['target_id'], 'person-a'); self.assertEqual(b['id'], 'b'); self.assertEqual(b['mask']['counts'], [1, 1, 4]); self.assertEqual(p.seeds[0]['obj_id'], 1)
            self.assertFalse(b['provenance']['identity_verified'])


if __name__ == '__main__': unittest.main()
