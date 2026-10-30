"""Optional SAM 2.1 jobs. Images stay local; inference runs in its own Python env.

The HTTP server remains usable while a serialized worker propagates masks.
No weights or packages are downloaded during HTTP requests.
"""
import base64
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parent
MAX_FRAMES = 500
MAX_BYTES = 512 * 1024 * 1024
_jobs = {}
_lock = threading.RLock()


class TrackingError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def python_path():
    configured = os.environ.get('SAM2_PYTHON')
    if configured:
        return Path(configured)
    base = ROOT / '.venv-sam2'
    return base / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def status():
    model = Path(os.environ.get('SAM2_CHECKPOINT', str(ROOT / 'models/sam2/sam2.1_hiera_small.pt')))
    python = python_path()
    return {'available': python.is_file() and model.is_file(), 'installed': python.is_file(),
            'weights_available': model.is_file(), 'model': 'SAM 2.1 Small',
            'message': 'Ready for selected-object video segmentation.' if python.is_file() and model.is_file()
            else 'Run setup-sam2-windows.bat (or setup-sam2.sh) once. See docs/SEQUENCE_STUDIO.md.',
            'max_frames': MAX_FRAMES, 'max_source_bytes': MAX_BYTES}


def encode_json(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data), encoding='utf-8')
    temporary.replace(path)


def validate_mask(value, width, height):
    if not isinstance(value, dict) or value.get('width') != width or value.get('height') != height:
        raise TrackingError('Seed mask dimensions do not match the images.')
    counts = value.get('counts')
    if not isinstance(counts, list) or len(counts) > width * height + 1:
        raise TrackingError('Invalid seed RLE.')
    if any(type(n) is not int or n < 0 for n in counts) or sum(counts) != width * height:
        raise TrackingError('Invalid seed RLE counts.')
    if not sum(counts[1::2]):
        raise TrackingError('Select a nonempty target in the starting frame.')


def validate_manifest(payload):
    frames = payload.get('frames')
    if not isinstance(frames, list) or not 2 <= len(frames) <= MAX_FRAMES:
        raise TrackingError('Choose 2–500 consecutive frames for SAM 2 tracking.')
    width, height = payload.get('width'), payload.get('height')
    if type(width) is not int or type(height) is not int or min(width, height) < 1 or width * height > 12000000 or max(width, height) > 12000:
        raise TrackingError('Use images up to 12 megapixels and 12,000 pixels per side.')
    # 1024-square frames alone require about 12 MiB each in the official loader.
    # A configurable explicit bound prevents an unnoticed multi-gigabyte allocation.
    limit = int(os.environ.get('SAM2_MAX_FRAMES_PER_JOB', '120'))
    if len(frames) > min(MAX_FRAMES, max(2, limit)):
        raise TrackingError('This backend is configured for '+str(limit)+' frames per run. Track in overlapping chunks; use the final corrected frame as the next seed.')
    ids = []
    for f in frames:
        if not isinstance(f, dict) or not isinstance(f.get('id'), str) or not f['id'] or len(f['id']) > 160:
            raise TrackingError('Invalid frame identifier.')
        ids.append(f['id'])
    if len(set(ids)) != len(ids):
        raise TrackingError('Duplicate frames in tracking request.')
    seeds = payload.get('seeds')
    if not isinstance(seeds, list) or not seeds or len(seeds) > len(frames):
        raise TrackingError('A corrected first-frame mask is required.')
    seen = set()
    for seed in seeds:
        i = seed.get('frame')
        if type(i) is not int or not 0 <= i < len(frames) or i in seen:
            raise TrackingError('Invalid correction frame.')
        seen.add(i)
        validate_mask(seed.get('mask'), width, height)
    if 0 not in seen:
        raise TrackingError('The first frame needs a selected target mask.')
    target = str(payload.get('target_id') or '')
    if not target or len(target) > 100:
        raise TrackingError('Choose a named target.')
    return {'frames': frames, 'width': width, 'height': height, 'seeds': seeds,
            'target_id': target, 'model': 'SAM 2.1 Small'}


def _lookup(job_id, owner):
    job = _jobs.get(job_id)
    if not job or job['owner'] != owner:
        raise TrackingError('Tracking job not found.', 404)
    return job


def _cleanup():
    for key, job in list(_jobs.items()):
        proc = job.get('process')
        if time.time() - job['created'] > 3600 and (not proc or proc.poll() is not None):
            shutil.rmtree(job['directory'], ignore_errors=True)
            del _jobs[key]


