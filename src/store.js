/* Shared storage for all users: what each page used to keep in the browser's
   IndexedDB (public/shared-store.js sends the same reads and writes here).

   Stores: files (image details, no pixels), patches (the 16x16 cell drawings
   of one image), traces (the traced outline of one image); records are keyed
   by the image id. Mounted at /api/store:

   GET    /files          {records:[...], deleted:[ids]}
   GET    /<store>        {records:[...]}
   GET    /<store>/<id>   the record (404 if none)
   PUT    /<store>/<id>   save the record (JSON body); 410 if the image was deleted
   DELETE /<store>/<id>   delete; for files also its patches, trace and pixels
   DELETE /<store>        delete all (files: everything)
   GET    /blob/<id>      the image file
   PUT    /blob/<id>      upload the image file (raw body, max 25 MB)

   Records are JSON text in D1 (table records, see migrations/), split into
   parts because a D1 row holds at most 2 MB; image files are KV values
   (binding IMAGES). The big records are never parsed here, to stay within
   the free plan's CPU limit. server.py has the same routes for local use. */

import { Hono } from "hono";

const STORES = new Set(["files", "patches", "traces", "episodes", "projects", "frameinfo"]);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PART = 500000; // characters per D1 row: at most 1.5 MB of UTF-8
const MAX_RECORD = 50 * 1024 * 1024;
const MAX_IMAGE = 25 * 1024 * 1024; // KV value limit

const jsonText = (c, text, status = 200) => c.body(text, status, { "Content-Type": "application/json; charset=utf-8" });
const fail = (c, status, error) => c.json({ error }, status);

// Split text into D1-sized parts without cutting a surrogate pair in half.
function split(text) {
  const parts = [];
  for (let i = 0; i < text.length; ) {
    let j = Math.min(i + PART, text.length);
    const ch = text.charCodeAt(j - 1);
    if (j < text.length && ch >= 0xd800 && ch <= 0xdbff) j--;
    parts.push(text.slice(i, j));
    i = j;
  }
  return parts.length ? parts : [""];
}

// Rows ordered by id, part → one JSON text per id.
function joinParts(rows) {
  const out = [];
  let id = null;
  for (const r of rows) {
    if (r.id === id) out[out.length - 1] += r.data;
    else {
      out.push(r.data);
      id = r.id;
    }
  }
  return out;
}

const isDeleted = async (db, id) => !!(await db.prepare("SELECT 1 FROM deleted WHERE id = ?").bind(id).first());

// KV allows 1000 deletes a day on the free plan; failures are ignored, the pixels are unreachable anyway
const deleteImages = (kv, ids) => Promise.all(ids.map((id) => kv.delete(id).catch(() => {})));

const store = new Hono();

store.use("/:store/:id?", async (c, next) => {
  const { store: s, id } = c.req.param();
  if (s !== "blob" && !STORES.has(s)) return fail(c, 404, "No such store");
  if (id !== undefined && !ID.test(id)) return fail(c, 400, "Bad id");
  if (s === "blob" && !id) return fail(c, 400, "Bad path");
  await next();
});

/* ---------- image files ---------- */
store.get("/blob/:id", async (c) => {
  const { value, metadata } = await c.env.IMAGES.getWithMetadata(c.req.param("id"), "stream");
  if (!value) return fail(c, 404, "No such image");
  return c.body(value, 200, {
    "Content-Type": metadata?.type || "application/octet-stream",
    "Cache-Control": "private, max-age=31536000, immutable", // an image id never gets other pixels
  });
});

store.put("/blob/:id", async (c) => {
  const id = c.req.param("id");
  if (await isDeleted(c.env.DB, id)) return fail(c, 410, "This image was deleted");
  const body = await c.req.arrayBuffer();
  if (body.byteLength > MAX_IMAGE) return fail(c, 413, "The image is larger than 25 MB");
  const type = (c.req.header("Content-Type") || "application/octet-stream").slice(0, 100);
  await c.env.IMAGES.put(id, body, { metadata: { type, size: body.byteLength, by: c.get("user"), at: Date.now() } });
  return c.json({ ok: true });
});

/* ---------- one record ---------- */
store.get("/:store/:id", async (c) => {
  const { store: s, id } = c.req.param();
  const { results } = await c.env.DB.prepare("SELECT id, data FROM records WHERE store = ? AND id = ? ORDER BY part").bind(s, id).all();
  if (!results.length) return fail(c, 404, "Not found");
  return jsonText(c, joinParts(results)[0]);
});

store.put("/:store/:id", async (c) => {
  const { store: s, id } = c.req.param();
  const db = c.env.DB;
  const text = await c.req.text();
  if (text.length > MAX_RECORD) return fail(c, 413, "Record too large");
  if (s === "files") {
    try {
      JSON.parse(text); // small; checked because the file list is built from these texts
    } catch {
      return fail(c, 400, "Bad JSON");
    }
  } else if (!text.startsWith("{") || !text.endsWith("}")) return fail(c, 400, "Bad JSON");
  if (await isDeleted(db, id)) return fail(c, 410, "This image was deleted");
  const now = Date.now(), user = c.get("user");
  const insert = db.prepare("INSERT INTO records (store, id, part, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)");
  await db.batch([
    db.prepare("DELETE FROM records WHERE store = ? AND id = ?").bind(s, id),
    ...split(text).map((part, i) => insert.bind(s, id, i, part, now, user)),
  ]);
  return c.json({ ok: true });
});

store.delete("/:store/:id", async (c) => {
  const { store: s, id } = c.req.param();
  const db = c.env.DB;
  if (s === "files") {
    await db.batch([
      db.prepare("DELETE FROM records WHERE id = ?").bind(id),
      db.prepare("INSERT OR REPLACE INTO deleted (id, deleted_at, deleted_by) VALUES (?, ?, ?)").bind(id, Date.now(), c.get("user")),
    ]);
    await deleteImages(c.env.IMAGES, [id]);
  } else {
    await db.prepare("DELETE FROM records WHERE store = ? AND id = ?").bind(s, id).run();
  }
  return c.json({ ok: true });
});

/* ---------- whole store ---------- */
store.get("/:store", async (c) => {
  const s = c.req.param("store");
  const db = c.env.DB;
  const { results } = await db.prepare("SELECT id, data FROM records WHERE store = ? ORDER BY id, part").bind(s).all();
  let body = '{"records":[' + joinParts(results).join(",") + "]";
  if (s === "files") {
    const gone = await db.prepare("SELECT id FROM deleted").all();
    body += ',"deleted":' + JSON.stringify(gone.results.map((r) => r.id));
  }
  return jsonText(c, body + "}");
});

store.delete("/:store", async (c) => {
  const s = c.req.param("store");
  const db = c.env.DB;
  if (s === "files") {
    const { results } = await db.prepare("SELECT DISTINCT id FROM records WHERE store = 'files'").all();
    await db.batch([
      db
        .prepare("INSERT OR REPLACE INTO deleted (id, deleted_at, deleted_by) SELECT DISTINCT id, ?, ? FROM records WHERE store = 'files'")
        .bind(Date.now(), c.get("user")),
      db.prepare("DELETE FROM records"),
    ]);
    await deleteImages(c.env.IMAGES, results.map((r) => r.id));
  } else {
    await db.prepare("DELETE FROM records WHERE store = ?").bind(s).run();
  }
  return c.json({ ok: true });
});

export default store;
