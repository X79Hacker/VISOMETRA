"""Optional real SAM 3 image inference. Imported lazily by the existing local server.

No model is downloaded during a request. Run setup-sam3-windows.bat first.
Only one SAM 3 model family is resident at a time, and inference is serialized.
"""
import base64
import gc
import importlib.util
import io
import math
import os
from pathlib import Path
import threading
import time

ROOT = Path(__file__).resolve().parent
MODEL_PATH = Path(os.environ.get("SAM3_MODEL_PATH", str(ROOT / "models/sam3")))
_lock = threading.Lock()
_engine = None


class SamError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def status():
    missing = [name for name in ("torch", "transformers", "accelerate", "PIL", "numpy")
               if importlib.util.find_spec(name) is None]
    weights = (MODEL_PATH / "config.json").is_file() and any(MODEL_PATH.glob("*.safetensors"))
    return {"available": not missing and weights, "installed": not missing,
            "weights_available": weights, "missing": missing, "model": "facebook/sam3",
            "loaded_mode": _engine.mode if _engine else None,
            "message": "SAM 3 is ready to load locally." if not missing and weights else
            "Run setup-sam3-windows.bat after requesting access to facebook/sam3. Fast offline mode works now."}


def validate_prompts(payload, width, height):
    mode = payload.get("mode", "tracker")
    if mode not in ("tracker", "concept"):
        raise SamError("Unknown SAM 3 mode.")
    points = payload.get("points") or []
    if not isinstance(points, list) or len(points) > 64:
        raise SamError("Use at most 64 prompt points.")
    clean = []
    for p in points:
        if not isinstance(p, dict):
            raise SamError("Invalid point.")
        try:
            x, y, label = float(p["x"]), float(p["y"]), int(p["label"])
        except (KeyError, TypeError, ValueError, OverflowError):
            raise SamError("Invalid point.")
        if not all(map(math.isfinite, (x, y))) or not (0 <= x < width and 0 <= y < height) or label not in (0, 1):
            raise SamError("Prompt points must lie inside the image and have label 0 or 1.")
        clean.append({"x": x, "y": y, "label": label})
    box = payload.get("box")
    if box is not None:
        try:
            box = [float(box[k]) for k in ("x1", "y1", "x2", "y2")]
        except (KeyError, TypeError, ValueError):
            raise SamError("Invalid box.")
        if not all(map(math.isfinite, box)) or not (0 <= box[0] < box[2] <= width and 0 <= box[1] < box[3] <= height):
            raise SamError("Draw a nonempty box inside the image.")
    text = str(payload.get("text") or "").strip()
    if len(text) > 200:
        raise SamError("Keep the text prompt below 200 characters.")
    if mode == "tracker" and not clean and box is None:
        raise SamError("Add an include point or draw a box.")
    if mode == "concept" and not text and box is None:
        raise SamError("Enter a short object description or draw an exemplar box.")
    if mode == "concept" and clean:
        raise SamError("Text/exemplar mode uses text and boxes. Use SAM 3 points/box mode for clicks.")
    return mode, clean, box, text


def encode_mask(mask):
    import numpy as np
    flat = np.asarray(mask, dtype=np.uint8).reshape(-1)
    changes = np.flatnonzero(flat[1:] != flat[:-1]) + 1
    counts = np.diff(np.concatenate(([0], changes, [len(flat)]))).tolist()
    if len(flat) and flat[0]:
        counts.insert(0, 0)
    return {"width": int(mask.shape[-1]), "height": int(mask.shape[-2]), "counts": counts}


