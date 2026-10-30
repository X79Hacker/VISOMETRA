# Outline Studio V3

Read `START_HERE.txt` for Windows launch instructions. Start the same local Python server, then open `http://127.0.0.1:8763/outline-studio.html`. Dashboard has both a global Studio button and an image-specific Studio button.

## Text → SAM → closed contours → Fourier

Bundled text mode runs **Xenova/clipseg-rd64-refined q8** on WebAssembly CPU. A short description produces a coarse semantic proposal. Up to eight largest proposal components are converted into a bounding box and a high-response Include point. The included **SlimSAM q8** model refines each proposal. Their masks are combined and can be reviewed, isolated by connected region, corrected or cleaned up. The app reports if more than eight text regions were found. The display names the actual models; this is not disguised as SAM 3.

The first run reads the bundled model files from your local server. Models never download from an external host during inference. No API key, GPU installation or Hugging Face login is needed for bundled text or point mode. This is an object-description interface, not an LLM chat agent. “Bench”, “person”, or “red cup” are appropriate prompts. Relational instructions, precise instance selection and unfamiliar objects can fail. Lower the text threshold or use the included point/box mode when needed. A model confidence/response is not a measured accuracy value.

The optional **SAM 3 text** and **SAM 3 points** modes use the existing authenticated Python backend. They require the separate installation and authorized weights in `SAM3_SETUP.md`. Real SAM 3 inference was not executed in this environment.

## Editing and original image coordinates

- PNG, JPEG and WebP uploads retain the full image, up to 12 megapixels and 12,000 pixels per side. No centered square crop is imposed in Studio. The models internally resize their input; output dimensions do not establish native-resolution model accuracy.
- Search crop is a non-destructive region of interest for inference. The mask is mapped back into the full image. CSV/JSON/SVG/project exports retain the original top-left origin, x rightward and y downward. Clear crop searches the full image again.
- Paint/Erase edits the binary mask directly; brush radius is measured in original image pixels. Up to eight mask/prompt/crop edits can be undone/redone. Editing a reference uses a separate mask.
- Cleanup can remove small disconnected islands, close gaps and optionally fill enclosed holes up to a chosen pixel count. Hole filling is off by default. Undo restores the previous mask.
- Boundary extraction uses directed pixel edges, retaining closed outer loops, internal holes and disconnected objects. Simplification and optional Chaikin smoothing change the measurement polygon; the UI explicitly reports its area change relative to the mask. Smoothing is off by default.
- Calibration uses a drawn pixel length and its known real length. Use an appropriate image scale: a single calibration cannot correct perspective distortion or lens distortion.

## Fourier and validation metrics

Every closed loop receives an independent complex Fourier series, parameterized by normalized arc length. Coefficients are integrated analytically over each straight segment. The UI uses all frequencies from −K to +K (plus the constant term), unlike the legacy amplitude-ranked circle-count control. Separate objects are never connected by artificial bridge segments.

Image coordinates have y downward. The signed pixel-edge orientation makes outer loops add area and holes subtract area. Net selected polygon area is the sum of the signed loop areas. Fourier area is `π Σ k |c_k|²`, summed across loops with their original orientation. Reconstruction is sampled at 512 equal parameter positions per loop. RMS error compares each reconstruction point with the selected polygon at the same arc parameter; the displayed maximum error is a sampled maximum, not an exact Hausdorff distance. These are approximation errors relative to the selected polygon, not segmentation accuracy.

Fourier permits up to 256 contours and 30,000 vertices. More complex masks must be cleaned or simplified explicitly; contours are not silently discarded. The area convergence graph shows error against the selected polygon at harmonic orders up to the chosen K. All coefficients and their phases can be inspected and exported.

For segmentation benchmarks, import an independently produced binary reference PNG with matching dimensions, or draw and review it manually with the independent reference brush. White is foreground; black/transparent is background. Check the explicit manual-verification box to display IoU, Dice and boundary F1. Boundary F1 uses a ±2-pixel square (Chebyshev) tolerance. Metrics only describe agreement with the provided reference. Using a prediction as its own reference would not measure real accuracy.

## Save, reopen and batch

`Save complete project` downloads a V3 `.smap.json` with an embedded lossless image snapshot, original model mask, corrected mask, independent reference, prompts, search crop, calibration, model identities, provenance, review state, contours and Fourier results. `Open project` validates dimensions and settings, reconstructs contours from the stored mask and recomputes Fourier. It does not trust an imported coefficient table as a fresh calculation.

Browser-local IndexedDB autosave stores the last active project. It belongs to that browser and origin. Save a portable file for backup, transfer or long-term use. Studio does not automatically append these multi-contour measurements to the legacy single-outline CSV database; reports and project files are the portable Studio record.

Batch uses one text description and runs images sequentially. The queue is capped at 20 images and 128 MB of source files. Each image has a separate portable project. Every processed result starts as **needs review**, and approval is invalidated by subsequent mask or measurement-setting edits. Failed images are recorded in the batch summary. Cancel stops the current model request and prevents additional images from starting. Browser cancellation of a SAM 3 HTTP request does not guarantee an already-running Python/CUDA call has stopped; the backend serializes requests.

The batch ZIP contains each processed image's project, ordered boundary CSV, SVG and Fourier CSV, plus a summary with review state. A processed result is never automatically marked approved.

## Legacy grid and cell workflow

The original Trace, Matrix, cell editor and working V2 quick assistant remain available. That measurement system uses a centered square and a single outer polygon. Its hole-filling acknowledgement remains in place. Studio's full-image/multi-contour measurements do not silently overwrite that single-outline grid format. Use Studio's exports/project files for true-hole measurements; use the retained quick assistant for the original grid workflow.

## Rebuild

The normal user does not need npm. To change inference source: install the pinned dependencies under `tools/browser-engine`, then run `npm run build` there. Vite emits `/sam-bundle/engine.js` and its worker. Model files are local under `public/models/`; notices, source revisions and text-weight SHA-256 hashes are included. App modules under `public/studio/` are buildless JavaScript.

Tests: `node --test tests/*.test.mjs` and `python -m unittest discover -s tests -p 'test_*.py'`.

Primary model references:

- https://huggingface.co/Xenova/clipseg-rd64-refined
- https://huggingface.co/CIDAS/clipseg-rd64-refined
- https://github.com/timojl/clipseg
- https://huggingface.co/Xenova/slimsam-77-uniform
- https://huggingface.co/docs/transformers/en/model_doc/sam3
