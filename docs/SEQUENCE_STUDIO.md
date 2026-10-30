# Sequence Studio V6

This update includes all twelve requested improvements and folder import. The
original Dashboard, Trace, 16×16 Grid Matrix, cell editor, Fourier animations,
segmentation engines, measurements, references, projects, Episode Lab, and
complete backup/restore remain available.

## Start and upgrade

1. Stop the old Python server.
2. Extract the new ZIP into a new folder. Keep the old folder as a backup.
3. Copy your existing `data/` and `results/` folders into the extracted app.
4. Run `start-windows.bat`, or `bash start-mac-linux.sh`.
5. Open the address printed in the terminal (normally port 8763). Press Ctrl+F5.

The ordinary app still needs Python only: no npm install, API key, or external
service. Optional SAM 2.1 and SAM 3 have separate one-time model installations.
Do not open the HTML files directly from the filesystem.

## 1. Anchor tools in every drawing editor

**Main Trace and grid-cell editor:** a new visible toolbar contains Edit
anchors, + Point, Straight, Curve, Smooth, Sharp, Delete point and Magnifier.
Choose Edit anchors to reopen a finished whole-image trace, or convert a saved
cell outline. Click a filled diamond to select it; drag it to move it. Hollow
diamonds between anchors insert new points. You can also choose + Point and
click an edge, or double-click an edge. Insertion subdivides a cubic exactly
with De Casteljau's algorithm; adding a point does not itself change its shape.
The selected anchor is highlighted. Straight/Curve affects its outgoing edge.
Smooth and Sharp affect the selected corner. Existing keyboard shortcuts,
undo/redo, pan/zoom, drawing tools and computation buttons remain available.

Trace: after editing, Finish → Grid updates the cell pieces; use Run/Compute
again for Fourier. Cell: Compute measures the current edited outline. The Grid
Matrix remains a grid overview; open a cell to edit its boundary.

**Curve Studio:** the V5 diamond toolbar and true cubic controls remain. The
active target can have several independent outer contours and holes.

## 2. Selected-person tracking

Open an episode in Curve Studio, select a named target and correct its starting
mask. Use points/box mode to select one particular person rather than using the
generic word `person` to represent an identity. Exclude neighbouring people as
needed. Check the following frames you want saved, then open **Sequence,
tracking & batch**, select the tracking engine and press **Track selected
target**.

- **Bundled motion + SlimSAM** remains available without installation. It uses
  translation matching and per-frame segmentation; weak or ambiguous matches
  stop the run. It requires one connected seed component. It is not a video
  identity tracker.
- **SAM 2.1** uses the official video-memory predictor, a seed object ID and
  propagation through the sequence. It supports disconnected visible parts and
  corrected masks as conditioning frames. The model runs in a separate local
  Python worker; the browser remains responsive and progress can be cancelled.

Neither mode guarantees identity in dense crowds, long occlusions, fast motion,
or similar-looking people. Generated masks always need review. The app does not
invent calibrated confidence percentages or claim that a quality flag proves
an identity switch. Fully hidden body parts are not reconstructed.

### Optional SAM 2.1 setup

Install Python 3.12 (recommended) and Git. Run `setup-sam2-windows.bat`, or
`bash setup-sam2.sh` on Linux/WSL. The script creates `.venv-sam2`, installs the
official Meta SAM 2 code and downloads the official SAM 2.1 Small checkpoint
into `models/sam2/`. It verifies that the checkpoint loads before finalizing.
Internet is needed for this one-time installation; requests do not download
models. Restart the ordinary app server afterwards.

The default installer uses **CPU PyTorch wheels** and works without an NVIDIA
GPU, with potentially slow inference. For an NVIDIA GPU, use the compatible
CUDA PyTorch wheel index from https://pytorch.org/get-started/locally/:

```text
setup-sam2-windows.bat --torch-index-url YOUR_PYTORCH_CUDA_WHEEL_INDEX
```

