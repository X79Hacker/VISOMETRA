# Curve Studio — editable diamonds and Bézier boundaries

This release adds editable vector boundaries to the full-image Studio, and
reorganizes the UI around the canvas. The original Trace/Grid/cell editor,
models, Fourier engine, episodes, Lab, tracking, benchmarks and exports remain
available. Curve editing is in **Curve Studio**; the older Trace/cell editor
retains its existing Bézier drawing tools.

## Start and preserve your current work

1. Stop the previous server with Ctrl+C. Extract this ZIP into a new folder.
2. COPY the old `data/` and `results/` folders into it. Keep the old folder as
   a backup. If you use optional SAM 3, retain its weights and rerun its setup
   if you moved its Python environment.
3. Run `start-windows.bat` or `python server.py`.
4. Open http://127.0.0.1:8763/dashboard-front.html, log in and press Ctrl+F5.
5. Choose a frame's **Curve Studio** button, or open a saved Studio project.

The app retains port 8763, the existing data stores and V3 `.smap.json` format.
New files contain an optional `curveOutline` field. Existing V3/V4 projects
without that field continue to work. Use this release to reopen and edit the
new curve controls; older apps may only use the saved raster mask.

## What changed in the UI

- A larger central image workspace, with Edit anchors, Insert point, Pan,
  Undo/Redo and Run Fourier beside the image.
- **Select / Curves / Measure** tabs in the left inspector.
- **Export / Validate / Model** tabs and live measurements on the right.
- **Fourier & measurements / Sequence, tracking & batch** panels below the
  image. Tracking and batch functions are in the second panel.
- A persistent status strip, zoom up to 1200%, wheel zoom and Space-drag pan.
- More compact dashboard hierarchy. Workspace activity/totals are expandable;
  they have not been removed. The Episode Lab and all previous navigation
  remain available.

On narrow screens, the image appears first, followed by editing tools and
analysis. On desktop/laptop screens, the canvas height adapts to the window.

## Edit the boundary

1. Generate a mask with the existing AI, or paint one manually.
2. Click **Run Fourier**. If the contour is within the editor's limits, the
   app enters diamond-anchor mode automatically. **Edit anchors** also starts
   it explicitly. The initial segments follow the selected polygon and remain
   straight until you choose curves or smooth them.
3. Select the contour you want to edit. Separate objects and holes stay separate.
4. Drag a **filled diamond** to move an anchor. The selected diamond is larger.
5. Click/drag a **hollow midpoint diamond** to insert another anchor between
   two points. **+ Point** lets you click anywhere near a segment, and a
   double-click on an edge also inserts a point.
6. Select an anchor and choose **Bézier curve** for the segment leaving it.
   The controls initially lie on a straight chord. Drag the **circular handles**
   to bend the segment to fit the image.
7. **Smooth anchor** links its incoming/outgoing tangents and makes adjacent
   segments curved. **Sharp corner** collapses that anchor's handles. Other
   sections keep their own straight/curved settings.
8. **Smooth this contour** smooths all anchors in the selected contour. This
   changes its shape; inspect the edge fit and area, or Undo it.
9. **Delete point** removes the selected anchor, with a minimum of three per
   closed loop. X/Y fields support precise original-pixel coordinates.

Insertion on a curved segment uses de Casteljau subdivision. It preserves the
entire Bézier shape and its area before you move the new point; it does not
replace the curve with straight segments. Moving an anchor translates its
handles. Smooth-handle dragging reflects the opposite tangent, within image
bounds. More anchors provide more control, not an automatic accuracy guarantee.

Arrow keys nudge an anchor by 1 original pixel; Shift + arrows nudges by 10.
Delete/Backspace removes it. Ctrl+Z/Ctrl+Y undo and redo full boundary edits.
Escape exits point-insertion mode or cancels the current drag. Hold Space and
drag, middle-drag or right-drag to pan. Mouse wheel zooms about the pointer.

