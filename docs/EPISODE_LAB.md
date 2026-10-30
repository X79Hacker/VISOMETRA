# Episode Lab — usage and limits

This release adds playback, frame comparison, graphs, capture/sensor metadata,
event labels, review checklists, complete episode backups and assisted tracking.
Original drawing, grid, AI segmentation, Fourier, benchmark and export tools are
retained. The portable Studio project format remains V3 for compatibility.

## Start with your current data

1. Stop the previous server with Ctrl+C. Extract the ZIP into a new folder.
2. COPY your old `data/` and `results/` into the new folder. Keep the original
   folder as your backup. Do not delete or replace its data before checking the
   new app. Retain optional SAM 3 weights under root `models/`; if you move the
   Python environment, rerun the supplied SAM 3 setup.
3. Double-click `start-windows.bat`, or run `python server.py`.
4. Log in at http://127.0.0.1:8763/dashboard-front.html. Press Ctrl+F5.
5. Choose an episode and click **Episode Lab · Play & compare**.

The port remains 8763. Existing episode, image, drawing and result records are
kept when you copy the data directories. New record stores are added without a
manual migration. No npm installation or API key is required locally.

## Playback and comparison

- The thumbnail strip follows the episode's saved sequence order.
- Use Play/Pause, previous/next, or the thumbnails. Space toggles playback;
  left/right arrow keys select frames when you are not typing in a field.
- Playback offers 1, 2, 5 or 10 display frames per second, plus looping. Image
  loading and decoding can reduce the actual rate. This is a viewer; it does
  not invent capture timestamps or export a video.
- Select any two frames under **Compare frames**. Both views share zoom and
  pan. Drag either image, use the zoom slider or mouse wheel, or choose Fit.
- Overlays can show the original image, saved Studio mask, selected boundary
  and holes. A saved legacy whole-image trace is mapped back onto its centered
  square crop within the original image. Cell-only outlines stay in the Grid
  editor. Missing masks are never drawn as if segmentation had been done.
- Episode Lab uses the Studio image limit: 12 megapixels and 12,000 pixels on
  either side. Its image/analysis cache is bounded; it loads frames as needed.

## Frame information and review

Use Inspect to enter notes, comma-separated event labels and capture time.
Capture time must include an explicit timezone, for example
`2026-10-27T10:15:30+05:45` or `2026-10-27T04:30:30Z`.
It is stored in UTC. A blank value means unknown.

Optional sensor fields are front/left/right/rear ToF in **millimetres**, robot
speed in **metres per second**, and steering in **degrees**. These are recorded
values you supply; the app does not synchronize hardware or estimate them from
an image. Zero is valid. ToF distances must be nonnegative; signed speed and
steering values are allowed.

Save frame information explicitly, or let it save when switching frames or
performing another Lab action. Failed/invalid saves keep the current form so
you can correct it. Notes and readings are attached to the image ID and remain
with it when you move the frame between episodes.

The checklist distinguishes unprocessed, needs review, measured, approved and
flagged frames. A frame must have saved geometry or a measurement before it can
be approved. Frame-level approval records a SHA-256 signature of the saved
geometry and settings. If they change, the approval becomes needs review.
Changing notes or capture readings does not invalidate geometry approval.
The signature excludes IDs and save timestamps, so a complete restore preserves
an unchanged frame's approval. Studio's own mask approval remains available.

Review filters can search event labels and notes. Missing capture time and
missing measurement are shown separately; sensor data is optional. Refresh
data after changing drawings in another tab or after another user's edits.

## Saved projects and measurement graphs

Studio opened from a dashboard frame now saves that frame's project through
the same authenticated workspace as the images. Use **Save to episode
workspace** before leaving or making a backup; an automatic save also runs
after edits. Switching queue frames saves the outgoing project's current
state. A failed workspace save is shown; downloading a complete portable
project remains available. Unsaved/in-flight workspace edits trigger the
browser's leave-page guard.

Standalone Studio uploads remain standalone. Browser-only autosaves and old
portable project files are not automatically discovered as workspace records.
A complete episode backup includes only Studio projects already saved against
the episode's dashboard image IDs. Keep separate portable projects for any
standalone work. Projects from before this release can still be opened.