Meta recommends WSL Ubuntu on Windows. If native Windows installation fails,
install and run both the app and the optional environment inside WSL. Do not
point a Windows server at a Linux Python executable. See the official source:
https://github.com/facebookresearch/sam2

Configuration variables:

| Variable | Default / purpose |
| --- | --- |
| `SAM2_PYTHON` | `.venv-sam2` Python, interpreted by the server OS |
| `SAM2_CHECKPOINT` | `models/sam2/sam2.1_hiera_small.pt` |
| `SAM2_CONFIG` | `configs/sam2.1/sam2.1_hiera_s.yaml` |
| `SAM2_DEVICE` | CUDA if available in the worker, otherwise CPU |
| `SAM2_MAX_FRAMES_PER_JOB` | 120, configurable up to 500 with sufficient RAM |

The official loader keeps image tensors in CPU RAM, and tracking state is
offloaded to CPU to reduce GPU pressure. Image tensors can require about 12 MiB
per frame before additional model/state memory. The default 120-frame bound
is intentional. For a longer episode, process overlapping chunks and use the
last corrected frame as the next seed, or explicitly increase the configured
limit after checking available memory. Processing speed is not guaranteed.

## 3. Frame checkboxes and ranges

The Sequence panel contains one checkbox per image. **Apply range** accepts
`1-20,25,30-40`; frame numbers refer to queue positions starting at 1. All,
None, Unfinished, and Needs attention buttons select useful subsets. Batch
and tracking save results to checked frames only. Tracking reads intervening
unchecked images to maintain temporal continuity without saving new masks
onto them. Selected ranges must be from one related chronological sequence.

## 4. Protect existing work

The default **Existing work** policy fills empty frames and preserves every
existing mask, correction, keyframe and approval. **Replace unapproved
suggestions** replaces generated suggestions while retaining corrected and
approved work. **Replace all selected work** explicitly permits replacement of
approved geometry too. Other targets are always preserved.

Single-frame manual editing remains an intentional direct edit. Any geometry
or measurement-setting change requires review again. Batch prompt processing
is category segmentation; it does not itself follow the same individual.

## 5. Review timeline

The image viewer has a compact clickable target timeline. It shows approved,
corrected, flagged, missing, hidden and unprocessed states for the **active
target**. The queue shows full image names and warning details. Click a timeline
marker to inspect that frame. Processing a frame never automatically approves
it. The full Episode Lab checklist remains available.

## 6. Correct once and propagate again

Correct a target on a failed frame. Manual edits mark it as a correction /
keyframe; the checkbox can also be adjusted explicitly. Select the following
frames, then press **Re-track from correction**. It replaces following
unapproved suggestions, while retaining approved work and other corrected
keyframes. In SAM 2 mode preserved masks become additional conditioning
frames. Changes made to the browser outline are saved before a job starts.

## 7. Previous-frame overlay

Enable **Previous-frame outline** in the target toolbar. A faint dashed amber
outline shows the same target's saved geometry in the preceding frame, when
the dimensions match and the target is visible. It does not warp the old
outline or imply that image coordinates are world coordinates.

## 8. Visibility and missing annotations

Each target in each frame can be Visible, Partly hidden, Fully hidden, Outside
image, or Missing / uncertain. Partly hidden masks describe the visible region
only. Hidden/outside/unknown states suppress stale overlays and numerical
measurements in Studio, Episode Lab and research exports. Stored geometry is
retained so a mistaken visibility label can be reversed. Mark it visible to
recover and edit that geometry. An empty model mask is a missing/uncertain
suggestion, not evidence that the person has left the scene.

## 9. Boundary magnifier

The Studio magnifier displays the image, mask, outline and anchors around the
cursor at 6× the displayed canvas scale. Crosshairs indicate the cursor. Main
Trace and the cell editor also have a Magnifier button. Magnification helps
place anchors; it does not add new image detail.

## 10. Multiple named targets