Self-intersections, overlapping contours, collapsed loops, or holes moved into
an invalid nesting arrangement reject the edit and retain the previous valid
boundary. Pixel contours that only touch diagonally remain supported. Editing
limits are 256 contours and 5,000 anchors; Fourier retains its 30,000-vertex
limit after curve flattening. If a mask is too dense for editable anchors,
increase pixel simplification explicitly; ordinary Fourier remains available.

## What the measurements mean

- The displayed **Edited Bézier area** integrates each cubic segment using
  Green's theorem and three-point Gauss–Legendre quadrature. This is exact for
  the cubic integrand in real arithmetic, subject to floating-point rounding.
  Outer regions add area; holes subtract it.
- Fourier still uses the original analytic polygon-coefficient engine. Curved
  segments are adaptively flattened with a maximum control-hull-to-chord
  deviation of **0.15 original image pixels** before that calculation. This is
  a geometric tolerance, not a claim that area/perimeter error is 0.15%.
- The UI separately reports the curve-to-polyline area change and Fourier area
  error relative to the edited analytic boundary. Perimeter is computed from
  the adaptive polyline. Reconstruction RMS still compares Fourier with that
  polyline at 512 matched arc positions, not an exact Hausdorff distance.
- Every committed boundary edit rasterizes the chosen loops into the editable
  mask using even-odd fill and a 50% alpha threshold. Mask PNGs, cutouts and
  independent-reference benchmarks therefore follow the edited outline at
  pixel resolution. Their area can differ slightly from continuous curve area.
- The original model mask remains separately available through Restore model
  mask. Reference masks remain independent.

Paint/erase, cleanup, connected-region selection, model re-segmentation, pixel
simplification or pixel smoothing rebuild a boundary from the current mask.
They exit the old vector geometry rather than leaving stale curves over a new
mask. Undo restores the prior editable curves. Editing only the independent
reference mask preserves the vector outline.

## Save, export, and episode features

Portable projects and saved episode projects retain the control points,
handles, segment modes, contour roles, image, masks, settings and results.
Project loading validates the vector geometry and recomputes Fourier from it.

- **SVG** contains actual `C` cubic commands for curved segments.
- Boundary **JSON** includes the editable control data and the adaptive boundary.
- Boundary **CSV** contains adaptive polyline samples in original coordinates;
  it does not pretend the Fourier reconstruction or handle positions are
  ground-truth image edges.
- Overlay and boundary PNGs draw the true vector paths; mask/cutout PNGs use
  the rasterized mask. Reports distinguish analytic selected area from the
  Fourier input polyline area.
- Batch SVG/project exports retain curves on previously edited frames.
- Episode Lab measurements use the saved editable geometry under the separate
  **Studio curves** source. Subpixel handle changes invalidate frame approval
  even if their raster mask happens to be unchanged.
- Complete episode backups include the saved curve controls. Restoring them
  creates a new episode as before; existing images and measurements stay.

See `EPISODE_LAB.md` for playback, comparison, graphs, sensor fields, event
labels, review, complete backup/restore, project persistence and assisted
tracking limits. Curved boundaries do not remove camera perspective, lens
distortion, segmentation mistakes or finite-harmonic Fourier error.

## Verification

The release includes tests for analytic curve area, exact subdivision,
straight/smooth/corner behavior, hole topology, self-intersection rejection,
diagonal pixel components and subpixel review invalidation, plus the earlier
geometry/Fourier, episode, tracking and archive regressions.

Browser verification exercises diamond insertion/dragging, both Bézier
handles, Undo/Redo, Fourier and SVG export, raster benchmark updates, project
save/reopen, mask-tool fallback with vector Undo, episode graphs and complete
backup/restore. The original bundled SlimSAM tracking path is also exercised.

Run `node --test tests/*.test.mjs` and
`python -m unittest discover -s tests -p 'test_*.py'`.
