# VISOMETRA — Episode grouping

This edition adds ordered image groups and refreshes the dark UI. The original
Trace, 16 × 16 Matrix, cell editor, Fourier calculations, animation, AI assistant,
Outline Studio, reference benchmarks and existing downloads remain available.

## Start and keep your work

1. Stop the previous server with Ctrl+C.
2. Extract this ZIP into its own folder; do not run from inside the ZIP.
3. If you already have stored work, COPY your old `data/` and `results/` folders
   into the new folder. Keep the old folder as a backup. If you installed optional
   SAM 3, retain its `models/`; rerun its setup if the Python environment moved.
4. Double-click `start-windows.bat`, or run `python server.py`.
5. Visit http://127.0.0.1:8763/dashboard-front.html and log in. Ctrl+F5 refreshes
   cached pages. Existing images start under Unassigned; measurements are kept.

The port remains 8763 so the browser origin and existing Studio autosave stay
the same when you use the same browser/address. Stop the old server first.
Episode records are added to the existing database automatically. No manual
database migration or npm installation is needed for the local app.

## Organize a sequence

- Click **New episode**. Enter a name and optional session / experiment notes.
- Select the episode in the left sidebar, then add its related images.
- Default import order is natural filename order: frame1, frame2, frame10.
  Use zero-padded names (frame0001.png) for predictable long sequences. File
  picker order is also offered; that order is supplied by your browser/OS.
- Uploading more images later APPENDS them to the selected episode. Existing
  frames stay in order; the app does not infer chronology from image content.
- **Earlier / Later** adjusts a frame's saved sequence position. These buttons
  switch the view back to Sequence order. Other filename/progress/date sorts
  change only the current view.
- Select frame checkboxes, choose a destination and click **Move frames** to
  move existing images into an episode. One image belongs to at most one
  episode. Moving it preserves its image ID, drawing, trace and measurements.
- **All images** shows every image; **Unassigned** shows images outside episodes.
- **Edit details** updates the name and notes. **Remove episode** removes the
  grouping only. Its images become Unassigned, with their measurements kept.
  The original per-image Delete and Wipe All Data remain destructive and use
  the original confirmation / history workflow.

## Work on a frame

Open a frame in Trace, Grid Matrix or Outline Studio. With episode context,
Trace/Grid/editor navigation stays within that episode in saved sequence order.
The header has previous/next frame controls. Existing [ / ] shortcuts in the
legacy pages also follow the episode. Moving between cells retains that context.
Saved Results opened from an episode is filtered by its image IDs. Existing
explicitly labeled all-results download links still download all results.

**Open episode in Studio** loads its frames into the existing ordered queue,
with a twenty-image / 128 MB limit. Larger episodes remain valid on the dashboard;
open their frames individually. Studio's models, review step, Fourier analysis,
batch export and portable project tools keep their original behavior. Episode
name, ID, frame number and dashboard image ID are included in projects/reports
created from episode frames. Standalone Studio uploads remain standalone and
are not silently added as dashboard episode images.

Studio retains browser-local autosave and portable downloads. Episode Lab also
saves dashboard frame projects to the authenticated workspace. Use Save to
episode workspace before making a complete backup. See EPISODE_LAB.md.

## Export episode information

**Export episode info** downloads a ZIP with:

- `episode.json`: episode name, notes, saved frame order and matching saved
  legacy measurements.
- `frames.csv`: one row per frame, with number, filename, ID and measured cells.
- `measurements.csv`: saved grid/trace records belonging to this episode only,
  with episode name and frame number. Multiple saved versions remain included.

This export is a summary, not a restorable image/project backup. Source images,
Studio masks and Studio-only measurements are not included. Continue using
Studio's existing project/report/batch downloads for those. Keep `data/` and
`results/` when transferring the complete local workspace.

Episode data is shared through the same authenticated local/hosted store as
images. Reload to see another user's changes. As with existing drawing storage,
avoid simultaneous edits to the same episode from multiple tabs/users; the
last save wins. There is no live collaboration or automatic semantic grouping.

## Validation

Run `node --test tests/*.test.mjs` and
`python -m unittest discover -s tests -p 'test_*.py'`.
Browser QA covered natural filename ordering, later upload append, group
isolation, moving frames with existing drawings, persistent reorder, episode
navigation in Trace/Grid/editor, ordered Studio queue switching, episode ZIP
export, responsive layout and removing a group without deleting images.
The bundled model files, segmentation engine and Fourier/geometry core are
unchanged. Current Episode Lab validation, including a real SlimSAM tracking
refinement, is recorded in EPISODE_LAB.md.