Graphs support selected area, perimeter, centroid x/y, Fourier reconstruction
error and the sensor fields, against frame number or capture time. Click a
point to inspect its frame. Opening Graphs/Review loads saved analysis; the
frame table export waits for this analysis to finish.

For each frame, graphs prefer a saved Studio mask, recomputing its selected
polygon measurements. Otherwise they use the latest legacy whole-trace result,
or the sum of the latest saved cell areas. Cell perimeter and centroid are not
invented from aggregate cell results. Studio and legacy reconstruction errors
have different definitions and remain in separate source series. Different
units are also separate. Missing values break the line rather than becoming
zero. Time-axis points need a capture timestamp.

These are image measurements: perspective, camera motion and calibration can
change area and centroid. The graph alone does not establish physical object
growth, real-world velocity or segmentation accuracy.

## Assisted object tracking

1. In the Lab, choose **Track from this frame**, or open the episode in Studio.
2. Create/correct a seed mask for one connected object. Use Connected region
   if several disconnected objects are selected.
3. Click **Suggest following frames**. Tracking begins after the current
   queue frame. It is an explicit action; opening the tracking link does not
   start inference automatically.
4. Image texture is matched by normalized correlation at 192 × 192 resolution.
   A local translation proposal moves a bounding box and an Include point.
   The included SlimSAM CPU model refines that proposal in the next image.
5. Each new result is saved as **needs review**. Correct and approve it yourself.
   Existing saved masks are kept and used as fresh seeds, rather than replaced.
6. Cancel / Stop batch stops further processing and terminates the current
   tracking request where supported. Already saved suggestions remain.

This is translation-based assisted propagation, not a trained video identity
tracker. It requires equal image dimensions and works best with small motion,
texture and a visible single object. The search radius is 12, 24 or 36 pixels
at tracking resolution. Weak scores, ambiguous matches, motion at the search
limit, empty refinement or refinement missing the proposed Include point stop
the run. Occlusion, large scale changes, rotation and similar-looking objects
can still cause errors. The matching score is not measured mask accuracy.
The existing Studio queue cap remains 20 images / 128 MB.

## Complete backup and restore

**Complete backup** creates a ZIP with the episode's ordered source images,
name/notes, per-frame metadata and reviews, grid drawings, traces, persisted
Studio projects and legacy measurement history including circle/cell rows.
The manifest retains original saved-by and saved-at fields. The smaller
**Export episode info** remains a summary and is not a restorable backup.

Use **Restore episode backup** on the dashboard or **Restore backup** in Lab.
The importer validates the archive before publishing data. Restore creates a
new episode named with `(restored)` and fresh episode/image/measurement IDs;
existing work is retained. Circle/cell links and saved project IDs are remapped.
If publication fails, newly published data is rolled back. Original source
images are stored losslessly in the archive; model weights are already in the
application ZIP and are not repeated in episode backups.

Backups use the local Python server. The hosted Worker reports this clearly
instead of pretending to support a local archive route. Limits: 500 frames,
256 MB total uncompressed archive contents, 256 MB uploaded ZIP and 25 MB per
source image. Reduce an episode's size when it exceeds those limits.

Shared editing still uses last-save-wins records. Avoid editing the same frame
or episode simultaneously across tabs/users. Data from previous servers or
folders must be copied or restored explicitly; it is not merged automatically.

## Validation for this release

- `node --test tests/*.test.mjs`: geometry/Fourier regressions, tracking with
  known translations and ambiguous/textureless inputs, sensor validation,
  source/unit separation and approval invalidation.
- `python -m unittest discover -s tests -p 'test_*.py'`: API/auth regressions,
  backup round-trip, malformed archive rejection, ID/history preservation and
  rollback on early and late publication failures.
- Browser QA: playback/pause, frame comparison, zoom, graph point navigation,
  capture fields, review filters, CSV export, complete backup/restore, mobile
  layout, workspace project save/reopen and the original grid/Trace workflows.
- A synthetic translated object was passed through real bundled SlimSAM CPU
  refinement; a next-frame mask was saved, required review and reopened.
  This verifies the integration, not real-world tracking accuracy. Bundled
  model weights and the original geometry/Fourier engine are unchanged.
