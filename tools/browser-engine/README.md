# Rebuild the bundled browser inference worker

The ready-made files in `public/sam-bundle/` are included; normal local use does not require npm.

To change the worker, open a terminal in this directory and run `npm ci`, then `npm run build`.
The build replaces only `public/sam-bundle/`. It keeps the original Sector Map Worker source and configuration separate.

Source: `src/segment.worker.js` and `src/geometry.js`. Runtime model weights remain in `public/models/slimsam-trace-v1/`, and ONNX WASM files in `public/runtime/`.

The browser model is SlimSAM, not SAM 3. Real SAM 3 runs through `sam_backend.py` after the separate setup described in `docs/SAM3_SETUP.md`.