def create(payload, owner):
    manifest = validate_manifest(payload)
    if not status()['available']:
        raise TrackingError(status()['message'], 503)
    with _lock:
        _cleanup()
        if any(j.get('process') and j['process'].poll() is None for j in _jobs.values()):
            raise TrackingError('Another SAM 2 job is running. Stop it or wait for completion.', 409)
        if sum(j['owner'] == owner for j in _jobs.values()) >= 8:
            raise TrackingError('Remove or cancel older tracking jobs before starting another.', 409)
        job_id = secrets.token_hex(16)
        directory = Path(tempfile.mkdtemp(prefix='sector-map-tracking-'))
        (directory / 'frames').mkdir()
        (directory / 'results').mkdir()
        encode_json(directory / 'manifest.json', manifest)
        _jobs[job_id] = {'owner': owner, 'directory': directory, 'manifest': manifest,
                         'created': time.time(), 'uploaded': set(), 'bytes': 0, 'process': None}
        return {'id': job_id, 'count': len(manifest['frames'])}


def upload(job_id, owner, payload):
    with _lock:
        job = _lookup(job_id, owner)
        if job.get('process'):
            raise TrackingError('This job has already started.', 409)
        i = payload.get('frame')
        if type(i) is not int or not 0 <= i < len(job['manifest']['frames']) or i in job['uploaded']:
            raise TrackingError('Invalid or duplicate upload index.')
        value = payload.get('image')
        if not isinstance(value, str) or not value.startswith(('data:image/png;base64,', 'data:image/jpeg;base64,', 'data:image/webp;base64,')):
            raise TrackingError('Upload an embedded PNG, JPEG or WebP.')
        try:
            body = base64.b64decode(value.split(',', 1)[1], validate=True)
        except (ValueError, TypeError):
            raise TrackingError('Invalid image encoding.')
        if len(body) > 25 * 1024 * 1024 or job['bytes'] + len(body) > MAX_BYTES:
            raise TrackingError('Tracking uploads exceed the 25 MB/image or 512 MB/job limit.', 413)
        # Pillow is intentionally required only by the separate worker. Preserve original
        # bytes here and validate/decode all images there before allocating model state.
        (job['directory'] / 'frames' / (str(i).zfill(6) + '.source')).write_bytes(body)
        job['uploaded'].add(i)
        job['bytes'] += len(body)
        return {'uploaded': len(job['uploaded'])}


def start(job_id, owner):
    with _lock:
        job = _lookup(job_id, owner)
        if job.get('process'):
            raise TrackingError('Job already started.', 409)
        if len(job['uploaded']) != len(job['manifest']['frames']):
            raise TrackingError('Upload every selected frame before starting.')
        if any(j.get('process') and j['process'].poll() is None for j in _jobs.values()):
            raise TrackingError('Another SAM 2 job is running.', 409)
        log = open(job['directory'] / 'worker.log', 'wb')
        try:
            job['process'] = subprocess.Popen([str(python_path()), str(ROOT / 'tracking_worker.py'), str(job['directory'])],
                                              cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        finally:
            log.close()
        return {'started': True}


def poll(job_id, owner, after=0):
    with _lock:
        job = _lookup(job_id, owner)
        after = max(0, min(len(job['manifest']['frames']), int(after)))
        directory = job['directory']
        state = json.loads((directory / 'status.json').read_text()) if (directory / 'status.json').exists() else {'state': 'starting', 'completed': 0}
        results = []
        for i in range(after, min(after + 2, len(job['manifest']['frames']))):
            path = directory / 'results' / (str(i).zfill(6) + '.json')
            if not path.is_file():
                break
            results.append(json.loads(path.read_text()))
        proc = job.get('process')
        if proc and proc.poll() is not None and state.get('state') not in ('complete', 'failed', 'cancelled'):
            state.update(state='failed', error='SAM 2 worker exited. Check Python/PyTorch/model setup and available memory. See tracking worker log in the app console.')
        return {**state, 'results': results, 'next': after + len(results), 'total': len(job['manifest']['frames'])}


def cancel(job_id, owner):
    with _lock:
        job = _lookup(job_id, owner)
        proc = job.get('process')
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=3)
        encode_json(job['directory'] / 'status.json', {'state': 'cancelled'})
        shutil.rmtree(job['directory'], ignore_errors=True)
        del _jobs[job_id]
        return {'cancelled': True}
