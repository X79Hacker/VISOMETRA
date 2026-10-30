"""SAM 2.1 propagation worker. No service, network downloads, or identity guarantees."""
import contextlib
import gc
import json
import os
from pathlib import Path
import sys


def write(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value), encoding='utf-8')
    temporary.replace(path)


def decode(encoded):
    import numpy as np
    values = np.arange(len(encoded['counts'])) % 2
    return np.repeat(values.astype(np.uint8), encoded['counts']).reshape(encoded['height'], encoded['width']).astype(bool)


def encode(mask):
    import numpy as np
    flat = np.asarray(mask, dtype=np.uint8).reshape(-1)
    changes = np.flatnonzero(flat[1:] != flat[:-1]) + 1
    counts = np.diff(np.concatenate(([0], changes, [len(flat)]))).tolist()
    if flat.size and flat[0]:
        counts.insert(0, 0)
    return {'width': mask.shape[1], 'height': mask.shape[0], 'counts': counts}


def propagate(predictor, state, manifest, directory):
    """Separate from model construction so the official API contract is testable."""
    for seed in manifest['seeds']:
        predictor.add_new_mask(state, frame_idx=seed['frame'], obj_id=1, mask=decode(seed['mask']))
    for index, obj_ids, logits in predictor.propagate_in_video(state, start_frame_idx=0):
        mask = (logits[list(obj_ids).index(1), 0] > 0).detach().cpu().numpy()
        value = {'frame': index, 'id': manifest['frames'][index]['id'], 'mask': encode(mask),
                 'target_id': manifest['target_id'], 'visibility': 'visible' if mask.any() else 'unknown',
                 'provenance': {'engine': 'SAM 2.1 video memory', 'model': 'SAM 2.1 Small', 'object_id': 1,
                                'identity_verified': False}, 'review': 'needs review'}
        write(directory / 'results' / (str(index).zfill(6) + '.json'), value)
        write(directory / 'status.json', {'state': 'running', 'completed': index + 1})


def run(directory):
    directory = Path(directory)
    state = None
    try:
        write(directory / 'status.json', {'state': 'loading', 'completed': 0})
        import numpy as np
        import torch
        from PIL import Image, ImageOps
        from sam2.build_sam import build_sam2_video_predictor
        manifest = json.loads((directory / 'manifest.json').read_text())
        # Official predictor accepts an ordered JPEG folder. Validate all dimensions
        # before loading SAM's inference state; original images remain unchanged.
        for i in range(len(manifest['frames'])):
            source = directory / 'frames' / (str(i).zfill(6) + '.source')
            with Image.open(source) as image:
                if image.width * image.height > 12000000:
                    raise ValueError('Frame exceeds 12 megapixels.')
                image = ImageOps.exif_transpose(image).convert('RGB')
                if image.size != (manifest['width'], manifest['height']):
                    raise ValueError('All tracking frames must have the same resolution.')
                image.save(directory / 'frames' / (str(i).zfill(6) + '.jpg'), quality=97, subsampling=0)
            source.unlink()
        root = Path(__file__).resolve().parent
        checkpoint = os.environ.get('SAM2_CHECKPOINT', str(root / 'models/sam2/sam2.1_hiera_small.pt'))
        config = os.environ.get('SAM2_CONFIG', 'configs/sam2.1/sam2.1_hiera_s.yaml')
        device = os.environ.get('SAM2_DEVICE', 'cuda' if torch.cuda.is_available() else 'cpu')
        predictor = build_sam2_video_predictor(config, checkpoint, device=device, apply_postprocessing=False)
        with torch.inference_mode(), (torch.autocast('cuda', dtype=torch.bfloat16) if device.startswith('cuda') and torch.cuda.is_bf16_supported() else contextlib.nullcontext()):
            state = predictor.init_state(str(directory / 'frames'), offload_video_to_cpu=True, offload_state_to_cpu=True)
            propagate(predictor, state, manifest, directory)
        write(directory / 'status.json', {'state': 'complete', 'completed': len(manifest['frames'])})
    except Exception as exc:
        write(directory / 'status.json', {'state': 'failed', 'error': str(exc)[:1000]})
        raise
    finally:
        del state
        gc.collect()


if __name__ == '__main__':
    run(sys.argv[1])
