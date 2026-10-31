"""One-time installation; never invoked by a browser request."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import urllib.request
import venv

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description='Install optional SAM 2.1 Small video segmentation')
parser.add_argument('--torch-index-url', default='https://download.pytorch.org/whl/cpu', help='Use the CUDA wheel index recommended for your system at pytorch.org/get-started/locally/')
args = parser.parse_args()
if sys.version_info < (3, 10):
    raise SystemExit('SAM 2 needs Python 3.10 or newer. Python 3.12 is recommended.')
folder = ROOT / '.venv-sam2'
if not folder.exists():
    venv.create(folder, with_pip=True)
python = folder / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
def pip(*arguments):
    env = dict(os.environ, SAM2_BUILD_CUDA='0')
    subprocess.run([str(python), '-m', 'pip', *arguments], check=True, env=env)
pip('install', '--upgrade', 'pip', 'setuptools', 'wheel')
pip('install', 'torch>=2.5.1', 'torchvision>=0.20.1', '--index-url', args.torch_index_url)
pip('install', '-r', str(ROOT / 'requirements-sam2.txt'))
destination = ROOT / 'models/sam2/sam2.1_hiera_small.pt'
destination.parent.mkdir(parents=True, exist_ok=True)
if not destination.is_file():
    temporary = destination.with_suffix('.download')
    print('Downloading the official SAM 2.1 Small checkpoint...')
    try:
        urllib.request.urlretrieve('https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt', temporary)
        # Load on CPU with weights_only to verify a real checkpoint before installation.
        subprocess.run([str(python), '-c', 'import torch,sys; x=torch.load(sys.argv[1], map_location="cpu", weights_only=True); assert "model" in x', str(temporary)], check=True)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
print('SAM 2.1 Small is installed. Restart start-windows.bat / start-mac-linux.sh.')
print('CPU mode works without an NVIDIA GPU, but can be slow. See docs/SEQUENCE_STUDIO.md for CUDA and WSL.')