Use **+ Target** to create Person A, Person B, Chair, etc. Each has a persistent
ID, name, colour, geometry, model prompts, measurement settings, visibility,
correction state and approval. Creating a target starts with an empty mask;
it never copies a different target's outline. A frame project stores all its
targets while keeping the active target at the top level for older readers.

Layer checkboxes change which outlines are shown; the active-target selector
changes which target you edit/process. Switching targets or frames preserves
the others. Up to 20 targets are supported. Renaming a target does not change
its ID or its masks. Episode Lab adds an Analyze target selector so graphs
and comparisons do not accidentally combine different people.

## 11. Research dataset and complete sequence export

**Export selected dataset** includes the checked original images, per-target
PNG masks, SVG boundaries (true cubic commands when available), target IDs,
contours, edited Bézier handles, measurements, frame timestamps, sensor values,
review labels, visibility and flags. `dataset.json` is the complete manifest;
`measurements.csv` is the flat table. `annotations.coco.json` contains
uncompressed COCO **column-major RLE**, correctly converted from the app's
row-major masks. Holes are preserved. Track IDs are annotation IDs; they do
not guarantee that automated tracking never switched individuals.

Fully hidden/outside/unknown targets remain in the manifest with null
measurements and no fabricated foreground masks. Unprocessed images can be
included with no target annotation. Sensor metadata comes from saved Episode
Lab frame information; the app does not invent capture times from file times.

**Download complete sequence** saves checked images (including unprocessed frames), projects and
all their targets to `.smapseq`, which **Open saved sequence** can restore.
Single-frame complete projects remain supported. Dashboard's **complete
episode backup** remains the right choice to preserve unprocessed source
images, legacy traces/cells and full saved measurement history together.

## 12. Measurement quality flags

Adjacent same-target masks of matching image dimensions are checked for large
relative pixel-area changes and centroid jumps. Default thresholds: 50% area
change and 20% of the image diagonal for position. They are adjustable in the
Sequence panel. Empty visible masks are flagged. Hidden/missing masks produce
gaps, not fake zeros. Flags are inspection hints: actual motion, camera motion,
perspective, distance and occlusion can all change measurements legitimately.

## Folder import

Both Dashboard and Curve Studio have **Add entire folder / Add folder**.
In Chrome or Edge choose a directory and allow the browser's folder prompt.
Nested PNG/JPEG/WebP files are included; unrelated files are skipped. Folder
paths are retained, and natural path ordering places frame 2 before frame 10.
Folders append to the current episode/queue rather than replacing it. Choose
an episode before importing related frames. A folder is read only after you
select it; the browser cannot watch future changes automatically.

Limits: 500 frames per episode/Studio queue, 512 MB of Studio source files,
25 MB per source image, 12 megapixels / 12,000 pixels per side for Studio
analysis, and 512 MB per browser export. Existing complete episode backup
limits remain 256 MB. SAM 2 job limits are described above. Use smaller
episodes/chunks for long or high-resolution recordings.

## Compatibility and precision

No original model assets, ONNX/WASM runtime, Fourier engine or image coordinate
system was replaced. V3 outline projects still open. New target data is an
optional extension; old app versions can ignore it and show only the saved
active target, so use this version for multi-target work. Curved area is
analytic; Fourier uses the existing adaptive 0.15-pixel polyline input. Raster
masks retain pixel quantization. See `CURVE_STUDIO.md` for precision details.

SAM 2 backend runs only through the local Python server. A hosted static/
Cloudflare copy continues to offer the bundled browser tools and explains
when optional local functionality is unavailable.

## Validation

Run `npm test` for the JavaScript geometry, tracking, target isolation,
protection policies, folder ordering, range validation, dataset RLE and
approval regressions. Run `python -m unittest discover -s tests -p '*test*.py'`
for archive, SAM prompt validation and SAM 2 job/API-contract tests. The worker
contract test exercises seed IDs and frame/mask serialization without
pretending to run pretrained inference. Actual SAM 2 model performance needs
validation on your machine and representative crowded footage after setup.
