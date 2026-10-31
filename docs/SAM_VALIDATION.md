# AI update validation

Validated on 24 October 2026.

## V3 real browser checks

- Opened a Dashboard portrait at its full 512 × 512 dimensions in Outline Studio V3. Real bundled CLIPSeg q8 text inference with “person” at threshold 0.20, followed by SlimSAM q8 refinement, returned 104,749 foreground pixels. The output reported the actual models and a SAM-predicted score of 98.3%; this is not measured accuracy. It produced 34 closed contours, including 29 holes. Automatic multi-contour Fourier completed.
- Uploaded the public-domain Wikimedia `ParkBench.jpg` photograph (FelpMan, https://commons.wikimedia.org/wiki/File:ParkBench.jpg), 1290 × 846 pixels, through the actual file chooser. The text prompt “bench” used no manual points or boxes. Real CLIPSeg → SlimSAM inference took approximately 10.92 seconds in the test browser and returned 324,755 mask pixels, with a SAM-predicted score of 95.6%. Small model artifacts remain possible and are visibly editable.
- The bench contained 79 closed contours (11 outer, 68 hole loops). The first test exposed a 64-contour guard; the guard was increased to 256. The real browser then computed all 79 independent series at K=40. Selected polygon area: 324,824.5 px²; Fourier area: 324,643.882 px²; relative area error: 0.0556%; sampled parameter-matched RMS boundary error: 1.024 px. This compares Fourier with the selected polygon, not with a ground-truth bench mask.
- Downloaded the complete bench project through the browser. The 6,239,266-byte JSON contained the embedded original image, text prompt, raw/current masks, all 79 contours and Fourier results. Reopened the downloaded file through Open project: the “bench” query, dimensions, masks, contours and settings were restored, and Fourier recomputed.
- Downloaded the boundary CSV and decoded it locally: all 1,443 ordered vertices were present, with contour roles and original pixel coordinate metadata.
- Erased part of the real bench mask with the UI brush. Mask area changed from 324,755 to 324,316 pixels. Clicking Undo restored exactly 324,755 pixels.
- The final two-image batch upload was blocked by the browser upload permission gate. It was not retried or bypassed. The full browser batch/ZIP workflow and reference-mask import UI therefore remain unverified in this run. Batch sequencing, cancellation, per-image failure isolation, standard ZIP encoding and numerical reference metrics were validated locally; these checks are not represented as end-to-end batch browser inference.

The browser preview continues to use an isolated Node session/storage fixture. No fixture authentication, test photos, model predictions or QA exports are included in the deliverable.

## V3 automated checks

- 18 JavaScript tests passed, covering legacy prompt/coordinate geometry plus V3 mask RLE, cleanup, brush interpolation/erasing, region/holes, net signed area, independent exact Fourier series, reconstruction convergence, reference IoU/Dice/boundary F1, project guards, ZIP encoding, sequential batch error isolation and cancellation.
- Four Python route/contract tests passed, including real authentication and SQLite persistence.
- A generated batch ZIP was decoded with Python zipfile; entries and CRC integrity passed.
- Browser engine rebuilt with pinned Transformers.js 3.8.1. CLIPSeg source revision and SHA-256 hashes are included beside the bundled model files. JavaScript syntax checks passed.
- Neither real SAM 3 nor the physical RTX 4060 was benchmarked. The bundled models were actually run on the browser's stable CPU runtime.

## V2 regression checks

- Disabled automatic WebGPU selection for the bundled SlimSAM export. V2 runs it on the WebAssembly CPU runtime, the inference path tested here. The user's checkerboard screenshot suggested a GPU-path problem; the exact original photo and physical RTX 4060 were not available for reproduction.
- Tested the public scikit-image astronaut portrait at 512 × 512 pixels. One Include point inside the face produced a connected face mask with 8,858 pixels, predicted score 97.2%, and 40 simplified outline anchors. The preview displayed one green selected polygon, rather than every fragment of the mask.
- Clicked **Apply & run Fourier**. The assistant closed, the 40-anchor outline appeared in Trace, and the original Fourier worker produced 200 circles. Polygon area was 99.9477 cm² and Fourier area was 99.9479 cm² with the test calibration.
- Downloaded **Outline only PNG (transparent)** through the browser and decoded it: 512 × 512 RGBA, 259,797 transparent pixels and 1,553 fully opaque boundary pixels, plus antialiased pixels.
- Confirmed that a neck prompt selected the neck region, while a face prompt selected the face. Prompt placement changes the requested object; the clean display does not guarantee the desired semantic selection or perfect accuracy.
- Verified the V2 header, stable CPU model label, selected-outline preview default, hole acknowledgement guard, and direct Fourier action in the browser.

## Real browser inference and app integration

- Uploaded a JPEG through the original Dashboard file picker.
- Opened the uploaded image in Trace, then the new AI assistant.
- Ran real bundled SlimSAM ONNX inference in the browser's WebAssembly CPU runtime: 410 × 410 square crop, 20,492 selected pixels, one outer region, model-predicted score 94.4%, approximately 8.5 seconds in the test browser.
- Compared the original against the mask/boundary preview with the split slider.
- Downloaded the binary mask PNG and decoded the downloaded file.
- Applied its boundary as 97 editable straight anchors. Reloaded the page and verified that the saved outline returned.
- Ran the original Finish → Grid workflow. It produced 48 covered cells (14 full, 34 partial). Trace area and sum of cell areas both displayed 360.9328 cm². The existing Fourier calculation produced 360.9495 cm².
- All 48 cells completed their original area/circle measurement workflow.
- Opened a covered cell in the original editor, then used AI assistance on that cell's 256 × 256 crop. Real inference produced a mask and 153 outline anchors. The mask contained internal holes; Use boundary stayed disabled until the outer-contour limitation was acknowledged. Applied the outline to that cell, completed its Compute workflow (200 circles), then verified Undo and Redo availability.
- Confirmed that SAM 3 concept mode exposes a text prompt and explicitly reports missing setup, while the bundled engine reports SlimSAM. No automatic substitution is hidden behind a SAM 3 label.

The managed browser preview uses an isolated Node storage/session fixture because its preview image cannot run Python. No fixture code, test images, session overrides or QA data are included in the delivered app. Production Python routes were checked separately with real HTTP requests and SQLite persistence.

## Automated checks

- Seven JavaScript tests: exact edge contours, holes and disconnected regions; valid/corrupt RLE masks; coordinate mapping into the 8000-unit trace and 500-unit cell spaces; closed polygon simplification; native box labels and point scaling; prompt-supported region ranking; and selected-region hole detection.
- Four Python tests: prompt validation; mask RLE; authentication and honest missing-weight responses; actual trace storage roundtrip and JavaScript/WASM MIME types.
- Python compilation and JavaScript syntax checks passed.
- Browser engine rebuilt from its included source, and its bundled worker path was verified under `/sam-bundle/`.

## Verification limits

Actual SAM 3 inference was not run. The official checkpoint requires the user's Hugging Face authorization and a separate large download; the environment has no user-authorized checkpoint or physical RTX 4060. The SAM 3 backend follows the documented Transformers APIs, includes a CUDA/CPU-offload strategy, and has validated request, setup-error and storage contracts. This is not a claim that its full model executed here.

The 8 GB GPU was not benchmarked. Model scores are predictions, not measured accuracy. The grid/Fourier system uses one outer polygon; holes remain accurate in mask PNGs but require explicit acknowledgement before importing a filled outer contour.
