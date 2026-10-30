# SAM / AI boundary tracing — updated 24 October 2026

## Outline Studio V3

For the new bundled text → SAM workspace, open **Outline Studio V3** from Dashboard. It includes CLIPSeg q8 and SlimSAM q8 and needs no extra model setup. See [OUTLINE_STUDIO_V3.md](OUTLINE_STUDIO_V3.md) and `START_HERE.txt`. The optional real SAM 3 instructions below apply to both Studio and the legacy assistant. The legacy crop/single-outline behavior described below does not apply to Studio.

## Start the original grid assistant

1. Extract the entire ZIP.
2. Double-click **start-windows.bat**. Python 3 is required; no npm installation is needed for local use.
3. Open **http://127.0.0.1:8763/** and use the existing login. With no `SITE_USERS` configured, the original local single-user mode accepts any nonempty username.
4. Upload an image through Dashboard. Open **Trace**, then **AI · SAM 3**.
5. The **Fast offline · SlimSAM** engine is bundled, including all model/runtime files. Add include/exclude points or a box, then click **Segment object**.
6. Review the selected GREEN outline and click **Use boundary only** to keep editing, or **Apply & run Fourier** to transfer it and start the existing calculation. Refine its anchors, then **Finish → Grid**. In an individual cell, use **Compute** after applying a boundary.

Use recent Chrome or Edge. In V2 the bundled model always uses the tested WebAssembly CPU runtime; automatic WebGPU selection is disabled for this export. The optional Python SAM 3 backend still supports CUDA. The page reports the engine actually used; SlimSAM is never labelled as SAM 3.

The original manual drawing, calibration, image storage, grid, CSV results and Fourier tools are retained. Opening the AI assistant does not modify the current outline. Applying a result replaces that outline and creates an Undo checkpoint.

## Optional real SAM 3 installation on your Lenovo LOQ

SAM 3 is a separate model from the bundled lightweight SlimSAM. Official SAM 3 access is gated on Hugging Face. Its checkpoint is approximately **3.44 GB**, and is not included in this ZIP. The installer downloads one Transformers checkpoint, avoiding the duplicate `.pt` checkpoint.

1. Install **Python 3.12 or newer** if needed. The installer prefers Python 3.12, otherwise the default Python 3.
2. Open **https://huggingface.co/facebook/sam3** in your own browser and request/accept access under the model's conditions.
3. Run **setup-sam3-windows.bat**. It creates `.venv-sam3`, installs CUDA-enabled PyTorch 2.10.0 / torchvision 0.25.0 and the pinned SAM 3 dependencies, and invokes `hf auth login` locally.
4. Authenticate in that local terminal using your own Hugging Face account. Never enter a token into the VISOMETRA website or send it in chat.
5. The script downloads the authorized weights into `models/sam3/`. Restart the app with **start-windows.bat**, which automatically uses `.venv-sam3` when present.
6. In AI Assist, choose **SAM 3 · points / box** or **SAM 3 · text / exemplar**. The status panel reports whether the backend is ready.

This environment could not run real SAM 3 inference: the official weights require the user's authorized access, and the user's physical GPU is unavailable. The backend uses the documented Transformers `Sam3TrackerModel` / `Sam3TrackerProcessor` for interactive points/boxes, and `Sam3Model` / `Sam3Processor` for concepts. Missing weights or dependencies produce a clear setup error. It never silently substitutes SlimSAM for SAM 3.

The 8 GB RTX 4060 has a limited VRAM budget. The backend loads only one SAM 3 mode at a time, uses a single image, CUDA autocast, and Accelerate CPU offload when needed, reserving some GPU memory. This does not guarantee every input will fit. Close other GPU-heavy programs; use Fast offline if SAM 3 reports insufficient memory. CPU-only SAM 3 can be very slow and uses substantial RAM.

### macOS / Linux manual setup

Use Python 3.12+. Create `.venv-sam3`, install PyTorch appropriate for your platform from https://pytorch.org/get-started/locally/, then:

