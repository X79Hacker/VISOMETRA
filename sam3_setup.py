"""Download the authorized SAM 3 Transformers checkpoint, excluding the duplicate .pt file."""
from pathlib import Path
import sys

if sys.version_info < (3, 12):
    raise SystemExit("SAM 3 setup requires Python 3.12 or newer.")

from huggingface_hub import snapshot_download

destination = Path(__file__).resolve().parent / "models/sam3"
try:
    snapshot_download("facebook/sam3", local_dir=str(destination),
                      allow_patterns=["*.json", "*.txt", "*.safetensors", "LICENSE", "README.md"])
except Exception as exc:
    raise SystemExit("SAM 3 download failed. Request access at https://huggingface.co/facebook/sam3, "
                     "then run hf auth login in this environment and retry.\n" + str(exc)) from exc
print("SAM 3 checkpoint is ready. Restart Sector Map with start-windows.bat.")
