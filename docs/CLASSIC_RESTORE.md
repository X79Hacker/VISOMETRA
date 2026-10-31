# V3 Classic Dark restoration — 25 October 2026

Recovered the saved V3 archive from before the V4 white redesign. All 51 public app, model and runtime files match the saved V3 files byte for byte, including Dashboard, Trace, Grid, cell editor, Outline Studio and the segmentation worker.

The separate folder/ZIP is named sector-map-v3-classic-dark. Default server port changes from 8765 to 8763; the launcher opens the original dark Dashboard. A port collision exits without opening a browser. Server authentication and no-store cache headers are preserved. Launch instructions identify the new folder and address.

Validation: 18 JavaScript tests plus 4 Python tests passed. JavaScript syntax checks passed. Real local server login and authenticated Dashboard, Studio, Trace and CSS responses passed on the new default port. A second launch on the occupied port failed clearly. Browser preview visually confirmed the dark Studio and its previous controls. The preview only checked layout; the real local-server checks verified authentication and serving. Model inference was not rerun for this restoration; the model files and worker are unchanged from V3, whose inference validation is recorded in SAM_VALIDATION.md.

V3 preserves its original separation between the full-image Outline Studio and the original grid/Trace workflow. The V4 motion workspace and transfer button are not included. V3 projects are supported; preserve newer V4 projects in their existing folder.