```sh
.venv-sam3/bin/python -m pip install -r requirements-sam3.txt
.venv-sam3/bin/hf auth login
.venv-sam3/bin/python sam3_setup.py
sh start-mac-linux.sh
```

## SAM 3 versus SAM 3.1

As of this update, Meta's SAM 3.1 release introduces Object Multiplex and improves multi-object video tracking. This application segments still images and uses SAM 3's documented image interfaces. No single model is universally best for all material, microscopy, medical, low-contrast, or tiny structures. Inspect the boundary before treating it as a measurement.

Primary references:

- https://github.com/facebookresearch/sam3
- https://github.com/facebookresearch/sam3/blob/main/RELEASE_SAM3p1.md
- https://huggingface.co/docs/transformers/en/model_doc/sam3_tracker
- https://huggingface.co/docs/transformers/en/model_doc/sam3
- https://huggingface.co/facebook/sam3
- https://huggingface.co/Xenova/slimsam-77-uniform

## Coordinate and measurement behavior

- Legacy whole-image AI uses the **same centered square crop** as the existing 16 × 16 grid. It does not segment outside that crop. The working image is capped at 1536 pixels per side.
- Cell AI uses the same source cell crop as the original editor. Its output maps back to the existing 500 × 500 cell coordinate system.
- Mask PNGs retain all selected pixels, components and holes. The default outline overlay and transparent-outline PNG show the selected simplified polygon used for Fourier. The diagnostic all-edges view still shows every raw mask boundary.
- The original measurement system stores one closed outline. Choose a connected outer region before applying it. If the mask has holes, applying its outer contour would fill the holes in grid/Fourier measurements; the assistant requires an explicit acknowledgement. Mask/cutout PNGs still preserve those holes.
- Simplification is expressed in working-image pixels. Imported anchors are straight segments so they do not overshoot the model's polygon. They remain editable with the original Bézier tools.
- The model score is predicted quality, not measured accuracy. Pixel masks, a simplified outline, and its Fourier reconstruction can have slightly different areas.
- In text mode, at most eight highest-scoring candidate instances are shown. Select the instance and outer region to use.

## Privacy and hosting

Fast mode runs entirely in the browser. SAM 3 sends the cropped image only to the same local Python server, which binds to `127.0.0.1`. Model downloads occur during setup, not during segmentation. Existing app storage continues to save images and drawings as before. This update does not deploy or publish the project.

Cloudflare Workers cannot run this Python/CUDA backend. The updated Worker explicitly reports this limitation for the SAM endpoints; the bundled browser engine still works behind the existing login. Large SAM 3 checkpoint files belong outside `public/` and must not be uploaded as static assets.

## Source and model files

`public/sam/assist.js` contains the preview/prompt UI; `trace-adapter.js` and `editor-adapter.js` connect it to the original app. `geometry.js` traces contours, simplifies them, decodes backend masks and converts coordinates. `sam_backend.py` implements real SAM 3 inference. `server.py` exposes authenticated `/api/sam/status` and `/api/sam/segment` routes.

The bundled SlimSAM ONNX files are Apache 2.0. Its prompt encoder contains the original learned box-corner embeddings restored for labels 2 and 3, allowing native point and box prompts. Notices are in `public/licenses/`. Browser worker source and rebuild tooling are included under `tools/browser-engine/`.

## Tests

```sh
node --test tests/sam-geometry.test.mjs
python -m unittest discover -s tests -p "test_sam_backend.py"
```

Real SAM 3 inference is an optional integration check after authorized weights are installed. The test suite does not present mocks or a missing-weight response as proof of SAM 3 inference.

## V2 contour preview fix

Read `UPDATE_VERSION.txt` for update steps. Default preview is one green selected polygon, not every fragmented mask contour. Regions containing Include prompts are ranked ahead of unsupported background regions. At most 200 region choices are displayed. Hole acknowledgement now concerns only holes within the selected region. Use Show prompt markers to hide click markers. The transparent Outline only PNG exports the selected contour without the photograph.