class Engine:
    def __init__(self, mode):
        import torch
        from transformers import Sam3Model, Sam3Processor, Sam3TrackerModel, Sam3TrackerProcessor
        self.mode = mode
        self.torch = torch
        self.cuda = torch.cuda.is_available()
        kwargs = {"local_files_only": True, "low_cpu_mem_usage": True}
        if self.cuda:
            total = torch.cuda.get_device_properties(0).total_memory
            # Reserve space for activations, the desktop, and the browser on an 8 GB GPU.
            budget = max(1, min(5, int(total / 1024**3) - 2))
            kwargs.update(dtype=torch.float32, device_map="auto",
                          max_memory={0: f"{budget}GiB", "cpu": "10GiB"},
                          offload_folder=str(ROOT / "models/offload"))
        else:
            kwargs.update(dtype=torch.float32, device_map="cpu")
        model_class, processor_class = ((Sam3TrackerModel, Sam3TrackerProcessor) if mode == "tracker"
                                        else (Sam3Model, Sam3Processor))
        self.processor = processor_class.from_pretrained(str(MODEL_PATH), local_files_only=True)
        self.model = model_class.from_pretrained(str(MODEL_PATH), **kwargs).eval()

    def predict(self, image, points, box, text, threshold):
        torch = self.torch
        args = {"images": image, "return_tensors": "pt"}
        if self.mode == "tracker":
            if points:
                args.update(input_points=[[[[p["x"], p["y"]] for p in points]]],
                            input_labels=[[[p["label"] for p in points]]])
            if box is not None:
                args["input_boxes"] = [[box]]
        else:
            if text:
                args["text"] = text
            if box is not None:
                args.update(input_boxes=[[box]], input_boxes_labels=[[1]])
        inputs = self.processor(**args).to(self.model.device)
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16, enabled=self.cuda):
            output = self.model(**inputs)
        if self.mode == "tracker":
            masks = self.processor.post_process_masks(output.pred_masks.cpu(), inputs["original_sizes"].cpu())[0]
            scores = output.iou_scores.detach().float().cpu().reshape(-1)
            best = int(scores.argmax())
            selected = masks.reshape(-1, image.height, image.width)[best].numpy().astype(bool)
            return [(selected, float(scores[best]))]
        instances = self.processor.post_process_instance_segmentation(
            output, threshold=threshold, mask_threshold=0.5,
            target_sizes=inputs["original_sizes"].tolist())[0]
        pairs = []
        order = instances["scores"].argsort(descending=True)[:8]
        for i in order:
            pairs.append((instances["masks"][i].detach().cpu().numpy().astype(bool),
                          float(instances["scores"][i].detach().cpu())))
        return pairs


def segment(payload):
    global _engine
    if not isinstance(payload, dict):
        raise SamError("Expected a JSON object.")
    available = status()
    if not available["available"]:
        raise SamError(available["message"], 503)
    from PIL import Image, UnidentifiedImageError
    try:
        encoded = payload["image"]
        if not isinstance(encoded, str) or len(encoded) > 16_000_000:
            raise SamError("Image payload is too large.", 413)
        raw = base64.b64decode(encoded.split(",", 1)[-1], validate=True)
        image = Image.open(io.BytesIO(raw))
        if image.width * image.height > 12_000_000 or max(image.size) > 4096:
            raise SamError("Use an image at most 4096 px per side and 12 megapixels.", 413)
        image = image.convert("RGB")
    except (KeyError, ValueError, UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise SamError("Could not decode the image.")
    mode, points, box, text = validate_prompts(payload, image.width, image.height)
    try:
        threshold = float(payload.get("threshold", 0.5))
    except (TypeError, ValueError):
        raise SamError("Invalid confidence threshold.")
    if not math.isfinite(threshold) or not 0.05 <= threshold <= 0.95:
        raise SamError("Confidence threshold must be between 0.05 and 0.95.")
    if not _lock.acquire(blocking=False):
        raise SamError("Another SAM 3 request is running. Wait for it to finish.", 409)
    started = time.perf_counter()
    try:
        if _engine is None or _engine.mode != mode:
            _engine = None
            gc.collect()
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            _engine = Engine(mode)
        pairs = _engine.predict(image, points, box, text, threshold)
        if not pairs:
            raise SamError("No matching object found. Try a simpler text prompt or a tighter box.", 422)
        return {"engine": "SAM 3 Tracker" if mode == "tracker" else "SAM 3 Concept",
                "device": "CUDA with CPU offload if needed" if _engine.cuda else "CPU",
                "width": image.width, "height": image.height,
                "elapsed": (time.perf_counter() - started) * 1000,
                "masks": [{"mask": encode_mask(mask), "score": score} for mask, score in pairs]}
    except SamError:
        raise
    except Exception as exc:
        if "out of memory" in str(exc).lower():
            _engine = None
            gc.collect()
            raise SamError("SAM 3 ran out of memory. Close other GPU apps or select Fast offline (SlimSAM).", 503) from exc
        raise SamError("SAM 3 could not run. Check setup and model compatibility in docs/SAM3_SETUP.md. "
                       + str(exc)[:250], 503) from exc
    finally:
        _lock.release()
