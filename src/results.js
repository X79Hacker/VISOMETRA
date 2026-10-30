/* Saved Results: the same three tables server.py writes as CSV files
   (measurements, circles, cell areas), kept in D1 (tables res_meas and
   res_parts, see migrations/).

   POST /api/save               one result (the editor / trace page sends it after every COMPUTE)
   GET  /api/results            every result, without its outline (the Saved Results list)
   GET  /api/circles?id=…       the circles (frequency, amplitude, phase) of one result
   GET  /api/cells?id=…         the per-cell areas of one whole-trace result
   GET  /api/download           the three CSV files in one zip
   GET  /results/<name>.csv     one of the three files

   Every row is stored twice, as the JSON the Saved Results page reads and as
   the finished CSV line for the downloads, so answering a request is only
   joining stored text — the free plan allows 10 ms of CPU per request. The
   circles / cell areas of one result are one row each, so a save is a single
   batch of at most three statements. */

import { Hono } from "hono";
import { zipSync, strToU8 } from "fflate";

const MEAS_COLS = ["measurement_id", "saved_at", "saved_by", "image_id", "image_name", "scope", "cell_row", "cell_col",
  "unit", "cell_width", "cell_height", "area_bezier", "area_shoelace", "area_fourier", "perimeter",
  "width", "height", "centroid_x", "centroid_y", "direction", "recon_error", "num_circles",
  "expected_area", "percent_error", "outline_json"];
const CIRC_COLS = ["measurement_id", "image_name", "scope", "cell_row", "cell_col", "rank", "freq_k", "amplitude",
  "amplitude_px", "phase_rad", "phase_deg", "direction", "cum_area", "unit"];
const CELL_COLS = ["measurement_id", "image_name", "cell_row", "cell_col", "area", "coverage_pct", "unit"];
const CSV_FILES = { "measurements.csv": MEAS_COLS, "circles.csv": CIRC_COLS, "cell_areas.csv": CELL_COLS };

function cell(v) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const csvLine = (cols, row) => cols.map((col) => cell(row[col])).join(",");
const pick = (cols, row) => Object.fromEntries(cols.map((col) => [col, row[col] ?? null]));
const jsonText = (c, text) => c.body(text, 200, { "Content-Type": "application/json; charset=utf-8" });

/* One saved result, as in server.py's save_result. "saved by" is always the logged-in user. */
async function saveResult(db, p, user) {
  const img = p.image || {};
  if (!img.id || !img.name) throw new Error("image id and name are required");
  if (p.scope !== "cell" && p.scope !== "trace") throw new Error("scope must be cell or trace");
  const circles = Array.isArray(p.circles) ? p.circles : [];
  const cells = Array.isArray(p.cell_areas) ? p.cell_areas : [];
  if (circles.length > 5000 || cells.length > 256) throw new Error("too many rows");

  const mid = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const unit = p.unit || img.unit || "";
  const meas = Object.assign(pick(MEAS_COLS, p), {
    measurement_id: mid,
    saved_at: new Date().toISOString(),
    saved_by: String(user || p.saved_by || "").slice(0, 60),
    image_id: img.id,
    image_name: img.name,
    unit,
    cell_width: img.cell_width ?? null,
    cell_height: img.cell_height ?? null,
    outline_json: p.outline ? JSON.stringify(p.outline) : "",
  });
  const base = { measurement_id: mid, image_name: img.name, unit };
  const circRows = circles.map((r) => Object.assign({}, r, base, { scope: p.scope, cell_row: p.cell_row ?? null, cell_col: p.cell_col ?? null }));
  const cellRows = cells.map((r) => Object.assign({}, r, base));

  const listed = Object.assign({}, meas);
  delete listed.outline_json; // the list on the Saved Results page leaves the outline out
  const part = db.prepare("INSERT INTO res_parts (measurement_id, kind, json, csv) VALUES (?, ?, ?, ?)");
  const stmts = [db.prepare("INSERT INTO res_meas (measurement_id, json, csv) VALUES (?, ?, ?)").bind(mid, JSON.stringify(listed), csvLine(MEAS_COLS, meas))];
  if (circRows.length)
    stmts.push(part.bind(mid, "circles", JSON.stringify(circRows.map((r) => pick(CIRC_COLS, r))), circRows.map((r) => csvLine(CIRC_COLS, r)).join("\r\n")));
  if (cellRows.length)
    stmts.push(part.bind(mid, "cells", JSON.stringify(cellRows.map((r) => pick(CELL_COLS, r))), cellRows.map((r) => csvLine(CELL_COLS, r)).join("\r\n")));
  await db.batch(stmts);
  return mid;
}

/* The full text of one CSV file, with a UTF-8 BOM so Excel reads ² correctly. */
async function csvFile(db, name) {
  const { results } =
    name === "measurements.csv"
      ? await db.prepare("SELECT csv FROM res_meas ORDER BY seq").all()
      : await db.prepare("SELECT csv FROM res_parts WHERE kind = ? ORDER BY seq").bind(name === "circles.csv" ? "circles" : "cells").all();
  return "﻿" + [CSV_FILES[name].join(","), ...results.map((r) => r.csv)].join("\r\n") + "\r\n";
}

async function partJson(c, kind) {
  const row = await c.env.DB.prepare("SELECT json FROM res_parts WHERE measurement_id = ? AND kind = ?").bind(c.req.query("id") || "", kind).first();
  return jsonText(c, '{"rows":' + (row ? row.json : "[]") + "}");
}

const results = new Hono();

results.post("/api/save", async (c) => {
  const payload = await c.req.json().catch(() => null);
  if (!payload) return c.json({ error: "Bad JSON" }, 400);
  try {
    const id = await saveResult(c.env.DB, payload, c.get("user"));
    return c.json({ id, folder: "the shared online database" });
  } catch (err) {
    return c.json({ error: err.message }, 400);
  }
});

results.get("/api/results", async (c) => {
  const { results: rows } = await c.env.DB.prepare("SELECT json FROM res_meas ORDER BY seq").all();
  return jsonText(c, '{"rows":[' + rows.map((r) => r.json).join(",") + '],"folder":"the shared online database"}');
});

results.get("/api/circles", (c) => partJson(c, "circles"));
results.get("/api/cells", (c) => partJson(c, "cells"));

results.get("/api/download", async (c) => {
  const names = Object.keys(CSV_FILES);
  const texts = await Promise.all(names.map((n) => csvFile(c.env.DB, n)));
  // stored, not compressed: compressing costs CPU the free plan does not have
  const zip = zipSync(Object.fromEntries(names.map((n, i) => [n, [strToU8(texts[i]), { level: 0 }]])));
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return c.body(zip, 200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="sector-map-results-${stamp}.zip"`,
  });
});

results.get("/results/:file{(?:measurements|circles|cell_areas)\\.csv}", async (c) => {
  const name = c.req.param("file");
  return c.body(await csvFile(c.env.DB, name), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${name}"`,
  });
});

export default results;
